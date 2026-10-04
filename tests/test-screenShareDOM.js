'use strict';

/**
 * tests/test-screenShareDOM.js
 * JSDOM-driven DOM lifecycle and tile deduplication tests for local and remote screens,
 * unpinning on stop, orphan cleanup, and layout element stability.
 */

require('should');
const { JSDOM } = require('jsdom');
const sinon = require('sinon');

describe('Pillar 4: Screen Sharing DOM Deduplication and Cleanup', () => {
    let dom;
    let window;
    let document;
    let videoMediaContainer;

    beforeEach(() => {
        dom = new JSDOM(`
            <!DOCTYPE html>
            <html>
                <body>
                    <div id="videoMediaContainer"></div>
                    <button id="screenShareBtn"></button>
                    <button id="initScreenShareBtn"></button>
                </body>
            </html>
        `);
        window = dom.window;
        document = window.document;
        videoMediaContainer = document.getElementById('videoMediaContainer');
    });

    // Helper simulating DOM insertion for local screen wrap with deduplication
    function addOrUpdateLocalScreenWrap() {
        // Deduplication rule from client.js: remove existing duplicate before creating
        const existing = videoMediaContainer.querySelectorAll('#myScreenWrap, .Screen#myScreenWrap');
        existing.forEach((el) => el.remove());

        const wrap = document.createElement('div');
        wrap.id = 'myScreenWrap';
        wrap.className = 'Screen';

        const video = document.createElement('video');
        video.id = 'myScreen';
        video.autoplay = true;

        const pinBtn = document.createElement('button');
        pinBtn.id = 'myScreenPinBtn';

        const dropdown = document.createElement('div');
        dropdown.id = 'myScreenDropdownBtn';
        dropdown._dropdownContent = document.createElement('div');
        dropdown._dropdownContent.id = 'myScreenDropdownMenu';
        document.body.appendChild(dropdown._dropdownContent);

        wrap.appendChild(video);
        wrap.appendChild(pinBtn);
        wrap.appendChild(dropdown);
        videoMediaContainer.appendChild(wrap);

        return wrap;
    }

    // Helper simulating remote media wrap with deduplication
    function addOrUpdateRemoteMediaWrap(peerId, type = 'video') {
        const wrapId = `${peerId}_${type}Wrap`;
        const existing = document.getElementById(wrapId);
        if (existing) existing.remove();

        const wrap = document.createElement('div');
        wrap.id = wrapId;
        wrap.className = type === 'screen' ? 'Screen' : 'Video';

        videoMediaContainer.appendChild(wrap);
        return wrap;
    }

    // Helper simulating stopScreenSharing DOM teardown
    function teardownLocalScreenDOM(state) {
        state.isScreenStreaming = false;
        state.myScreenStatus = false;

        const myScreenWrap = document.getElementById('myScreenWrap');
        const myScreenPinBtn = document.getElementById('myScreenPinBtn');

        if (myScreenWrap && state.isVideoPinned && state.pinnedVideoPlayerId === 'myScreen') {
            state.unpinTriggered = true;
            state.isVideoPinned = false;
            state.pinnedVideoPlayerId = null;
        }

        const screenWraps = document.querySelectorAll('#myScreenWrap, .Screen#myScreenWrap');
        screenWraps.forEach((wrap) => {
            const dropdown = wrap.querySelector('#myScreenDropdownBtn') || document.getElementById('myScreenDropdownBtn');
            if (dropdown && dropdown._dropdownContent) {
                dropdown._dropdownContent.remove();
            }
            wrap.remove();
        });
    }

    it('1. should never allow duplicate #myScreenWrap in videoMediaContainer on repeated calls', () => {
        // Simulate rapid or repeated calls to add screen share
        addOrUpdateLocalScreenWrap();
        addOrUpdateLocalScreenWrap();
        addOrUpdateLocalScreenWrap();

        const wraps = videoMediaContainer.querySelectorAll('#myScreenWrap');
        wraps.length.should.equal(1, 'There must be strictly ONE #myScreenWrap in the DOM');
        videoMediaContainer.childElementCount.should.equal(1);
    });

    it('2. should deduplicate remote peer screen wraps', () => {
        const peerId = 'peer_charlie_123';
        addOrUpdateRemoteMediaWrap(peerId, 'screen');
        addOrUpdateRemoteMediaWrap(peerId, 'screen');

        const wraps = videoMediaContainer.querySelectorAll(`#${peerId}_screenWrap`);
        wraps.length.should.equal(1, 'Remote screen wrap must be unique');
    });

    it('3. should maintain separate wraps for remote camera and remote screen sharing', () => {
        const peerId = 'peer_david_456';
        addOrUpdateRemoteMediaWrap(peerId, 'video');
        addOrUpdateRemoteMediaWrap(peerId, 'screen');

        videoMediaContainer.childElementCount.should.equal(2);
        document.getElementById(`${peerId}_videoWrap`).should.not.be.null();
        document.getElementById(`${peerId}_screenWrap`).should.not.be.null();
    });

    it('4. should automatically trigger unpinning when stopping pinned screen share', () => {
        addOrUpdateLocalScreenWrap();

        const state = {
            isScreenStreaming: true,
            myScreenStatus: true,
            isVideoPinned: true,
            pinnedVideoPlayerId: 'myScreen',
            unpinTriggered: false,
        };

        teardownLocalScreenDOM(state);

        state.unpinTriggered.should.be.true('Unpin must be called when the pinned screen share stops');
        state.isVideoPinned.should.be.false();
        (document.getElementById('myScreenWrap') === null).should.be.true();
    });

    it('5. should clean up screen dropdown menus attached to body on teardown', () => {
        addOrUpdateLocalScreenWrap();
        (document.getElementById('myScreenDropdownMenu') !== null).should.be.true();

        teardownLocalScreenDOM({ isVideoPinned: false });

        (document.getElementById('myScreenDropdownMenu') === null).should.be.true(
            'Attached dropdown menu must be removed from document on screen stop'
        );
        videoMediaContainer.childElementCount.should.equal(0);
    });
});
