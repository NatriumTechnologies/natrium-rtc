'use strict';

/**
 * tests/test-streamVolumeSeparation.js
 * Unit and integration tests for stream volume and user volume separation.
 * Verifies that:
 * 1. Screen stream audio and user voice audio are routed to separate <audio> elements.
 * 2. Lowering or muting stream volume does not affect user voice volume.
 * 3. Lowering or muting user voice volume does not affect stream volume.
 * 4. Stopping screen share cleans up the screen audio element without interrupting user voice audio.
 * 5. Screen stream volume sliders in navbar and dropdown sync and update stream audio independently.
 * 6. Master speaker volume applies proportionally across both separate streams.
 */

require('should');
const { JSDOM } = require('jsdom');
const sinon = require('sinon');

describe('Stream Volume & User Volume Separation', () => {
    let dom;
    let window;
    let document;
    let audioMediaContainer;
    let videoMediaContainer;

    beforeEach(() => {
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
                <body>
                    <div id="audioMediaContainer"></div>
                    <div id="videoMediaContainer"></div>
                </body>
            </html>
        `);
        window = dom.window;
        document = window.document;
        audioMediaContainer = document.getElementById('audioMediaContainer');
        videoMediaContainer = document.getElementById('videoMediaContainer');
    });

    // Helper simulating audio volume management from client.js
    function applyOutputVolume(audioPlayer, masterOutputVolume = 1.0) {
        if (!audioPlayer) return;
        const peerVolume = Number(audioPlayer.dataset.peerVolume);
        const volume = Math.min(1, Math.max(0, (isNaN(peerVolume) ? 1 : peerVolume) * masterOutputVolume));
        audioPlayer.volume = volume;
        audioPlayer.muted = volume === 0;
    }

    function setupAudioVolumeSlider(slider, audioPlayer, onVolumeChange) {
        slider.value = Math.round((Number(audioPlayer.dataset.peerVolume) || 1) * 100);
        slider.addEventListener('input', () => {
            audioPlayer.dataset.peerVolume = slider.value / 100;
            if (onVolumeChange) onVolumeChange(audioPlayer);
        });
    }

    it('1. should create separate audio elements for user voice and screen stream', () => {
        const peerId = 'peer_alice_1';

        // 1. User voice audio element
        const userAudioWrap = document.createElement('div');
        const userAudio = document.createElement('audio');
        userAudio.id = `${peerId}___audio`;
        userAudio.volume = 1.0;
        userAudio.dataset.peerVolume = '1';
        userAudioWrap.appendChild(userAudio);
        audioMediaContainer.appendChild(userAudioWrap);

        // 2. Screen stream audio element
        const screenAudioWrap = document.createElement('div');
        const screenAudio = document.createElement('audio');
        screenAudio.id = `${peerId}___screen_audio`;
        screenAudio.volume = 1.0;
        screenAudio.dataset.peerVolume = '1';
        screenAudio.dataset.isScreenAudio = 'true';
        screenAudioWrap.appendChild(screenAudio);
        audioMediaContainer.appendChild(screenAudioWrap);

        audioMediaContainer.querySelectorAll('audio').length.should.equal(2);
        (document.getElementById(`${peerId}___audio`) !== null).should.be.true();
        (document.getElementById(`${peerId}___screen_audio`) !== null).should.be.true();
        document.getElementById(`${peerId}___audio`).should.not.equal(document.getElementById(`${peerId}___screen_audio`));
    });

    it('2. should lower stream volume without lowering user volume', () => {
        const peerId = 'peer_bob_2';

        const userAudio = document.createElement('audio');
        userAudio.id = `${peerId}___audio`;
        userAudio.volume = 1.0;
        userAudio.dataset.peerVolume = '1';
        audioMediaContainer.appendChild(userAudio);

        const screenAudio = document.createElement('audio');
        screenAudio.id = `${peerId}___screen_audio`;
        screenAudio.volume = 1.0;
        screenAudio.dataset.peerVolume = '1';
        audioMediaContainer.appendChild(screenAudio);

        const streamSlider = document.createElement('input');
        streamSlider.type = 'range';
        streamSlider.id = `${peerId}_screen_audioVolume`;
        setupAudioVolumeSlider(streamSlider, screenAudio, (elem) => applyOutputVolume(elem));

        const userSlider = document.createElement('input');
        userSlider.type = 'range';
        userSlider.id = `${peerId}_audioVolume`;
        setupAudioVolumeSlider(userSlider, userAudio, (elem) => applyOutputVolume(elem));

        // Lower stream volume to 25%
        streamSlider.value = '25';
        streamSlider.dispatchEvent(new window.Event('input'));

        Number(screenAudio.dataset.peerVolume).should.equal(0.25);
        screenAudio.volume.should.be.approximately(0.25, 0.001);
        screenAudio.muted.should.be.false();

        // Verify user voice audio remains 100%
        Number(userAudio.dataset.peerVolume).should.equal(1.0);
        userAudio.volume.should.equal(1.0);
        userAudio.muted.should.be.false();
    });

    it('3. should mute stream audio without muting user voice audio', () => {
        const peerId = 'peer_charlie_3';

        const userAudio = document.createElement('audio');
        userAudio.id = `${peerId}___audio`;
        userAudio.volume = 1.0;
        userAudio.dataset.peerVolume = '1';
        audioMediaContainer.appendChild(userAudio);

        const screenAudio = document.createElement('audio');
        screenAudio.id = `${peerId}___screen_audio`;
        screenAudio.volume = 1.0;
        screenAudio.dataset.peerVolume = '1';
        audioMediaContainer.appendChild(screenAudio);

        const streamSlider = document.createElement('input');
        setupAudioVolumeSlider(streamSlider, screenAudio, (elem) => applyOutputVolume(elem));

        // Mute stream to 0%
        streamSlider.value = '0';
        streamSlider.dispatchEvent(new window.Event('input'));

        Number(screenAudio.dataset.peerVolume).should.equal(0);
        screenAudio.volume.should.equal(0);
        screenAudio.muted.should.be.true();

        // User voice is still active at full volume
        Number(userAudio.dataset.peerVolume).should.equal(1.0);
        userAudio.volume.should.equal(1.0);
        userAudio.muted.should.be.false();
    });

    it('4. should lower user voice volume without lowering stream volume', () => {
        const peerId = 'peer_dave_4';

        const userAudio = document.createElement('audio');
        userAudio.id = `${peerId}___audio`;
        userAudio.volume = 1.0;
        userAudio.dataset.peerVolume = '1';
        audioMediaContainer.appendChild(userAudio);

        const screenAudio = document.createElement('audio');
        screenAudio.id = `${peerId}___screen_audio`;
        screenAudio.volume = 1.0;
        screenAudio.dataset.peerVolume = '1';
        audioMediaContainer.appendChild(screenAudio);

        const userSlider = document.createElement('input');
        setupAudioVolumeSlider(userSlider, userAudio, (elem) => applyOutputVolume(elem));

        // Lower user voice volume to 40%
        userSlider.value = '40';
        userSlider.dispatchEvent(new window.Event('input'));

        Number(userAudio.dataset.peerVolume).should.equal(0.4);
        userAudio.volume.should.be.approximately(0.4, 0.001);

        // Stream audio remains 100%
        Number(screenAudio.dataset.peerVolume).should.equal(1.0);
        screenAudio.volume.should.equal(1.0);
    });

    it('5. should clean up screen audio element on screen stop while keeping user voice audio intact', () => {
        const peerId = 'peer_eve_5';

        const userAudioWrap = document.createElement('div');
        const userAudio = document.createElement('audio');
        userAudio.id = `${peerId}___audio`;
        userAudio._audioWatchdog = 12345;
        userAudioWrap.appendChild(userAudio);
        audioMediaContainer.appendChild(userAudioWrap);

        const screenAudioWrap = document.createElement('div');
        const screenAudio = document.createElement('audio');
        screenAudio.id = `${peerId}___screen_audio`;
        let watchdogCleared = false;
        screenAudio._audioWatchdog = {
            id: 99999,
        };
        screenAudioWrap.appendChild(screenAudio);
        audioMediaContainer.appendChild(screenAudioWrap);

        const peerAudioMediaElements = {
            [`${peerId}___audio`]: userAudioWrap,
            [`${peerId}___screen_audio`]: screenAudioWrap,
        };

        // Simulate handleScreenStop teardown logic
        const screenAudioId = `${peerId}___screen_audio`;
        if (screenAudioId in peerAudioMediaElements) {
            const wrap = peerAudioMediaElements[screenAudioId];
            const audioEl = wrap.querySelector('audio');
            if (audioEl && audioEl._audioWatchdog) {
                watchdogCleared = true;
                audioEl._audioWatchdog = null;
            }
            wrap.parentNode?.removeChild(wrap);
            delete peerAudioMediaElements[screenAudioId];
        }

        // Screen audio is removed
        (document.getElementById(`${peerId}___screen_audio`) === null).should.be.true();
        (screenAudioId in peerAudioMediaElements).should.be.false();
        watchdogCleared.should.be.true();

        // User audio is still in DOM and mapped
        (document.getElementById(`${peerId}___audio`) !== null).should.be.true();
        (`${peerId}___audio` in peerAudioMediaElements).should.be.true();
        userAudio._audioWatchdog.should.equal(12345);
    });

    it('6. should sync screen volume proxy in dropdown with screen audio element', () => {
        const peerId = 'peer_frank_6';

        const screenAudio = document.createElement('audio');
        screenAudio.id = `${peerId}___screen_audio`;
        screenAudio.volume = 1.0;
        screenAudio.dataset.peerVolume = '1';
        audioMediaContainer.appendChild(screenAudio);

        const sourceRange = document.createElement('input');
        sourceRange.type = 'range';
        sourceRange.id = `${peerId}_screen_audioVolume`;
        setupAudioVolumeSlider(sourceRange, screenAudio, (elem) => applyOutputVolume(elem));

        // Create responsive proxy range (mimicking createResponsiveDropdownRangeItem)
        const proxyRange = document.createElement('input');
        proxyRange.type = 'range';
        proxyRange.addEventListener('input', () => {
            sourceRange.value = proxyRange.value;
            sourceRange.dispatchEvent(new window.Event('input', { bubbles: true }));
        });
        sourceRange.addEventListener('input', () => {
            proxyRange.value = sourceRange.value;
        });

        // User drags proxy slider in dropdown menu to 60%
        proxyRange.value = '60';
        proxyRange.dispatchEvent(new window.Event('input'));

        sourceRange.value.should.equal('60');
        Number(screenAudio.dataset.peerVolume).should.equal(0.6);
        screenAudio.volume.should.be.approximately(0.6, 0.001);
    });

    it('7. should apply master output volume proportionally to both user and stream audio', () => {
        const peerId = 'peer_grace_7';

        const userAudio = document.createElement('audio');
        userAudio.id = `${peerId}___audio`;
        userAudio.dataset.peerVolume = '0.8'; // User voice set to 80%
        audioMediaContainer.appendChild(userAudio);

        const screenAudio = document.createElement('audio');
        screenAudio.id = `${peerId}___screen_audio`;
        screenAudio.dataset.peerVolume = '0.5'; // Stream audio set to 50%
        audioMediaContainer.appendChild(screenAudio);

        // Master speaker volume set to 50%
        const masterOutputVolume = 0.5;
        applyOutputVolume(userAudio, masterOutputVolume);
        applyOutputVolume(screenAudio, masterOutputVolume);

        // User voice should be 0.8 * 0.5 = 0.4
        userAudio.volume.should.be.approximately(0.4, 0.001);

        // Stream audio should be 0.5 * 0.5 = 0.25
        screenAudio.volume.should.be.approximately(0.25, 0.001);
    });
});
