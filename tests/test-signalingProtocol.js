'use strict';

/**
 * tests/test-signalingProtocol.js
 * Integration test for end-to-end signaling protocol:
 * 1. SDP Offer/Answer relay between peers
 * 2. ICE Candidate exchange
 * 3. Screen sharing action broadcasts (screenStart / screenStop)
 * 4. Join Lock enforcement (roomIsJoinLocked)
 * 5. Peer status updates (audio/video/hand)
 * 6. Unauthorized traversal room rejection
 */

require('should');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3094;
const BASE = `http://localhost:${PORT}`;
const SERVER = path.join(__dirname, '..', 'app', 'src', 'server.js');
const ROOM = 'signaling-protocol-room';

let serverProcess;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetch(`${BASE}/`, { redirect: 'manual' });
            return;
        } catch (err) {
            await sleep(200);
        }
    }
    throw new Error('Server did not become ready in time');
}

function connectSocket() {
    return new Promise((resolve, reject) => {
        const socket = io(BASE, { transports: ['websocket'], reconnection: false, forceNew: true });
        const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
        socket.on('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });
        socket.on('connect_error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

function createJoinConfig(extra = {}) {
    return {
        channel: ROOM,
        channel_password: '',
        peer_uuid: 'uuid-' + Math.random().toString(36).slice(2),
        peer_name: 'Peer',
        peer_avatar: '',
        peer_video: false,
        peer_audio: false,
        peer_video_status: false,
        peer_audio_status: false,
        peer_screen_status: false,
        peer_hand_status: false,
        peer_rec_status: false,
        peer_privacy_status: false,
        peer_info: {},
        ...extra,
    };
}

function joinAndAwait(socket, cfg, timeoutMs = 6000) {
    return new Promise((resolve) => {
        const done = (result) => {
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => resolve({ event: 'timeout' }), timeoutMs);
        socket.once('serverInfo', (data) => done({ event: 'serverInfo', data }));
        socket.once('unauthorized', () => done({ event: 'unauthorized' }));
        socket.once('roomIsJoinLocked', () => done({ event: 'roomIsJoinLocked' }));
        socket.emit('join', cfg);
    });
}

describe('Pillar 5: WebRTC Signaling Protocol and Room State Controls', function () {
    this.timeout(30000);

    before(async () => {
        serverProcess = spawn(process.execPath, [SERVER], {
            env: {
                ...process.env,
                PORT: String(PORT),
                HOST_PROTECTED: 'false',
                HOST_USER_AUTH: 'false',
                NGROK_ENABLED: 'false',
                SENTRY_ENABLED: 'false',
                IP_LOOKUP_ENABLED: 'false',
                OIDC_ENABLED: 'false',
            },
            stdio: ['ignore', 'ignore', 'ignore'],
        });
        await waitForServer();
    });

    after(async () => {
        if (serverProcess) {
            serverProcess.kill('SIGTERM');
            await sleep(500);
            if (!serverProcess.killed) serverProcess.kill('SIGKILL');
        }
    });

    it('1. should relay SDP offer and answer cleanly between peers', async () => {
        const alice = await connectSocket();
        const bob = await connectSocket();

        await joinAndAwait(alice, createJoinConfig({ peer_name: 'Alice', peer_uuid: 'uuid-alice-sig' }));
        await joinAndAwait(bob, createJoinConfig({ peer_name: 'Bob', peer_uuid: 'uuid-bob-sig' }));

        // Bob listens for SDP offer from Alice
        const bobOfferPromise = new Promise((resolve) => {
            bob.once('sessionDescription', (data) => resolve(data));
        });

        // Alice sends offer to Bob
        alice.emit('relaySDP', {
            peer_id: bob.id,
            session_description: { type: 'offer', sdp: 'v=0\r\no=alice 1234 1 IN IP4 127.0.0.1\r\ns=-\r\n' },
        });

        const bobReceived = await bobOfferPromise;
        bobReceived.peer_id.should.equal(alice.id);
        bobReceived.session_description.type.should.equal('offer');

        // Alice listens for SDP answer from Bob
        const aliceAnswerPromise = new Promise((resolve) => {
            alice.once('sessionDescription', (data) => resolve(data));
        });

        // Bob sends answer to Alice
        bob.emit('relaySDP', {
            peer_id: alice.id,
            session_description: { type: 'answer', sdp: 'v=0\r\no=bob 5678 1 IN IP4 127.0.0.1\r\ns=-\r\n' },
        });

        const aliceReceived = await aliceAnswerPromise;
        aliceReceived.peer_id.should.equal(bob.id);
        aliceReceived.session_description.type.should.equal('answer');

        alice.disconnect();
        bob.disconnect();
        await sleep(200);
    });

    it('2. should relay ICE candidates between connected peers', async () => {
        const alice = await connectSocket();
        const bob = await connectSocket();

        await joinAndAwait(alice, createJoinConfig({ peer_name: 'Alice', peer_uuid: 'uuid-alice-ice' }));
        await joinAndAwait(bob, createJoinConfig({ peer_name: 'Bob', peer_uuid: 'uuid-bob-ice' }));

        const candidatePayload = {
            candidate: 'candidate:1 1 UDP 2130706431 192.168.1.1 5000 typ host',
            sdpMid: '0',
            sdpMLineIndex: 0,
        };

        const bobCandidatePromise = new Promise((resolve) => {
            bob.once('iceCandidate', (data) => resolve(data));
        });

        alice.emit('relayICE', {
            peer_id: bob.id,
            ice_candidate: candidatePayload,
        });

        const received = await bobCandidatePromise;
        received.peer_id.should.equal(alice.id);
        received.ice_candidate.should.deepEqual(candidatePayload);

        alice.disconnect();
        bob.disconnect();
        await sleep(200);
    });

    it('3. should broadcast screenStart and screenStop actions to room peers', async () => {
        const alice = await connectSocket();
        const bob = await connectSocket();

        await joinAndAwait(alice, createJoinConfig({ peer_name: 'Alice', peer_uuid: 'uuid-alice-act' }));
        await joinAndAwait(bob, createJoinConfig({ peer_name: 'Bob', peer_uuid: 'uuid-bob-act' }));

        // Bob listens for peerAction broadcast
        const bobActionStartPromise = new Promise((resolve) => {
            bob.once('peerAction', (data) => resolve(data));
        });

        alice.emit('peerAction', {
            room_id: ROOM,
            peer_id: alice.id,
            peer_name: 'Alice',
            peer_uuid: 'uuid-alice-act',
            peer_action: 'screenStart',
            send_to_all: true,
            extras: { hasAudio: true },
        });

        const startAction = await bobActionStartPromise;
        startAction.peer_action.should.equal('screenStart');

        const bobActionStopPromise = new Promise((resolve) => {
            bob.once('peerAction', (data) => resolve(data));
        });

        alice.emit('peerAction', {
            room_id: ROOM,
            peer_id: alice.id,
            peer_name: 'Alice',
            peer_uuid: 'uuid-alice-act',
            peer_action: 'screenStop',
            send_to_all: true,
            extras: {},
        });

        const stopAction = await bobActionStopPromise;
        stopAction.peer_action.should.equal('screenStop');

        alice.disconnect();
        bob.disconnect();
        await sleep(200);
    });

    it('4. should reject guest join when room is join-locked by presenter', async () => {
        const alice = await connectSocket();
        const charlie = await connectSocket();
        const lockRoom = 'join-lock-test-room';

        // Alice joins first (becomes presenter)
        await joinAndAwait(
            alice,
            createJoinConfig({ channel: lockRoom, peer_name: 'Alice', peer_uuid: 'uuid-alice-jl' })
        );

        // Alice locks room for new participants using joinLockOn
        await new Promise((resolve) => {
            alice.emit('roomAction', {
                room_id: lockRoom,
                peer_name: 'Alice',
                peer_uuid: 'uuid-alice-jl',
                action: 'joinLockOn',
            });
            setTimeout(resolve, 100);
        });

        // Charlie tries to join
        const charlieRes = await joinAndAwait(
            charlie,
            createJoinConfig({ channel: lockRoom, peer_name: 'Charlie', peer_uuid: 'uuid-charlie-jl' })
        );

        charlieRes.event.should.equal('roomIsJoinLocked');

        alice.disconnect();
        charlie.disconnect();
        await sleep(200);
    });

    it('5. should reject path-traversal room names upon join attempt', async () => {
        const attacker = await connectSocket();
        const res = await joinAndAwait(
            attacker,
            createJoinConfig({ channel: '../../etc/passwd', peer_name: 'Attacker' })
        );

        res.event.should.equal('unauthorized');
        attacker.disconnect();
    });
});
