document.addEventListener('DOMContentLoaded', () => {
    // --- Global Variables & DOM Elements ---
    let audioContext;
    let mainOscillator = null;
    let mainGainNode = null;
    let modulatorOsc1 = null;
    let modGain1 = null;
    let dcOffsetNodeAM = null;
    let modulatorScaleGainAM = null;
    let pwmPeriodicWave = null;

    let isSliderInteractionActive = false;
    let soundPlaying = false;

    const pitchSlider = document.getElementById('pitch-slider');
    const noteMarkerBar = document.getElementById('note-marker-bar');

    const waveformSelect = document.getElementById('waveform-select');
    const volumeSlider = document.getElementById('volume-slider');
    const octaveShiftDisplay = document.getElementById('octave-shift-display');
    const noteDisplay = document.getElementById('note-display');
    const freqDisplay = document.getElementById('freq-display');
    const statusDiv = document.getElementById('audio-status');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const body = document.body;

    let currentWaveform = waveformSelect.value;
    let globalVolume = parseFloat(volumeSlider.value);
    let octaveShift = 0;
    let sustainPedalActive = false;
    let lastPlayedFrequency = 0;

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
                if (!mainOscillator) setupAudioNodes();
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
                    if (!mainOscillator) setupAudioNodes();
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

    function cleanupPreviousNodes() {
        if (mainOscillator) {
            try { mainOscillator.stop(); } catch (e) {}
            try { mainOscillator.disconnect(); } catch (e) {}
            mainOscillator = null;
        }
        if (modulatorOsc1) {
            try { modulatorOsc1.stop(); } catch (e) {}
            try { modulatorOsc1.disconnect(); } catch (e) {}
            modulatorOsc1 = null;
        }
        if (modGain1) {
            try { modGain1.disconnect(); } catch (e) {}
            modGain1 = null;
        }
        if (dcOffsetNodeAM) {
            try { dcOffsetNodeAM.stop(); } catch (e) {}
            try { dcOffsetNodeAM.disconnect(); } catch (e) {}
            dcOffsetNodeAM = null;
        }
        if (modulatorScaleGainAM) {
            try { modulatorScaleGainAM.disconnect(); } catch (e) {}
            modulatorScaleGainAM = null;
        }
        if (mainGainNode) {
            try { mainGainNode.disconnect(); } catch(e) {}
        }
    }

    function setupAudioNodes() {
        if (!audioContext || audioContext.state !== 'running') return;
        const wasPlaying = soundPlaying;
        if (wasPlaying && mainGainNode) {
            mainGainNode.gain.setValueAtTime(0, audioContext.currentTime);
        }
        cleanupPreviousNodes();
        mainOscillator = audioContext.createOscillator();
        mainGainNode = audioContext.createGain();
        mainGainNode.connect(audioContext.destination);
        mainGainNode.gain.setValueAtTime(0, audioContext.currentTime);

        switch (currentWaveform) {
            case 'sine': case 'square': case 'sawtooth': case 'triangle':
                mainOscillator.type = currentWaveform;
                mainOscillator.connect(mainGainNode);
                break;
            case 'pwm':
                if (!pwmPeriodicWave) {
                    pwmPeriodicWave = audioContext.createPeriodicWave(PWM_REAL_COEFFS, PWM_IMAG_COEFFS, { disableNormalization: false });
                }
                mainOscillator.setPeriodicWave(pwmPeriodicWave);
                mainOscillator.connect(mainGainNode);
                break;
            case 'fm':
                mainOscillator.type = 'sine';
                modulatorOsc1 = audioContext.createOscillator();
                modulatorOsc1.type = 'sine';
                modGain1 = audioContext.createGain();
                modulatorOsc1.connect(modGain1);
                modGain1.connect(mainOscillator.frequency);
                mainOscillator.connect(mainGainNode);
                modulatorOsc1.start();
                break;
            case 'am':
                mainOscillator.type = 'sine';
                modulatorOsc1 = audioContext.createOscillator();
                modulatorOsc1.type = 'sine';
                modulatorOsc1.frequency.value = AM_MODULATOR_FREQ;
                modGain1 = audioContext.createGain();
                dcOffsetNodeAM = audioContext.createConstantSource();
                dcOffsetNodeAM.offset.value = 1.0 - (AM_MODULATION_DEPTH / 2);
                dcOffsetNodeAM.start();
                modulatorScaleGainAM = audioContext.createGain();
                modulatorScaleGainAM.gain.value = AM_MODULATION_DEPTH / 2;
                modulatorOsc1.connect(modulatorScaleGainAM);
                dcOffsetNodeAM.connect(modGain1.gain);
                modulatorScaleGainAM.connect(modGain1.gain);
                mainOscillator.connect(modGain1);
                modGain1.connect(mainGainNode);
                modulatorOsc1.start();
                break;
            case 'ring':
                mainOscillator.type = 'sine';
                modulatorOsc1 = audioContext.createOscillator();
                modulatorOsc1.type = 'sine';
                modGain1 = audioContext.createGain();
                modulatorOsc1.connect(modGain1.gain);
                mainOscillator.connect(modGain1);
                modGain1.connect(mainGainNode);
                modulatorOsc1.start();
                break;
            default:
                mainOscillator.type = 'square';
                mainOscillator.connect(mainGainNode);
                break;
        }
        mainOscillator.start();
        if (wasPlaying) {
            updatePitchDisplayAndOscillator();
            mainGainNode.gain.setValueAtTime(globalVolume, audioContext.currentTime);
        } else {
             updatePitchDisplayAndOscillator();
        }
    }

    // --- Pitch & Note Calculation ---
    function calculateFrequency() {
        const sliderVal = parseFloat(pitchSlider.value);
        const sliderMin = parseFloat(pitchSlider.min);
        const sliderMax = parseFloat(pitchSlider.max);
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

    function updatePitchDisplayAndOscillator() {
        const freq = calculateFrequency(); // Uses current octaveShift

        if (audioContext && audioContext.state === 'running') {
            if (mainOscillator) {
                 mainOscillator.frequency.setTargetAtTime(freq, audioContext.currentTime, 0.002);
            }
            if (modulatorOsc1 && modGain1) {
                switch (currentWaveform) {
                    case 'fm':
                        modulatorOsc1.frequency.setTargetAtTime(freq * FM_MODULATOR_RATIO, audioContext.currentTime, 0.002);
                        modGain1.gain.setTargetAtTime(freq * FM_MODULATION_INDEX_SCALE, audioContext.currentTime, 0.002);
                        break;
                    case 'ring':
                        modulatorOsc1.frequency.setTargetAtTime(freq * RING_MOD_RATIO, audioContext.currentTime, 0.002);
                        break;
                }
            }
        }
        noteDisplay.textContent = frequencyToNoteNameWithOctave(freq);
        freqDisplay.textContent = `${freq.toFixed(2)} Hz`;

        // Always update lastPlayedFrequency to reflect the current potential pitch
        // based on slider position and octave shift.
        lastPlayedFrequency = freq;

        // Adjust display logic for idle state AFTER lastPlayedFrequency is set
        if (!soundPlaying && !isSliderInteractionActive && !sustainPedalActive) {
             noteDisplay.textContent = " ";
             // freqDisplay.textContent = ""; // Optional: clear freq display when fully idle
        }
    }

    // --- Sound Control ---
    function startSound() {
        if (!isSliderInteractionActive) return;
        initializeAudio().then(() => {
            if (!mainOscillator || !mainGainNode) {
                setupAudioNodes();
            }
            updatePitchDisplayAndOscillator();
            const now = audioContext.currentTime;
            mainGainNode.gain.cancelScheduledValues(now);
            mainGainNode.gain.setValueAtTime(mainGainNode.gain.value, now);
            mainGainNode.gain.linearRampToValueAtTime(globalVolume, now + attackTime);
            soundPlaying = true;
        }).catch(err => console.error("Audio init failed on startSound:", err));
    }

    function stopSound() {
        if (sustainPedalActive) {
            if (mainGainNode && soundPlaying) {
                 mainGainNode.gain.setTargetAtTime(globalVolume, audioContext.currentTime, 0.01);
            }
            if (lastPlayedFrequency > 0) {
                noteDisplay.textContent = frequencyToNoteNameWithOctave(lastPlayedFrequency);
                freqDisplay.textContent = `${lastPlayedFrequency.toFixed(2)} Hz`;
            }
            return;
        }
        if (mainGainNode && audioContext && audioContext.state === 'running') {
            const now = audioContext.currentTime;
            mainGainNode.gain.cancelScheduledValues(now);
            const currentGain = mainGainNode.gain.value;
            mainGainNode.gain.setValueAtTime(currentGain, now);
            mainGainNode.gain.linearRampToValueAtTime(0.0001, now + releaseTime);
            soundPlaying = false;
            setTimeout(() => {
                if (!soundPlaying && !isSliderInteractionActive && !sustainPedalActive) {
                     noteDisplay.textContent = " ";
                     freqDisplay.textContent = "";
                }
            }, releaseTime * 1000 + 50);
        } else if (!soundPlaying && !isSliderInteractionActive && !sustainPedalActive) {
            updatePitchDisplayAndOscillator();
            if (!isSliderInteractionActive) {
                noteDisplay.textContent = " ";
                freqDisplay.textContent = "";
            }
        }
    }

    // --- Event Handlers for Pitch Slider ---
    function handleSliderInteractionStart(event) {
        if (event.type === 'touchstart' && event.target === pitchSlider) {
            event.preventDefault();
        }
        isSliderInteractionActive = true;
        startSound();
    }

    function handleSliderInteractionEnd() {
        isSliderInteractionActive = false;
        stopSound();
    }

    pitchSlider.addEventListener('input', () => {
        if (audioContext && audioContext.state === 'suspended') initializeAudio();
        updatePitchDisplayAndOscillator();
        if (isSliderInteractionActive && !soundPlaying) {
            startSound();
        }
    });
    pitchSlider.addEventListener('mousedown', handleSliderInteractionStart);
    pitchSlider.addEventListener('touchstart', handleSliderInteractionStart, { passive: false });

    document.addEventListener('mouseup', (event) => {
        if (isSliderInteractionActive) handleSliderInteractionEnd();
    });
    document.addEventListener('touchend', (event) => {
        if (isSliderInteractionActive) handleSliderInteractionEnd();
    });

    // --- UI Control Handlers (Volume, Waveform, Octave, Sustain) ---
    volumeSlider.addEventListener('input', () => {
        globalVolume = parseFloat(volumeSlider.value);
        if (soundPlaying && mainGainNode) {
             mainGainNode.gain.setTargetAtTime(globalVolume, audioContext.currentTime, 0.01);
        }
    });
    volumeSlider.addEventListener('change', () => volumeSlider.blur());

    waveformSelect.addEventListener('change', () => {
        currentWaveform = waveformSelect.value;
        waveformSelect.blur();
        if (audioContext && audioContext.state === 'running') {
            setupAudioNodes();
        }
    });

    window.addEventListener('keydown', (event) => {
        if (event.repeat) return; // Prevent action spam on key hold for all keys.

        // Handle global shortcuts (octave, sustain) first
        // These should work even if a control like the pitch slider has focus.
        if (event.code === "ArrowUp" || event.code === "ArrowDown") {
            event.preventDefault(); // Prevent page scrolling
            if (audioContext && audioContext.state === 'suspended') initializeAudio();
            if (event.code === "ArrowUp") octaveShift++;
            else octaveShift--;
            octaveShiftDisplay.textContent = octaveShift;
            updatePitchDisplayAndOscillator(); // This will apply the new octave immediately
            return; // Handled
        } else if (event.code === "Space") {
            event.preventDefault(); // Prevent page scrolling or button activation
            if (audioContext && audioContext.state === 'suspended') initializeAudio();

            if (!sustainPedalActive) {
                sustainPedalActive = true;
                if (isSliderInteractionActive && !soundPlaying) {
                    startSound();
                } else if (!isSliderInteractionActive && !soundPlaying && lastPlayedFrequency > 0) {
                    initializeAudio().then(() => {
                        if (!mainOscillator || !mainGainNode) setupAudioNodes();
                        // Ensure oscillator is set to the correct lastPlayedFrequency (which updatePitchDisplayAndOscillator now keeps current)
                        mainOscillator.frequency.setValueAtTime(lastPlayedFrequency, audioContext.currentTime);
                        updatePitchDisplayAndOscillator(); // Refresh display and modulator params for this freq

                        const now = audioContext.currentTime;
                        mainGainNode.gain.cancelScheduledValues(now);
                        mainGainNode.gain.setValueAtTime(0, now);
                        mainGainNode.gain.linearRampToValueAtTime(globalVolume, now + attackTime);
                        soundPlaying = true;
                    });
                } else if (soundPlaying) {
                    if (lastPlayedFrequency > 0) {
                        noteDisplay.textContent = frequencyToNoteNameWithOctave(lastPlayedFrequency);
                        freqDisplay.textContent = `${lastPlayedFrequency.toFixed(2)} Hz`;
                    }
                }
            }
            return; // Handled
        }

        // If it's not one of the above global keys, then check for focused controls
        // to prevent other keyboard interactions when user is focused on a slider/select.
        if (event.target === pitchSlider || event.target === volumeSlider || event.target === waveformSelect) {
            return;
        }

        // Any other unhandled key presses can go here if needed
    });

    window.addEventListener('keyup', (event) => {
        // Only handle spacebar keyup for sustain logic.
        // Arrow keys don't need keyup handling for octave shift.
        if (event.code === "Space") {
            event.preventDefault();
            sustainPedalActive = false;
            if (!isSliderInteractionActive && soundPlaying) {
                stopSound();
            }
        }
    });


    // --- Note Markers for Pitch Slider ---
    function drawNoteMarkers() {
        noteMarkerBar.innerHTML = '';
        for (let midiNote = 21; midiNote < 21 + (PITCH_SLIDER_OCTAVES + 2) * 12; midiNote++) {
            const freqOfMarker = 440 * Math.pow(2, (midiNote - 69) / 12);
            if (freqOfMarker >= PITCH_SLIDER_BASE_MIN_FREQ * 0.95 &&
                freqOfMarker <= PITCH_SLIDER_BASE_MAX_FREQ * 1.05) {
                const normalizedPosition = Math.log(freqOfMarker / PITCH_SLIDER_BASE_MIN_FREQ) /
                                           Math.log(PITCH_SLIDER_BASE_MAX_FREQ / PITCH_SLIDER_BASE_MIN_FREQ);
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


    // --- Initial Page Setup ---
    function initialSetup() {
        volumeSlider.value = String(globalVolume);
        octaveShiftDisplay.textContent = octaveShift;

        const initialTargetFreq = PITCH_SLIDER_BASE_MIN_FREQ * Math.pow(2, PITCH_SLIDER_OCTAVES / 3.5);
        let initialNormPos = 0;
        if (PITCH_SLIDER_BASE_MAX_FREQ > PITCH_SLIDER_BASE_MIN_FREQ) {
             initialNormPos = Math.log(initialTargetFreq / PITCH_SLIDER_BASE_MIN_FREQ) /
                               Math.log(PITCH_SLIDER_BASE_MAX_FREQ / PITCH_SLIDER_BASE_MIN_FREQ);
        }
        initialNormPos = Math.max(0, Math.min(1, initialNormPos));
        pitchSlider.value = String(parseFloat(pitchSlider.min) + initialNormPos * (parseFloat(pitchSlider.max) - parseFloat(pitchSlider.min)));

        if (!(window.AudioContext || window.webkitAudioContext)) {
            updateAudioStatus("Browser doesn't support Web Audio API.", "error");
            [pitchSlider, volumeSlider, waveformSelect, darkModeToggle].forEach(el => el.disabled = true);
            return;
        }

        updateAudioStatus("Initializing...");
        initializeAudio().then(() => {
            drawNoteMarkers();
            updatePitchDisplayAndOscillator();
        }).catch(err => {});

        const initAudioOnFirstGesture = (event) => {
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
