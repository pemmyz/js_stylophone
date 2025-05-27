document.addEventListener('DOMContentLoaded', () => {
    // --- Global Variables & DOM Elements ---
    let audioContext;
    let mainOscillator = null;
    let mainGainNode = null;
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
    });
    if (localStorage.getItem('stylophoneDarkMode') === 'disabled') {
        setDarkMode(false);
    } else {
        setDarkMode(true); // Default to dark
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

    function setupAudioNodes() {
        if (!audioContext || audioContext.state !== 'running') return;
        if (mainOscillator) mainOscillator.stop();
        if (mainGainNode) mainGainNode.disconnect();

        mainOscillator = audioContext.createOscillator();
        mainGainNode = audioContext.createGain();
        mainOscillator.type = currentWaveform;
        mainOscillator.connect(mainGainNode);
        mainGainNode.connect(audioContext.destination);
        mainGainNode.gain.setValueAtTime(0, audioContext.currentTime);
        mainOscillator.start();
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
        const freq = calculateFrequency();
        if (mainOscillator && audioContext && audioContext.state === 'running' && (soundPlaying || isSliderInteractionActive)) {
            mainOscillator.frequency.setTargetAtTime(freq, audioContext.currentTime, 0.002);
            lastPlayedFrequency = freq;
            noteDisplay.textContent = frequencyToNoteNameWithOctave(freq);
            freqDisplay.textContent = `${freq.toFixed(2)} Hz`;
        } else { // Update display even if not playing, based on slider position
            noteDisplay.textContent = frequencyToNoteNameWithOctave(freq);
            freqDisplay.textContent = `${freq.toFixed(2)} Hz`;
            if (!soundPlaying && !isSliderInteractionActive && !sustainPedalActive) { // If truly idle, clear note
                 noteDisplay.textContent = " "; // Keep freq based on slider or clear it too
                 // freqDisplay.textContent = ""; // Optional: clear freq when idle
            }
        }
    }

    // --- Sound Control ---
    function startSound() {
        if (!isSliderInteractionActive) return;
        initializeAudio().then(() => {
            if (!mainOscillator || !mainGainNode) setupAudioNodes();
            if (mainOscillator.type !== currentWaveform) mainOscillator.type = currentWaveform;
            updatePitchDisplayAndOscillator(); // This will also set the initial freq display

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
            // Ensure display stays on last sustained note/freq
            noteDisplay.textContent = frequencyToNoteNameWithOctave(lastPlayedFrequency);
            freqDisplay.textContent = `${lastPlayedFrequency.toFixed(2)} Hz`;
            return;
        }
        if (mainGainNode && audioContext && audioContext.state === 'running') {
            const now = audioContext.currentTime;
            mainGainNode.gain.cancelScheduledValues(now);
            // If gain is already low, don't ramp down from a potentially higher value
            const currentGain = mainGainNode.gain.value;
            mainGainNode.gain.setValueAtTime(currentGain, now);
            mainGainNode.gain.linearRampToValueAtTime(0.0001, now + releaseTime);
            soundPlaying = false;
            setTimeout(() => {
                if (!soundPlaying && !isSliderInteractionActive && !sustainPedalActive) {
                     noteDisplay.textContent = " ";
                     freqDisplay.textContent = ""; // Clear frequency display
                }
            }, releaseTime * 1000 + 50);
        } else if (!soundPlaying && !isSliderInteractionActive && !sustainPedalActive) {
            // If sound was never started or already stopped, ensure displays are cleared or reflect slider
            updatePitchDisplayAndOscillator(); // This will set displays based on current slider
            if (!isSliderInteractionActive) { // If truly idle
                noteDisplay.textContent = " ";
                freqDisplay.textContent = "";
            }
        }
    }

    // --- Event Handlers for Pitch Slider ---
    function handleSliderInteractionStart() {
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

    document.addEventListener('mouseup', handleSliderInteractionEnd);
    document.addEventListener('touchend', handleSliderInteractionEnd);


    // --- UI Control Handlers (Volume, Waveform, Octave, Sustain) ---
    volumeSlider.addEventListener('input', () => {
        globalVolume = parseFloat(volumeSlider.value);
        if (soundPlaying && mainGainNode) {
             mainGainNode.gain.setTargetAtTime(globalVolume, audioContext.currentTime, 0.01);
        }
    });

    waveformSelect.addEventListener('change', () => {
        currentWaveform = waveformSelect.value;
        if (mainOscillator) {
            mainOscillator.type = currentWaveform;
        }
    });

    window.addEventListener('keydown', (event) => {
        if (event.repeat) return;
        if (audioContext && audioContext.state === 'suspended') initializeAudio();

        if (event.code === "ArrowUp" || event.code === "ArrowDown") {
            if (event.code === "ArrowUp") octaveShift++;
            else octaveShift--;
            octaveShiftDisplay.textContent = octaveShift;
            updatePitchDisplayAndOscillator();
        } else if (event.code === "Space") {
            event.preventDefault();
            if (!sustainPedalActive) {
                sustainPedalActive = true;
                if (isSliderInteractionActive && !soundPlaying) { // Slider held, but sound off (e.g. after release then space)
                    startSound();
                } else if (!isSliderInteractionActive && !soundPlaying && lastPlayedFrequency > 0) { // Idle, but has a last note
                    initializeAudio().then(() => {
                        if (!mainOscillator || !mainGainNode) setupAudioNodes();
                        mainOscillator.frequency.setValueAtTime(lastPlayedFrequency, audioContext.currentTime);
                        noteDisplay.textContent = frequencyToNoteNameWithOctave(lastPlayedFrequency);
                        freqDisplay.textContent = `${lastPlayedFrequency.toFixed(2)} Hz`;

                        const now = audioContext.currentTime;
                        mainGainNode.gain.cancelScheduledValues(now);
                        mainGainNode.gain.setValueAtTime(0, now);
                        mainGainNode.gain.linearRampToValueAtTime(globalVolume, now + attackTime);
                        soundPlaying = true;
                    });
                } else if (soundPlaying) { // Already playing, ensure display is correct for sustained note
                    noteDisplay.textContent = frequencyToNoteNameWithOctave(lastPlayedFrequency);
                    freqDisplay.textContent = `${lastPlayedFrequency.toFixed(2)} Hz`;
                }
                 // If no sound and no last frequency, sustain does nothing until a note is played
            }
        }
    });
    window.addEventListener('keyup', (event) => {
        if (event.code === "Space") {
            event.preventDefault();
            sustainPedalActive = false;
            if (!isSliderInteractionActive && soundPlaying) { // If not holding slider and sound was on
                stopSound();
            }
            // If slider is active, sound continues, display is handled by slider 'input'
        }
    });


    // --- Note Markers for Pitch Slider ---
    function drawNoteMarkers() {
        noteMarkerBar.innerHTML = '';
        for (let midiNote = 21; midiNote < 21 + (PITCH_SLIDER_OCTAVES + 2) * 12; midiNote++) {
            const freqOfMarker = 440 * Math.pow(2, (midiNote - 69) / 12);
            if (freqOfMarker >= PITCH_SLIDER_BASE_MIN_FREQ * 0.95 && // Adjust tolerance if needed
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
    volumeSlider.value = String(globalVolume);
    octaveShiftDisplay.textContent = octaveShift;

    const initialTargetFreq = PITCH_SLIDER_BASE_MIN_FREQ * Math.pow(2, PITCH_SLIDER_OCTAVES / 3.5); // Slightly lower start
    let initialNormPos = 0;
    if (PITCH_SLIDER_BASE_MAX_FREQ > PITCH_SLIDER_BASE_MIN_FREQ) { // Avoid log(1) or log of negative
         initialNormPos = Math.log(initialTargetFreq / PITCH_SLIDER_BASE_MIN_FREQ) /
                           Math.log(PITCH_SLIDER_BASE_MAX_FREQ / PITCH_SLIDER_BASE_MIN_FREQ);
    }
    initialNormPos = Math.max(0, Math.min(1, initialNormPos)); // Clamp between 0 and 1
    pitchSlider.value = String(parseFloat(pitchSlider.min) + initialNormPos * (parseFloat(pitchSlider.max) - parseFloat(pitchSlider.min)));


    if (!(window.AudioContext || window.webkitAudioContext)) {
        updateAudioStatus("Browser doesn't support Web Audio API.", "error");
    } else {
        initializeAudio().catch(err => { /* handled */ });
    }
    updateAudioStatus(); // Set initial status message

    statusDiv.addEventListener('click', () => {
        if (audioContext && audioContext.state === 'suspended') initializeAudio();
    });
    
    const initAudioOnFirstGesture = () => {
        if (audioContext && audioContext.state === 'suspended') {
            initializeAudio();
        }
        document.body.removeEventListener('click', initAudioOnFirstGesture);
        document.body.removeEventListener('touchstart', initAudioOnFirstGesture);
    };
    document.body.addEventListener('click', initAudioOnFirstGesture);
    document.body.addEventListener('touchstart', initAudioOnFirstGesture);

    drawNoteMarkers();
    updatePitchDisplayAndOscillator(); // Update display based on initial slider value
});
