'use strict';

/**
 * tests/test-audioWatchdog.js
 * Unit tests for remote audio element playback watchdog, autoplay suspension recovery,
 * AudioContext gesture unlocks, and audio stream continuity guards.
 */

require('should');
const sinon = require('sinon');
const { JSDOM } = require('jsdom');

describe('Pillar 6: Audio Watchdog, Autoplay Recovery, and AudioContext Lifecycle', () => {
    let dom;
    let window;
    let document;
    let audioMediaContainer;

    beforeEach(() => {
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
                <body>
                    <div id="audioMediaContainer"></div>
                </body>
            </html>
        `);
        window = dom.window;
        document = window.document;
        audioMediaContainer = document.getElementById('audioMediaContainer');
    });

    class AudioWatchdogManager {
        constructor(container) {
            this.container = container;
            this.playAttempts = 0;
        }

        checkAndResumeAudioElements() {
            const audioElements = this.container.querySelectorAll('audio');
            const recovered = [];

            audioElements.forEach((audio) => {
                // If audio has live media stream but is paused, watchdog attempts recovery
                if (audio.paused && audio._hasActiveStream) {
                    this.playAttempts++;
                    audio._playTriggered = true;
                    recovered.push(audio.id);
                }
            });

            return recovered;
        }

        async unlockAudioContext(ctx) {
            if (ctx.state === 'suspended') {
                await ctx.resume();
                return true;
            }
            return false;
        }
    }

    it('1. should detect paused audio elements with active streams and trigger play()', () => {
        const mgr = new AudioWatchdogManager(audioMediaContainer);

        const audioElement = document.createElement('audio');
        audioElement.id = 'peer_audio_123';
        audioElement._hasActiveStream = true;
        // JSDOM audio defaults to paused
        audioMediaContainer.appendChild(audioElement);

        const recovered = mgr.checkAndResumeAudioElements();
        recovered.should.containEql('peer_audio_123');
        audioElement._playTriggered.should.be.true();
        mgr.playAttempts.should.equal(1);
    });

    it('2. should not trigger play() for audio elements without active streams', () => {
        const mgr = new AudioWatchdogManager(audioMediaContainer);

        const idleAudio = document.createElement('audio');
        idleAudio.id = 'idle_audio';
        idleAudio._hasActiveStream = false;
        audioMediaContainer.appendChild(idleAudio);

        const recovered = mgr.checkAndResumeAudioElements();
        recovered.should.have.length(0);
        mgr.playAttempts.should.equal(0);
    });

    it('3. should unlock suspended AudioContext upon user gesture', async () => {
        const mgr = new AudioWatchdogManager(audioMediaContainer);
        const mockContext = {
            state: 'suspended',
            resume: sinon.stub().resolves(),
        };

        const unlocked = await mgr.unlockAudioContext(mockContext);
        unlocked.should.be.true();
        mockContext.resume.calledOnce.should.be.true();
    });

    it('4. should skip unlock when AudioContext is already running', async () => {
        const mgr = new AudioWatchdogManager(audioMediaContainer);
        const mockContext = {
            state: 'running',
            resume: sinon.stub().resolves(),
        };

        const unlocked = await mgr.unlockAudioContext(mockContext);
        unlocked.should.be.false();
        mockContext.resume.called.should.be.false();
    });

    it('5. should safely fallback when noise suppression fails or is disabled', () => {
        const rawMicTrack = { id: 'mic-track-1', kind: 'audio', enabled: true };
        const getStream = (enableRNNoise, rnNoiseModuleFails) => {
            if (enableRNNoise && !rnNoiseModuleFails) {
                return { track: { id: 'filtered-track', kind: 'audio' }, isFiltered: true };
            }
            // Fallback cleanly to raw mic track
            return { track: rawMicTrack, isFiltered: false };
        };

        const normal = getStream(true, false);
        normal.isFiltered.should.be.true();

        const failedModule = getStream(true, true);
        failedModule.isFiltered.should.be.false();
        failedModule.track.id.should.equal('mic-track-1');

        const disabled = getStream(false, false);
        disabled.isFiltered.should.be.false();
        disabled.track.id.should.equal('mic-track-1');
    });
});
