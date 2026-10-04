'use strict';

/**
 * tests/test-participantLifecycle.js
 * Comprehensive integration tests for multi-participant room lifecycle,
 * zombie socket eviction upon reconnection, and signaling security.
 */

require('should');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');

const PORT = 3095;
const BASE = `http://localhost:${PORT}`;
const SERVER = path.join(__dirname, '..', 'app', 'src', 'server.js');
const ROOM = 'lifecycle-test-room';

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
        peer_name: 'Participant',
        peer_avatar: '',
        peer_video: false,
        peer_audio: false,
        peer_video_status: false,
        peer_audio_status: false,
        peer_screen_status: false,
        peer_hand_status: false,
        peer_rec_status: false,
        peer_privacy_status: false,
        peer_info: {
            osName: 'Linux',
            osVersion: 'Ubuntu',
            browserName: 'Chrome',
            browserVersion: '120.0',
            extras: {},
        },
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
        socket.emit('join', cfg);
    });
}

describe('Pillar 3 & 4: Multi-Participant Socket.IO Room Lifecycle & Zombie Eviction', function () {
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

    it('1. should register first participant as presenter with peer count 1', async () => {
        const alice = await connectSocket();
        const aliceCfg = createJoinConfig({ peer_name: 'Alice', peer_uuid: 'uuid-alice-1' });

        const res = await joinAndAwait(alice, aliceCfg);
        res.event.should.equal('serverInfo');
        res.data.peers_count.should.equal(1);
        res.data.is_presenter.should.be.true();

        alice.disconnect();
        await sleep(200);
    });

    it('2. should correctly update peer counts and signaling when second peer joins', async () => {
        const alice = await connectSocket();
        const bob = await connectSocket();

        const aliceCfg = createJoinConfig({ peer_name: 'Alice', peer_uuid: 'uuid-alice-2' });
        const bobCfg = createJoinConfig({ peer_name: 'Bob', peer_uuid: 'uuid-bob-2' });

        const aliceJoined = await joinAndAwait(alice, aliceCfg);
        aliceJoined.data.peers_count.should.equal(1);

        // Prepare promise for Alice receiving addPeer from Bob
        const aliceAddPeerPromise = new Promise((resolve) => {
            alice.once('addPeer', (payload) => resolve(payload));
        });

        const bobJoined = await joinAndAwait(bob, bobCfg);
        bobJoined.data.peers_count.should.equal(2);
        bobJoined.data.is_presenter.should.be.false();

        const aliceAddPeer = await aliceAddPeerPromise;
        aliceAddPeer.peer_id.should.equal(bob.id);
        aliceAddPeer.should_create_offer.should.be.false();

        alice.disconnect();
        bob.disconnect();
        await sleep(200);
    });

    it('3. should actively evict zombie sockets with the same peer_uuid upon reconnection', async () => {
        const alice = await connectSocket();
        const bob1 = await connectSocket();

        const sharedBobUuid = 'uuid-bob-persistent-123';
        const aliceCfg = createJoinConfig({ peer_name: 'Alice', peer_uuid: 'uuid-alice-3' });
        const bob1Cfg = createJoinConfig({ peer_name: 'Bob', peer_uuid: sharedBobUuid });

        await joinAndAwait(alice, aliceCfg);
        await joinAndAwait(bob1, bob1Cfg);

        const expectedBob1Id = bob1.id;

        // Alice should expect removePeer when Bob reconnects and his old socket is evicted
        const aliceRemovePeerPromise = new Promise((resolve) => {
            alice.once('removePeer', (data) => resolve(data));
        });

        // Now Bob reconnects with a NEW socket bob2 but the same peer_uuid
        const bob2 = await connectSocket();
        const bob2Cfg = createJoinConfig({ peer_name: 'Bob', peer_uuid: sharedBobUuid });

        const bob2Joined = await joinAndAwait(bob2, bob2Cfg);
        // Participant count must be 2, NOT 3 (stale bob1 socket evicted)!
        bob2Joined.data.peers_count.should.equal(2);

        const removedData = await aliceRemovePeerPromise;
        removedData.peer_id.should.equal(expectedBob1Id);

        alice.disconnect();
        bob1.disconnect();
        bob2.disconnect();
        await sleep(200);
    });

    it('4. should broadcast removePeer and decrement count when participant disconnects', async () => {
        const alice = await connectSocket();
        const bob = await connectSocket();

        await joinAndAwait(alice, createJoinConfig({ peer_name: 'Alice', peer_uuid: 'uuid-alice-4' }));
        await joinAndAwait(bob, createJoinConfig({ peer_name: 'Bob', peer_uuid: 'uuid-bob-4' }));

        const expectedBobId = bob.id;

        const aliceRemovePeerPromise = new Promise((resolve) => {
            alice.once('removePeer', (data) => resolve(data));
        });

        bob.disconnect();
        const removed = await aliceRemovePeerPromise;
        removed.peer_id.should.equal(expectedBobId);

        alice.disconnect();
        await sleep(200);
    });

    it('5. should sanitize plaintext room passwords from addPeer broadcast payloads', async () => {
        const alice = await connectSocket();
        const bob = await connectSocket();
        const lockedRoom = 'locked-password-room';

        // Alice joins and locks the room with password
        await joinAndAwait(
            alice,
            createJoinConfig({
                channel: lockedRoom,
                peer_name: 'Alice',
                peer_uuid: 'uuid-alice-5',
            })
        );

        // Alice locks room with password
        await new Promise((resolve) => {
            alice.emit('roomAction', {
                room_id: lockedRoom,
                peer_name: 'Alice',
                peer_uuid: 'uuid-alice-5',
                action: 'lock',
                password: 'SuperSecretPassword123!',
            });
            setTimeout(resolve, 100);
        });

        // Bob receives addPeer when joining
        let receivedPeersPayload = null;
        bob.once('addPeer', (data) => {
            receivedPeersPayload = data.peers;
        });

        await joinAndAwait(
            bob,
            createJoinConfig({
                channel: lockedRoom,
                channel_password: 'SuperSecretPassword123!',
                peer_name: 'Bob',
                peer_uuid: 'uuid-bob-5',
            })
        );

        (receivedPeersPayload !== null).should.be.true();
        // Check that plaintext password is NOT in the broadcasted peers map!
        ('password' in receivedPeersPayload).should.be.false(
            'Plaintext password should be stripped from signaling payloads'
        );

        alice.disconnect();
        bob.disconnect();
    });
});
