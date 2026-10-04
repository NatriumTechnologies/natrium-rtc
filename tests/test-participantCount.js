'use strict';

require('should');

describe('test-participantCount and screen share deduplication', () => {
    function getRoomParticipantsCount(allPeers, myPeerId, peerConnections) {
        if (allPeers && typeof allPeers === 'object') {
            const metaKeys = new Set(['lock', 'password', 'joinLock']);
            const validPeerIds = Object.keys(allPeers).filter(
                (k) => !metaKeys.has(k) && allPeers[k] && typeof allPeers[k] === 'object'
            );
            if (validPeerIds.length > 0) {
                return validPeerIds.includes(myPeerId) ? validPeerIds.length : validPeerIds.length + 1;
            }
        }
        return 1 + Object.keys(peerConnections || {}).length;
    }

    it('should return 1 when user is alone in the room with empty allPeers and peerConnections', () => {
        const count = getRoomParticipantsCount({}, 'socket_1', {});
        count.should.equal(1);
    });

    it('should return 1 when user is alone in the room and allPeers contains only the user and room metadata', () => {
        const allPeers = {
            lock: false,
            password: null,
            joinLock: false,
            socket_1: { peer_name: 'Alice' },
        };
        const count = getRoomParticipantsCount(allPeers, 'socket_1', {});
        count.should.equal(1);
    });

    it('should return 2 when two peers are in the room, ignoring metadata keys', () => {
        const allPeers = {
            lock: true,
            password: 'secret',
            joinLock: false,
            socket_1: { peer_name: 'Alice' },
            socket_2: { peer_name: 'Bob' },
        };
        const count = getRoomParticipantsCount(allPeers, 'socket_1', { socket_2: {} });
        count.should.equal(2);
    });

    it('should calculate participant count independently from DOM video tile count', () => {
        // Simulated scenario: 2 users (Alice & Bob), but Alice has camera + 4 screen tiles = 6 tiles in container
        const domChildElementCount = 6;
        const allPeers = {
            socket_1: { peer_name: 'Alice' },
            socket_2: { peer_name: 'Bob' },
        };
        const trueParticipantCount = getRoomParticipantsCount(allPeers, 'socket_1', { socket_2: {} });

        // Participant count should be 2, NOT 6!
        trueParticipantCount.should.equal(2);
        domChildElementCount.should.not.equal(trueParticipantCount);
    });

    it('should fallback to peerConnections count + 1 if allPeers is undefined or null', () => {
        const count = getRoomParticipantsCount(null, 'socket_1', { socket_2: {}, socket_3: {} });
        count.should.equal(3);
    });

    it('should handle late joiner where myPeerId is not yet in allPeers', () => {
        const allPeers = {
            socket_2: { peer_name: 'Bob' },
        };
        const count = getRoomParticipantsCount(allPeers, 'socket_1', { socket_2: {} });
        count.should.equal(2);
    });
});
