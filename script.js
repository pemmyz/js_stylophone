document.addEventListener('DOMContentLoaded', () => {
    // --- Global Variables & DOM Elements ---
    let audioContext;
    let voices = []; // Array to hold all voice objects
    let lastInteractedVoice = null;
    let pwmPeriodicWave = null;

    // --- Global Controls ---
    const waveformSelect = document.getElementById('waveform-select');
    const volumeSlider = document.getElementById('volume-slider');
    const octaveShiftDisplay = document.getElementById('octave-shift-display');
    const snapToNoteCheckbox = document.getElementById('snap-to-note-checkbox');
    const addSliderBtn = document.getElementById('add-slider-btn');

    // --- Other DOM Elements ---
    const statusDiv = document.getElementById('audio-status');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const body = document.body;
    const multiSliderContainer = document.getElementById('multi-slider-container');
    const sliderTemplate = document.getElementById('slider-template');

    // --- Global State ---
    let globalVolume = parseFloat(volumeSlider.value);
    let octaveShift = 0;
    let sustainPedalActive = false;

    // --- Constants ---
    const attackTime = 0.015;
    const releaseTime = 0.15;
    const PITCH_SLIDER_BASE_MIN_FREQ = 110; // A2
    const PITCH_SLIDER_OCTAVES = 3;
    const PITCH_SLIDER_BASE_MAX_FREQ = PITCH_SLIDER_BASE_MIN_FREQ * Math.pow(2, PITCH_SLIDER_OCTAVES);
    const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const FM_MODULATOR_RATIO = 1.4;
    const FM_MODULATION_INDEX_SCALE = 2.0;
    const AM_MODULATOR_FREQ = 7;
    const AM_MODULATION_DEPTH = 0.7;
    const RING_MOD_RATIO = 0.78;
    const PWM_REAL_COEFFS = new Float32Array([0, 0.8, 0.8, 0.4, 0, -0.4, -0.8, -0.8]);
    const PWM_IMAG_COEFFS = new Float32Array(PWM_REAL_COEFFS.length).fill(0);


    // --- Dark Mode ---
    function setDarkMode(enabled) {
        if (enabled) {
            body.classList.remove('light-mode');
            darkModeToggle.textContent = '☀️ Light Mode';
            localStorage.setItem('stylophoneDarkMode', 'enabled');
        } else {
            body.classList.add('light-mode');
            darkModeToggle.textContent = '🌙 Dark Mode';
            localStorage.setItem('stylophoneDarkMode', 'disabled');
        }
    }
    darkModeToggle.addEventListener('click', () => {
        setDarkMode(body.classList.contains('light-mode'));
        darkModeToggle.blur();
    });
    if (localStorage.getItem('stylophoneDarkMode') === 'disabled') {
        setDarkMode(false);
    } else {
        setDarkMode(true);
    }

    // --- Audio Initialization & Status ---
    function updateAudioStatus(message = '', type = '') {
        if (!statusDiv) return;
        const currentStatus = audioContext ? audioContext.state : 'uninitialized';
        if (type === 'error') {
            statusDiv.textContent = message || "Error initializing audio.";
            statusDiv.className = 'error';
        } else if (currentStatus === 'running') {
            statusDiv.textContent = message || "Audio Ready";
            statusDiv.className = 'ready';
        } else if (currentStatus === 'suspended') {
            statusDiv.textContent = message || "Click or use slider to enable audio";
            statusDiv.className = 'suspended';
        } else if (currentStatus === 'closed') {
            statusDiv.textContent = message || "Audio context closed.";
            statusDiv.className = 'error';
        } else {
            statusDiv.textContent = message || "Audio not initialized.";
            statusDiv.className = 'error';
        }
    }

    function initializeAudio() {
        return new Promise((resolve, reject) => {
            if (audioContext && audioContext.state === 'running') {
                resolve(); return;
            }
            try {
                if (!audioContext) {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)({
                        latencyHint: 'interactive', sampleRate: 44100
                    });
                }
                audioContext.resume().then(() => {
                    if (!pwmPeriodicWave && audioContext) {
                         pwmPeriodicWave = audioContext.createPeriodicWave(PWM_REAL_COEFFS, PWM_IMAG_COEFFS, { disableNormalization: false });
                    }
                    voices.forEach(voice => { if (!voice.audio.mainOscillator) setupAudioNodes(voice); });
                    updateAudioStatus();
                    resolve();
                }).catch(e => {
                    updateAudioStatus("Error resuming audio.", "error");
                    console.error("Audio resume error:", e); reject(e);
                });
            } catch (e) {
                updateAudioStatus("Web Audio API not supported.", "error");
                console.error("Web Audio API error:", e); reject(e);
            }
        });
    }

    function cleanupPreviousNodes(voice) {
        Object.values(voice.audio).forEach(node => {
            if (node) {
                try { node.stop(); } catch (e) {}
                try { node.disconnect(); } catch (e) {}
            }
        });
        voice.audio = {};
    }

    function setupAudioNodes(voice) {
        if (!audioContext || audioContext.state !== 'running') return;
        const wasPlaying = voice.state.soundPlaying;
        if (wasPlaying && voice.audio.mainGainNode) {
            voice.audio.mainGainNode.gain.setValueAtTime(0, audioContext.currentTime);
        }
        cleanupPreviousNodes(voice);

        const currentWaveform = waveformSelect.value;
        const audio = voice.audio; // a shorter reference
        audio.mainOscillator = audioContext.createOscillator();
        audio.mainGainNode = audioContext.createGain();
        audio.mainGainNode.connect(audioContext.destination);
        audio.mainGainNode.gain.setValueAtTime(0, audioContext.currentTime);

        switch (currentWaveform) {
            case 'sine': case 'square': case 'sawtooth': case 'triangle':
                audio.mainOscillator.type = currentWaveform;
                audio.mainOscillator.connect(audio.mainGainNode);
                break;
            case 'pwm':
                if (!pwmPeriodicWave) {
                    pwmPeriodicWave = audioContext.createPeriodicWave(PWM_REAL_COEFFS, PWM_IMAG_COEFFS, { disableNormalization: false });
                }
                audio.mainOscillator.setPeriodicWave(pwmPeriodicWave);
                audio.mainOscillator.connect(audio.mainGainNode);
                break;
            case 'fm':
                audio.mainOscillator.type = 'sine';
                audio.modulatorOsc1 = audioContext.createOscillator();
                audio.modulatorOsc1.type = 'sine';
                audio.modGain1 = audioContext.createGain();
                audio.modulatorOsc1.connect(audio.modGain1);
                audio.modGain1.connect(audio.mainOscillator.frequency);
                audio.mainOscillator.connect(audio.mainGainNode);
                audio.modulatorOsc1.start();
                break;
            case 'am':
                audio.mainOscillator.type = 'sine';
                audio.modulatorOsc1 = audioContext.createOscillator();
                audio.modulatorOsc1.type = 'sine';
                audio.modulatorOsc1.frequency.value = AM_MODULATOR_FREQ;
                audio.modGain1 = audioContext.createGain();
                audio.dcOffsetNodeAM = audioContext.createConstantSource();
                audio.dcOffsetNodeAM.offset.value = 1.0 - (AM_MODULATION_DEPTH / 2);
                audio.dcOffsetNodeAM.start();
                audio.modulatorScaleGainAM = audioContext.createGain();
                audio.modulatorScaleGainAM.gain.value = AM_MODULATION_DEPTH / 2;
                audio.modulatorOsc1.connect(audio.modulatorScaleGainAM);
                audio.dcOffsetNodeAM.connect(audio.modGain1.gain);
                audio.modulatorScaleGainAM.connect(audio.modGain1.gain);
                audio.mainOscillator.connect(audio.modGain1);
                audio.modGain1.connect(audio.mainGainNode);
                audio.modulatorOsc1.start();
                break;
            case 'ring':
                audio.mainOscillator.type = 'sine';
                audio.modulatorOsc1 = audioContext.createOscillator();
                audio.modulatorOsc1.type = 'sine';
                audio.modGain1 = audioContext.createGain();
                audio.modulatorOsc1.connect(audio.modGain1.gain);
                audio.mainOscillator.connect(audio.modGain1);
                audio.modGain1.connect(audio.mainGainNode);
                audio.modulatorOsc1.start();
                break;
            default:
                audio.mainOscillator.type = 'square';
                audio.mainOscillator.connect(audio.mainGainNode);
                break;
        }
        audio.mainOscillator.start();

        if (wasPlaying) {
            updatePitchDisplayAndOscillator(voice);
            audio.mainGainNode.gain.setValueAtTime(globalVolume, audioContext.currentTime);
        } else {
             updatePitchDisplayAndOscillator(voice);
        }
    }

    // --- Pitch & Note Calculation ---
    function calculateFrequency(voice) {
        const sliderVal = parseFloat(voice.elements.pitchSlider.value);
        const sliderMin = parseFloat(voice.elements.pitchSlider.min);
        const sliderMax = parseFloat(voice.elements.pitchSlider.max);
        const normalizedPosition = (sliderVal - sliderMin) / (sliderMax - sliderMin);
        const currentMinFreq = PITCH_SLIDER_BASE_MIN_FREQ * Math.pow(2, octaveShift);
        const currentMaxFreq = PITCH_SLIDER_BASE_MAX_FREQ * Math.pow(2, octaveShift);
        let freq = currentMinFreq * Math.pow(currentMaxFreq / currentMinFreq, normalizedPosition);
        return freq;
    }

    function frequencyToNoteNameWithOctave(freq) {
        if (freq <= 0) return "";
        const noteNum = 12 * (Math.log2(freq / 440)) + 69;
        const roundedNoteNum = Math.round(noteNum);
        const noteIndex = roundedNoteNum % 12;
        const octaveVal = Math.floor(roundedNoteNum / 12) - 1;
        return NOTE_NAMES[noteIndex] + octaveVal;
    }

    function updatePitchDisplayAndOscillator(voice) {
        const freq = calculateFrequency(voice);
        const audio = voice.audio;
        const elements = voice.elements;

        if (audioContext && audioContext.state === 'running' && audio.mainOscillator) {
            audio.mainOscillator.frequency.setTargetAtTime(freq, audioContext.currentTime, 0.002);
            if (audio.modulatorOsc1 && audio.modGain1) {
                switch (waveformSelect.value) {
                    case 'fm':
                        audio.modulatorOsc1.frequency.setTargetAtTime(freq * FM_MODULATOR_RATIO, audioContext.currentTime, 0.002);
                        audio.modGain1.gain.setTargetAtTime(freq * FM_MODULATION_INDEX_SCALE, audioContext.currentTime, 0.002);
                        break;
                    case 'ring':
                        audio.modulatorOsc1.frequency.setTargetAtTime(freq * RING_MOD_RATIO, audioContext.currentTime, 0.002);
                        break;
                }
            }
        }
        elements.noteDisplay.textContent = frequencyToNoteNameWithOctave(freq);
        elements.freqDisplay.textContent = `${freq.toFixed(2)} Hz`;
        voice.state.lastPlayedFrequency = freq;

        if (!voice.state.soundPlaying && !voice.state.isSliderInteractionActive && !sustainPedalActive) {
             elements.noteDisplay.textContent = " ";
        }
    }

    // --- Sound Control ---
    function startSound(voice) {
        if (!voice.state.isSliderInteractionActive) return;
        initializeAudio().then(() => {
            if (!voice.audio.mainOscillator || !voice.audio.mainGainNode) {
                setupAudioNodes(voice);
            }
            updatePitchDisplayAndOscillator(voice);
            const now = audioContext.currentTime;
            voice.audio.mainGainNode.gain.cancelScheduledValues(now);
            voice.audio.mainGainNode.gain.setValueAtTime(voice.audio.mainGainNode.gain.value, now);
            voice.audio.mainGainNode.gain.linearRampToValueAtTime(globalVolume, now + attackTime);
            voice.state.soundPlaying = true;
        }).catch(err => console.error("Audio init failed on startSound:", err));
    }

    function stopSound(voice) {
        if (sustainPedalActive && voice === lastInteractedVoice) {
            return; // Don't stop the last played note if sustain is on
        }
        if (voice.audio.mainGainNode && audioContext && audioContext.state === 'running') {
            const now = audioContext.currentTime;
            voice.audio.mainGainNode.gain.cancelScheduledValues(now);
            const currentGain = voice.audio.mainGainNode.gain.value;
            voice.audio.mainGainNode.gain.setValueAtTime(currentGain, now);
            voice.audio.mainGainNode.gain.linearRampToValueAtTime(0.0001, now + releaseTime);
            voice.state.soundPlaying = false;
            setTimeout(() => {
                if (!voice.state.soundPlaying && !voice.state.isSliderInteractionActive && !sustainPedalActive) {
                     voice.elements.noteDisplay.textContent = " ";
                     voice.elements.freqDisplay.textContent = "";
                }
            }, releaseTime * 1000 + 50);
        } else {
             updatePitchDisplayAndOscillator(voice);
        }
    }

    // --- Note Markers for Pitch Slider ---
    function drawNoteMarkers(voice) {
        const noteMarkerBar = voice.elements.noteMarkerBar;
        noteMarkerBar.innerHTML = '';
        for (let midiNote = 21; midiNote < 21 + (PITCH_SLIDER_OCTAVES + 2) * 12; midiNote++) {
            const freqOfMarker = 440 * Math.pow(2, (midiNote - 69) / 12);
            if (freqOfMarker >= PITCH_SLIDER_BASE_MIN_FREQ * 0.95 && freqOfMarker <= PITCH_SLIDER_BASE_MAX_FREQ * 1.05) {
                const normalizedPosition = Math.log(freqOfMarker / PITCH_SLIDER_BASE_MIN_FREQ) / Math.log(PITCH_SLIDER_BASE_MAX_FREQ / PITCH_SLIDER_BASE_MIN_FREQ);
                if (normalizedPosition >= -0.01 && normalizedPosition <= 1.01) {
                    const noteName = NOTE_NAMES[midiNote % 12];
                    const marker = document.createElement('span');
                    marker.classList.add('note-marker');
                    marker.textContent = noteName;
                    if (noteName.length === 1) marker.classList.add('natural');
                    if (noteName === "C") marker.classList.add('root');
                    marker.style.left = `${Math.max(0, Math.min(100, normalizedPosition * 100))}%`;
                    noteMarkerBar.appendChild(marker);
                }
            }
        }
    }


    // --- Voice Creation ---
    function createVoice() {
        const voiceFragment = sliderTemplate.content.cloneNode(true);
        const container = voiceFragment.querySelector('.synth-pitch-control-container');
        const pitchSlider = container.querySelector('.pitch-slider');
        
        const voice = {
            elements: {
                container,
                pitchSlider,
                noteMarkerBar: container.querySelector('.note-marker-bar'),
                noteDisplay: container.querySelector('.note-display'),
                freqDisplay: container.querySelector('.freq-display'),
            },
            audio: {},
            state: {
                isSliderInteractionActive: false,
                soundPlaying: false,
                lastPlayedFrequency: 0,
            }
        };

        const initialTargetFreq = PITCH_SLIDER_BASE_MIN_FREQ * Math.pow(2, PITCH_SLIDER_OCTAVES / 3.5);
        let initialNormPos = 0;
        if (PITCH_SLIDER_BASE_MAX_FREQ > PITCH_SLIDER_BASE_MIN_FREQ) {
             initialNormPos = Math.log(initialTargetFreq / PITCH_SLIDER_BASE_MIN_FREQ) /
                               Math.log(PITCH_SLIDER_BASE_MAX_FREQ / PITCH_SLIDER_BASE_MIN_FREQ);
        }
        initialNormPos = Math.max(0, Math.min(1, initialNormPos));
        pitchSlider.value = String(parseFloat(pitchSlider.min) + initialNormPos * (parseFloat(pitchSlider.max) - parseFloat(pitchSlider.min)));

        function handleSliderInteractionStart(event) {
            if (event.type === 'touchstart') event.preventDefault();
            voice.state.isSliderInteractionActive = true;
            lastInteractedVoice = voice;
            startSound(voice);
        }

        function handleSliderInteractionEnd() {
            voice.state.isSliderInteractionActive = false;
            stopSound(voice);
        }

        pitchSlider.addEventListener('input', () => {
            if (audioContext && audioContext.state === 'suspended') initializeAudio();
            lastInteractedVoice = voice;

            if (snapToNoteCheckbox.checked) {
                const freq = calculateFrequency(voice);
                const noteNum = 12 * (Math.log2(freq / 440)) + 69;
                const roundedNoteNum = Math.round(noteNum);
                const snappedFreq = 440 * Math.pow(2, (roundedNoteNum - 69) / 12);
                const currentMinFreq = PITCH_SLIDER_BASE_MIN_FREQ * Math.pow(2, octaveShift);
                const currentMaxFreq = PITCH_SLIDER_BASE_MAX_FREQ * Math.pow(2, octaveShift);
                if (snappedFreq >= currentMinFreq && snappedFreq <= currentMaxFreq) {
                    const normalizedPosition = Math.log(snappedFreq / currentMinFreq) / Math.log(currentMaxFreq / currentMinFreq);
                    const sliderMin = parseFloat(pitchSlider.min);
                    const sliderMax = parseFloat(pitchSlider.max);
                    pitchSlider.value = sliderMin + normalizedPosition * (sliderMax - sliderMin);
                }
            }
            updatePitchDisplayAndOscillator(voice);
            if (voice.state.isSliderInteractionActive && !voice.state.soundPlaying) {
                startSound(voice);
            }
        });

        pitchSlider.addEventListener('mousedown', handleSliderInteractionStart);
        pitchSlider.addEventListener('touchstart', handleSliderInteractionStart, { passive: false });

        // Global listeners for mouse/touch release
        document.addEventListener('mouseup', () => { if(voice.state.isSliderInteractionActive) handleSliderInteractionEnd(); });
        document.addEventListener('touchend', () => { if(voice.state.isSliderInteractionActive) handleSliderInteractionEnd(); });

        multiSliderContainer.appendChild(voiceFragment);
        voices.push(voice);
        drawNoteMarkers(voice);
        if (audioContext && audioContext.state === 'running') {
            setupAudioNodes(voice);
        }
    }

    // --- Global Control Handlers ---
    volumeSlider.addEventListener('input', () => {
        globalVolume = parseFloat(volumeSlider.value);
        voices.forEach(voice => {
            if (voice.state.soundPlaying && voice.audio.mainGainNode) {
                 voice.audio.mainGainNode.gain.setTargetAtTime(globalVolume, audioContext.currentTime, 0.01);
            }
        });
    });
    volumeSlider.addEventListener('change', () => volumeSlider.blur());

    waveformSelect.addEventListener('change', () => {
        waveformSelect.blur();
        if (audioContext && audioContext.state === 'running') {
            voices.forEach(voice => setupAudioNodes(voice));
        }
    });

    addSliderBtn.addEventListener('click', () => {
        createVoice();
        addSliderBtn.blur();
    });

    window.addEventListener('keydown', (event) => {
        if (event.repeat) return;
        const activeElement = document.activeElement;
        const isSliderFocused = activeElement && activeElement.type === 'range';
        
        if (event.code === "ArrowUp" || event.code === "ArrowDown") {
            if (isSliderFocused) return;
            event.preventDefault();
            if (audioContext && audioContext.state === 'suspended') initializeAudio();
            octaveShift += (event.code === "ArrowUp" ? 1 : -1);
            octaveShiftDisplay.textContent = octaveShift;
            voices.forEach(voice => updatePitchDisplayAndOscillator(voice));
            return;
        } else if (event.code === "Space") {
            event.preventDefault();
            if (audioContext && audioContext.state === 'suspended') initializeAudio();
            if (!sustainPedalActive) {
                sustainPedalActive = true;
                if (lastInteractedVoice && !lastInteractedVoice.state.soundPlaying) {
                    // Re-trigger the last played note
                    initializeAudio().then(() => {
                        const voice = lastInteractedVoice;
                        if (!voice.audio.mainOscillator) setupAudioNodes(voice);
                        voice.audio.mainOscillator.frequency.setValueAtTime(voice.state.lastPlayedFrequency, audioContext.currentTime);
                        updatePitchDisplayAndOscillator(voice); // Refresh display for this freq
                        const now = audioContext.currentTime;
                        voice.audio.mainGainNode.gain.cancelScheduledValues(now);
                        voice.audio.mainGainNode.gain.setValueAtTime(0, now);
                        voice.audio.mainGainNode.gain.linearRampToValueAtTime(globalVolume, now + attackTime);
                        voice.state.soundPlaying = true;
                    });
                }
            }
            return;
        }
    });

    window.addEventListener('keyup', (event) => {
        if (event.code === "Space") {
            event.preventDefault();
            sustainPedalActive = false;
            // Stop any voices that were being sustained but are no longer being actively touched
            voices.forEach(voice => {
                if (voice.state.soundPlaying && !voice.state.isSliderInteractionActive) {
                    stopSound(voice);
                }
            });
        }
    });

    // --- Initial Page Setup ---
    function initialSetup() {
        if (!(window.AudioContext || window.webkitAudioContext)) {
            updateAudioStatus("Browser doesn't support Web Audio API.", "error");
            document.querySelectorAll('input, select, button').forEach(el => el.disabled = true);
            return;
        }
        updateAudioStatus("Initializing...");
        initializeAudio().then(() => {
            if (voices.length === 0) createVoice();
            voices.forEach(updatePitchDisplayAndOscillator);
        }).catch(err => {});

        const initAudioOnFirstGesture = () => {
            if (audioContext && audioContext.state === 'suspended') {
                initializeAudio().then(() => {
                    document.body.removeEventListener('click', initAudioOnFirstGesture, true);
                    document.body.removeEventListener('touchstart', initAudioOnFirstGesture, true);
                });
            } else if (audioContext && audioContext.state === 'running') {
                document.body.removeEventListener('click', initAudioOnFirstGesture, true);
                document.body.removeEventListener('touchstart', initAudioOnFirstGesture, true);
            }
        };
        document.body.addEventListener('click', initAudioOnFirstGesture, { capture: true, once: false });
        document.body.addEventListener('touchstart', initAudioOnFirstGesture, { capture: true, once: false });
    }

    initialSetup();
});
