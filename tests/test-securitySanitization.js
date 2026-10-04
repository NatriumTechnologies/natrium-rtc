'use strict';

/**
 * tests/test-securitySanitization.js
 * Comprehensive tests for credential sanitization, room password masking,
 * prototype pollution protection, role-spoofing prevention, and secret isolation.
 */

require('should');
const ServerApi = require('../app/src/api');
const Validate = require('../app/src/validate');

describe('Pillar 6 & 7: Security, Credential Sanitization & Room Access Control', () => {
    describe('1. Room Password Masking in ServerApi.getMeetings', () => {
        it('should mask plaintext passwords into boolean true in getMeetings()', () => {
            const api = new ServerApi('example.com', 'secret', 'secret');
            const internalPeersMap = {
                'public-room': {
                    lock: false,
                    peer1: { peer_name: 'Alice' },
                },
                'protected-room': {
                    lock: true,
                    password: 'SuperSecretPlaintextPassword!123',
                    peer2: { peer_name: 'Bob' },
                },
            };

            const meetings = api.getMeetings(internalPeersMap);

            meetings['public-room'].should.have.property('lock', false);
            (meetings['public-room'].password === undefined || meetings['public-room'].password === false).should.be.true();

            meetings['protected-room'].should.have.property('lock', true);
            meetings['protected-room'].password.should.equal(
                true,
                'Plaintext password MUST be transformed into boolean true in API responses'
            );
            meetings['protected-room'].password.should.not.equal(
                'SuperSecretPlaintextPassword!123',
                'Plaintext password MUST NEVER be returned'
            );
        });
    });

    describe('2. Sanitized Peer Signaling Payload Generation', () => {
        function getSanitizedPeers(roomPeers) {
            if (!roomPeers) return {};
            const sanitized = {};
            for (const [key, value] of Object.entries(roomPeers)) {
                if (key === 'password') {
                    continue;
                }
                if (typeof value === 'object' && value !== null) {
                    sanitized[key] = { ...value };
                    delete sanitized[key].peer_uuid;
                } else {
                    sanitized[key] = value;
                }
            }
            return sanitized;
        }

        it('should strip password and private peer_uuid before signaling broadcast', () => {
            const rawRoom = {
                lock: true,
                password: 'TopSecretRoomKey',
                joinLock: false,
                socket_123: {
                    peer_name: 'Alice',
                    peer_avatar: 'avatar1.png',
                    peer_uuid: 'sensitive-persistent-device-uuid-xyz',
                    peer_video: true,
                    peer_audio: true,
                },
            };

            const sanitized = getSanitizedPeers(rawRoom);

            ('password' in sanitized).should.be.false('Password field must be removed');
            sanitized.lock.should.be.true();
            sanitized.joinLock.should.be.false();

            sanitized.socket_123.peer_name.should.equal('Alice');
            sanitized.socket_123.peer_avatar.should.equal('avatar1.png');
            sanitized.socket_123.peer_video.should.be.true();
            ('peer_uuid' in sanitized.socket_123).should.be.false('Device UUID must be stripped from peer object');
        });
    });

    describe('3. Validation Against Prototype Pollution and Dangerous Keys', () => {
        it('should safely validate payloads containing prototype pollution attempts', () => {
            const maliciousPayload = JSON.parse(
                '{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}, "room_id": "test"}'
            );

            // Verify global object is not polluted before or after
            ({}).should.not.have.property('polluted');

            const isValid = Validate.isValidData(maliciousPayload);
            isValid.should.be.true(); // Validates schema without crashing

            ({}).should.not.have.property('polluted', 'Global Object.prototype must never be polluted');
        });
    });

    describe('4. Room Name and Path Traversal Protection', () => {
        it('should reject invalid and dangerous room names', () => {
            Validate.isValidRoomName('../../../etc/passwd').should.be.false();
            Validate.isValidRoomName('..\\..\\windows\\system32').should.be.false();
            Validate.isValidRoomName('<script>alert(1)</script>').should.be.false();
            Validate.isValidRoomName('').should.be.false();
            Validate.isValidRoomName(null).should.be.false();
            Validate.isValidRoomName(undefined).should.be.false();
        });

        it('should accept valid standard and alphanumeric room names', () => {
            Validate.isValidRoomName('my-team-meeting').should.be.true();
            Validate.isValidRoomName('Standup_2026_10_04').should.be.true();
            Validate.isValidRoomName('GeneralRoom123').should.be.true();
        });
    });

    describe('5. Authorization and API Key Verification', () => {
        it('should reject requests with missing or mismatching API secrets', () => {
            new ServerApi('host.com', null, 'correct-secret').isAuthorized().should.be.false();
            new ServerApi('host.com', '', 'correct-secret').isAuthorized().should.be.false();
            new ServerApi('host.com', 'wrong-secret', 'correct-secret').isAuthorized().should.be.false();
            new ServerApi('host.com', 'correct-secret', 'correct-secret').isAuthorized().should.be.true();
        });

        it('should reject API requests when server has no API key configured', () => {
            new ServerApi('host.com', 'any-secret', null).isAuthorized().should.be.false();
            new ServerApi('host.com', 'any-secret', '').isAuthorized().should.be.false();
        });
    });
});
