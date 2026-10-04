'use strict';

/**
 * tests/test-dataChannelThrottling.js
 * Comprehensive tests for AudioWorklet VolumeProcessor rate-limiting,
 * SCTP DataChannel buffer overflow prevention, and silence gating.
 */

require('should');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('Pillar 5: DataChannel SCTP Message Throttling & Audio Worklet Processing', () => {
    let VolumeProcessorClass;
    let sandbox;

    before(() => {
        // Load and evaluate VolumeProcessor in a mocked AudioWorklet environment
        const processorCode = fs.readFileSync(
            path.join(__dirname, '..', 'public', 'js', 'volumeProcessor.js'),
            'utf8'
        );

        let registeredClass = null;

        sandbox = {
            AudioWorkletProcessor: class {},
            registerProcessor: (name, cls) => {
                if (name === 'volume-processor') registeredClass = cls;
            },
            currentTime: 0,
        };

        vm.createContext(sandbox);
        vm.runInContext(processorCode, sandbox);

        registeredClass.should.be.a.Function();
        VolumeProcessorClass = registeredClass;
    });

    function createProcessor(options = {}) {
        const processor = new VolumeProcessorClass({
            processorOptions: {
                peerId: 'peer-test-1',
                threshold: 10,
                silenceThreshold: 0.01,
                ...options,
            },
        });
        processor.port = {
            messages: [],
            postMessage(msg) {
                this.messages.push(msg);
            },
        };
        return processor;
    }

    function createAudioBlock(sampleCount = 128, amplitude = 0.5) {
        const samples = new Float32Array(sampleCount);
        for (let i = 0; i < sampleCount; i++) {
            // Generate a sine wave or constant amplitude
            samples[i] = amplitude * Math.sin((2 * Math.PI * i) / 32);
        }
        return [[samples]];
    }

    it('1. should initialize with default thresholds and empty send time', () => {
        const p = createProcessor();
        p.threshold.should.equal(10);
        p.silenceThreshold.should.equal(0.01);
        p.peerId.should.equal('peer-test-1');
        p.lastSendTime.should.equal(0);
    });

    it('2. should throttle ~375 audio blocks/sec to <= 20 messages/sec over DataChannel', () => {
        const p = createProcessor({ threshold: 5 });
        const loudAudio = createAudioBlock(128, 0.8);

        // Simulate 48,000 samples at 128 samples per block = 375 calls per second
        // Block duration = 128 / 48000 = 0.002666... seconds
        const blockDuration = 128 / 48000;
        let simTime = 0.0;
        const totalCalls = 375;

        for (let i = 0; i < totalCalls; i++) {
            simTime += blockDuration;
            // Set global currentTime in mock scope
            sandbox.currentTime = simTime;
            p.process(loudAudio, [], {});
        }

        const micVolumeMsgs = p.port.messages.filter((m) => m.type === 'micVolume');

        // At 50ms intervals (0.05s), 1 second should produce exactly ~20 messages
        micVolumeMsgs.length.should.be.greaterThan(18);
        micVolumeMsgs.length.should.be.lessThanOrEqual(21);

        // Verify message payload structure
        const firstMsg = micVolumeMsgs[0];
        firstMsg.type.should.equal('micVolume');
        firstMsg.peer_id.should.equal('peer-test-1');
        firstMsg.volume.should.be.greaterThan(5);
    });

    it('3. should gate completely silent audio and not emit micVolume messages', () => {
        const p = createProcessor({ threshold: 10 });
        const silentAudio = createAudioBlock(128, 0.0);

        let simTime = 0.0;
        for (let i = 0; i < 100; i++) {
            simTime += 0.05;
            sandbox.currentTime = simTime;
            p.process(silentAudio, [], {});
        }

        const micVolumeMsgs = p.port.messages.filter((m) => m.type === 'micVolume');
        micVolumeMsgs.should.have.length(0, 'Silent audio should never emit micVolume messages');
    });

    it('4. should emit volumeIndicator but not micVolume when volume is between silence and mic threshold', () => {
        const p = createProcessor({ threshold: 50, silenceThreshold: 0.01 });
        // Low amplitude: rms around ~0.05 -> volume around ~0.5 -> finalVolume around 20-30 (< 50)
        const lowAudio = createAudioBlock(128, 0.05);

        sandbox.currentTime = 0.1;
        p.process(lowAudio, [], {});

        const micVolumeMsgs = p.port.messages.filter((m) => m.type === 'micVolume');
        const indicatorMsgs = p.port.messages.filter((m) => m.type === 'volumeIndicator');

        micVolumeMsgs.should.have.length(0);
        indicatorMsgs.length.should.be.greaterThan(0);
    });

    it('5. should safely handle empty or null audio input blocks without crashing', () => {
        const p = createProcessor();
        sandbox.currentTime = 0.1;

        p.process([], [], {}).should.be.true();
        p.process([[]], [], {}).should.be.true();
        p.process([[new Float32Array(0)]], [], {}).should.be.true();

        p.port.messages.should.have.length(0);
    });
});
