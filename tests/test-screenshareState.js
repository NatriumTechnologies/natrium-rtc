'use strict';

/**
 * tests/test-screenshareState.js
 * Comprehensive unit and state-machine tests for screen sharing concurrency,
 * debouncing, cancel/reject handling, and teardown lifecycles.
 */

require('should');
const sinon = require('sinon');

describe('Pillar 2: Screen Sharing State Machine & Concurrency', () => {
    // Harness simulating the client.js screen sharing state machine
    class ScreenShareManager {
        constructor() {
            this.isScreenStreaming = false;
            this.isScreenShareStarting = false;
            this.myScreenStatus = false;
            this.localScreenDisplayStream = null;
            this.localScreenMediaStream = null;
            this.btnPointerEvents = '';
            this.eventsEmitted = [];
            this.domCleaned = false;
        }

        async getDisplayMediaMock(shouldFail = false, failureReason = 'NotAllowedError') {
            if (shouldFail) {
                const err = new Error('Permission denied');
                err.name = failureReason;
                throw err;
            }
            // Mock a MediaStream with video track
            const self = this;
            const videoTrack = {
                kind: 'video',
                readyState: 'live',
                stop: sinon.stub(),
                onended: null,
            };
            return {
                getTracks: () => [videoTrack],
                getVideoTracks: () => [videoTrack],
                getAudioTracks: () => [],
                stop: () => videoTrack.stop(),
            };
        }

        async toggleScreenSharing(getDisplayMediaFn) {
            if (this.isScreenShareStarting) {
                this.eventsEmitted.push('rejected_concurrent_start');
                return false;
            }

            try {
                if (!this.isScreenStreaming) {
                    this.isScreenShareStarting = true;
                    this.btnPointerEvents = 'none';
                }

                if (!this.isScreenStreaming) {
                    await this.startScreenSharing(getDisplayMediaFn);
                } else {
                    await this.stopScreenSharing();
                }
                return true;
            } catch (err) {
                if (err && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
                    this.eventsEmitted.push('cancelled_by_user');
                } else {
                    this.eventsEmitted.push(`error: ${err.message}`);
                }
                return false;
            } finally {
                this.isScreenShareStarting = false;
                this.btnPointerEvents = '';
            }
        }

        async startScreenSharing(getDisplayMediaFn) {
            if (this.localScreenDisplayStream || this.localScreenMediaStream) {
                this.eventsEmitted.push('evicted_prior_stream');
                await this.stopScreenSharing();
            }

            const stream = await getDisplayMediaFn();
            if (!stream) return;

            this.localScreenDisplayStream = stream;
            this.localScreenMediaStream = stream;
            this.isScreenStreaming = true;
            this.myScreenStatus = true;
            this.eventsEmitted.push('screen_started');

            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.onended = () => {
                    videoTrack.onended = null;
                    if (this.isScreenStreaming && !this.isScreenShareStarting) {
                        this.eventsEmitted.push('native_stop_triggered');
                        this.toggleScreenSharing(getDisplayMediaFn);
                    }
                };
            }
        }

        async stopScreenSharing() {
            this.isScreenStreaming = false;
            this.myScreenStatus = false;
            this.domCleaned = true;

            if (this.localScreenDisplayStream) {
                this.localScreenDisplayStream.getTracks().forEach((t) => t.stop());
                this.localScreenDisplayStream = null;
            }
            if (this.localScreenMediaStream) {
                this.localScreenMediaStream = null;
            }
            this.eventsEmitted.push('screen_stopped');
        }
    }

    let manager;

    beforeEach(() => {
        manager = new ScreenShareManager();
    });

    it('1. should successfully start screen sharing when idle', async () => {
        const started = await manager.toggleScreenSharing(() => manager.getDisplayMediaMock(false));
        started.should.be.true();
        manager.isScreenStreaming.should.be.true();
        manager.myScreenStatus.should.be.true();
        manager.isScreenShareStarting.should.be.false();
        manager.btnPointerEvents.should.equal('');
        manager.eventsEmitted.should.containEql('screen_started');
    });

    it('2. should block concurrent toggle requests while prompt is open', async () => {
        let resolveDisplayMedia;
        const deferredPrompt = new Promise((resolve) => {
            resolveDisplayMedia = resolve;
        });

        // First click starts prompt and waits
        const firstCall = manager.toggleScreenSharing(() => deferredPrompt);
        manager.isScreenShareStarting.should.be.true();
        manager.btnPointerEvents.should.equal('none');

        // Second click while prompt is open
        const secondCall = await manager.toggleScreenSharing(() => manager.getDisplayMediaMock(false));
        secondCall.should.be.false();
        manager.eventsEmitted.should.containEql('rejected_concurrent_start');

        // Resolve first prompt
        const mockStream = await manager.getDisplayMediaMock(false);
        resolveDisplayMedia(mockStream);
        await firstCall;

        manager.isScreenStreaming.should.be.true();
        manager.isScreenShareStarting.should.be.false();
        manager.btnPointerEvents.should.equal('');
    });

    it('3. should handle user cancelling picker without leaving locked state', async () => {
        const result = await manager.toggleScreenSharing(() =>
            manager.getDisplayMediaMock(true, 'NotAllowedError')
        );
        result.should.be.false();
        manager.isScreenStreaming.should.be.false();
        manager.myScreenStatus.should.be.false();
        manager.isScreenShareStarting.should.be.false();
        manager.btnPointerEvents.should.equal('');
        manager.eventsEmitted.should.containEql('cancelled_by_user');
    });

    it('4. should gracefully stop screen sharing on second toggle', async () => {
        await manager.toggleScreenSharing(() => manager.getDisplayMediaMock(false));
        manager.isScreenStreaming.should.be.true();

        // Second toggle stops it
        const stopped = await manager.toggleScreenSharing(() => manager.getDisplayMediaMock(false));
        stopped.should.be.true();
        manager.isScreenStreaming.should.be.false();
        manager.myScreenStatus.should.be.false();
        manager.domCleaned.should.be.true();
        manager.eventsEmitted.should.containEql('screen_stopped');
    });

    it('5. should handle native browser "Stop sharing" bar without infinite loops', async () => {
        await manager.toggleScreenSharing(() => manager.getDisplayMediaMock(false));
        manager.isScreenStreaming.should.be.true();

        const videoTrack = manager.localScreenDisplayStream.getVideoTracks()[0];
        (typeof videoTrack.onended).should.equal('function');

        // Trigger native onended
        videoTrack.onended();
        await new Promise((r) => setTimeout(r, 10));

        manager.eventsEmitted.should.containEql('native_stop_triggered');
        manager.eventsEmitted.should.containEql('screen_stopped');
        manager.isScreenStreaming.should.be.false();
        manager.myScreenStatus.should.be.false();
    });

    it('6. should evict prior screen streams if startScreenSharing is called with an active stream', async () => {
        await manager.toggleScreenSharing(() => manager.getDisplayMediaMock(false));
        manager.isScreenStreaming.should.be.true();

        // Force a startScreenSharing directly (simulating reconnection or unexpected invoke)
        await manager.startScreenSharing(() => manager.getDisplayMediaMock(false));

        manager.eventsEmitted.should.containEql('evicted_prior_stream');
        manager.isScreenStreaming.should.be.true();
    });
});
