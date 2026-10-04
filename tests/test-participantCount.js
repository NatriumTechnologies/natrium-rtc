'use strict';

/**
 * tests/test-participantCount.js
 * Comprehensive tests for human participant counting, screen-share tile independence,
 * dynamic room scaling, and responsive grid aspect-ratio calculation.
 */

require('should');

describe('Pillar 3: Human Participant Counting and Dynamic Grid Layout', () => {
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

    function calculateAspectRatios(tilesCount) {
        let desktop = 0;
        let mobile = 1;

        // Desktop aspect ratio mapping
        switch (tilesCount) {
            case 1:
            case 3:
            case 4:
            case 7:
            case 9:
                desktop = 2; // (16:9)
                break;
            case 5:
            case 6:
            case 10:
            case 11:
                desktop = 1; // (4:3)
                break;
            case 2:
            case 8:
                desktop = 3; // (1:1)
                break;
            default:
                desktop = 0; // (0:0)
        }

        // Mobile aspect ratio mapping
        switch (tilesCount) {
            case 3:
            case 9:
            case 10:
                mobile = 2; // (16:9)
                break;
            case 2:
            case 7:
            case 8:
            case 11:
                mobile = 1; // (4:3)
                break;
            case 1:
            case 4:
            case 5:
            case 6:
            default:
                mobile = 3; // (1:1)
                break;
        }

        return { desktop, mobile };
    }

    describe('1. Participant Counting Logic', () => {
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

        it('should accurately count scaling rooms with 5, 10, and 25 participants', () => {
            [5, 10, 25].forEach((n) => {
                const peers = { lock: true, joinLock: false };
                for (let i = 1; i <= n; i++) {
                    peers[`socket_${i}`] = { peer_name: `User_${i}` };
                }
                const count = getRoomParticipantsCount(peers, 'socket_1', {});
                count.should.equal(n);
            });
        });

        it('should exclude non-object metadata entries and corrupt values', () => {
            const allPeers = {
                socket_1: { peer_name: 'Alice' },
                socket_2: { peer_name: 'Bob' },
                corruptKey1: 'justAString',
                corruptKey2: 42,
                corruptKey3: null,
            };
            const count = getRoomParticipantsCount(allPeers, 'socket_1', {});
            count.should.equal(2);
        });
    });

    describe('2. Aspect Ratio Grid Engine (adaptAspectRatio)', () => {
        it('should map desktop aspect ratios based on tile count', () => {
            calculateAspectRatios(1).desktop.should.equal(2); // 16:9 for single view
            calculateAspectRatios(2).desktop.should.equal(3); // 1:1 for side-by-side
            calculateAspectRatios(3).desktop.should.equal(2); // 16:9
            calculateAspectRatios(4).desktop.should.equal(2); // 16:9 2x2 grid
            calculateAspectRatios(5).desktop.should.equal(1); // 4:3
            calculateAspectRatios(6).desktop.should.equal(1); // 4:3
            calculateAspectRatios(8).desktop.should.equal(3); // 1:1
            calculateAspectRatios(12).desktop.should.equal(0); // 0:0 default / auto
        });

        it('should map mobile aspect ratios based on tile count', () => {
            calculateAspectRatios(1).mobile.should.equal(3); // 1:1 mobile solo
            calculateAspectRatios(2).mobile.should.equal(1); // 4:3 mobile pair
            calculateAspectRatios(3).mobile.should.equal(2); // 16:9 mobile 3
            calculateAspectRatios(4).mobile.should.equal(3); // 1:1 mobile 4
            calculateAspectRatios(9).mobile.should.equal(2); // 16:9 mobile 9
        });

        it('should decouple badge visibility from aspect ratio changes', () => {
            const soloCount = 1;
            const duoCount = 2;

            const isBadgeVisible = (count) => count > 1;

            isBadgeVisible(soloCount).should.be.false('Badge should be hidden when alone');
            isBadgeVisible(duoCount).should.be.true('Badge should be visible with multiple participants');
        });
    });
});
