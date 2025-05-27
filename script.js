document.addEventListener('DOMContentLoaded', () => {
    // --- Global Variables & DOM Elements ---
    let audioContext;
    let mainOscillator = null;
    let mainGainNode = null;
    let isPointerDown = false; // Tracks if mouse/touch is currently active on the surface
    let soundPlaying = false; // Tracks if sound is audibly playing

    const stylophoneSurface = document.getElementById('stylophone-surface');
    const waveformSelect = document.getElementById('waveform-select');
    const volumeSlider = document.getElementById('volume-slider');
    const octaveShiftDisplay = document.getElementById('octave-shift-display');
    const noteDisplay = document.getElementById('note-display');
    const statusDiv = document.getElementById('audio-status');
    const darkModeToggle = document.getElementById('dark-mode-toggle');
    const body = document.body;

    let currentWaveform = waveformSelect.value;
    let globalVolume = parseFloat(volumeSlider.value);
    let octaveShift = 0;
    let sustainPedalActive = false;
    let lastPlayedFrequency = 0;

    const attackTime = 0.01;
    const releaseTime = 0.1;

    // Frequency range for the stylophone surface (e.g., 2 octaves A2 to A4)
    const MIN_BASE_FREQ = 110; // A2
    const MAX_BASE_FREQ = 440; // A4

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
    // Load dark mode preference
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
            statusDiv.textContent = message || "Click or Touch to enable audio";
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
                resolve();
                return;
            }
            try {
                if (!audioContext) {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)({
                        latencyHint: 'interactive',
                        sampleRate: 44100 // Common sample rate
                    });
                }
                audioContext.resume().then(() => {
                    if (!mainOscillator) setupAudioNodes();
                    updateAudioStatus();
                    resolve();
                }).catch(e => {
                    updateAudioStatus("Error resuming audio.", "error");
                    console.error("Audio resume error:", e);
                    reject(e);
                });
            } catch (e) {
                updateAudioStatus("Web Audio API not supported.", "error");
                console.error("Web Audio API error:", e);
                reject(e);
            }
        });
    }

    function setupAudioNodes() {
        if (!audioContext || audioContext.state !== 'running') return;
        if (mainOscillator) mainOscillator.stop(); // Stop previous if any
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
    function getFrequencyFromPosition(xPosition, surfaceWidth) {
        const relativeX = Math.max(0, Math.min(1, xPosition / surfaceWidth)); // Clamp between 0 and 1
        // Logarithmic scale for frequency
        let baseFreq = MIN_BASE_FREQ * Math.pow(MAX_BASE_FREQ / MIN_BASE_FREQ, relativeX);
        return baseFreq * Math.pow(2, octaveShift);
    }

    function frequencyToNoteName(freq) {
        if (freq <= 0) return "";
        const noteNum = 12 * (Math.log2(freq / 440)) + 69;
        const roundedNoteNum = Math.round(noteNum);
        const noteIndex = roundedNoteNum % 12;
        const octaveVal = Math.floor(roundedNoteNum / 12) - 1;
        return NOTE_NAMES[noteIndex] + octaveVal;
    }

    function updatePitch(freq) {
        if (mainOscillator && audioContext && audioContext.state === 'running') {
            mainOscillator.frequency.setTargetAtTime(freq, audioContext.currentTime, 0.005); // Smooth pitch change
            lastPlayedFrequency = freq;
            noteDisplay.textContent = frequencyToNoteName(freq);
        }
    }

    // --- Sound Control ---
    function rampUpGain() {
        if (mainGainNode && audioContext && audioContext.state === 'running') {
            const now = audioContext.currentTime;
            mainGainNode.gain.cancelScheduledValues(now);
            mainGainNode.gain.setValueAtTime(mainGainNode.gain.value, now); // Start from current value
            mainGainNode.gain.linearRampToValueAtTime(globalVolume, now + attackTime);
            soundPlaying = true;
        }
    }

    function rampDownGain() {
        if (mainGainNode && audioContext && audioContext.state === 'running') {
            const now = audioContext.currentTime;
            mainGainNode.gain.cancelScheduledValues(now);
            mainGainNode.gain.setValueAtTime(mainGainNode.gain.value, now);
            mainGainNode.gain.linearRampToValueAtTime(0.0001, now + releaseTime); // Ramp to near zero
            soundPlaying = false;
            // noteDisplay.textContent = " "; // Clear note display slightly after sound fades
            setTimeout(() => {
                if (!soundPlaying && !isPointerDown && !sustainPedalActive) noteDisplay.textContent = " ";
            }, releaseTime * 1000 + 50);
        }
    }

    // --- Event Handlers for Stylophone Surface ---
    function handlePointerStart(event) {
        event.preventDefault();
        isPointerDown = true;
        initializeAudio().then(() => {
            if (!mainOscillator || !mainGainNode) setupAudioNodes(); // Ensure nodes are ready

            const rect = stylophoneSurface.getBoundingClientRect();
            const xPosition = (event.clientX || event.touches[0].clientX) - rect.left;
            const freq = getFrequencyFromPosition(xPosition, rect.width);
            
            if (mainOscillator.type !== currentWaveform) mainOscillator.type = currentWaveform;
            updatePitch(freq);
            rampUpGain();
        }).catch(err => console.error("Audio init failed on pointer start:", err));
    }

    function handlePointerMove(event) {
        if (!isPointerDown || !audioContext || audioContext.state !== 'running' || !mainOscillator) return;
        event.preventDefault();
        const rect = stylophoneSurface.getBoundingClientRect();
        const xPosition = (event.clientX || event.touches[0].clientX) - rect.left;
        const freq = getFrequencyFromPosition(xPosition, rect.width);
        updatePitch(freq);
    }

    function handlePointerEnd(event) {
        if (!isPointerDown) return;
        // event.preventDefault(); // Can cause issues on touch leaving screen
        isPointerDown = false;
        if (!sustainPedalActive) {
            rampDownGain();
        }
    }

    stylophoneSurface.addEventListener('mousedown', handlePointerStart);
    document.addEventListener('mousemove', handlePointerMove); // Listen on document for dragging outside
    document.addEventListener('mouseup', handlePointerEnd);   // Listen on document

    stylophoneSurface.addEventListener('touchstart', handlePointerStart, { passive: false });
    document.addEventListener('touchmove', handlePointerMove, { passive: false }); // Listen on document
    document.addEventListener('touchend', handlePointerEnd);
    document.addEventListener('touchcancel', handlePointerEnd);


    // --- UI Control Handlers ---
    volumeSlider.addEventListener('input', () => {
        globalVolume = parseFloat(volumeSlider.value);
        if (soundPlaying && mainGainNode) { // If currently playing, adjust live
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
        
        // Initialize audio on first key interaction if suspended
        if (audioContext && audioContext.state === 'suspended') {
            initializeAudio();
        }

        if (event.code === "ArrowUp") {
            octaveShift++;
            octaveShiftDisplay.textContent = octaveShift;
            if (isPointerDown && lastPlayedFrequency > 0) { // If playing, update pitch
                const currentRelativeX = (lastPlayedFrequency / Math.pow(2, octaveShift -1)) / Math.pow(MAX_BASE_FREQ / MIN_BASE_FREQ, 1) / MIN_BASE_FREQ; // Approx
                const freq = MIN_BASE_FREQ * Math.pow(MAX_BASE_FREQ / MIN_BASE_FREQ, currentRelativeX) * Math.pow(2, octaveShift);
                 // This re-calculation is a bit complex. Simpler:
                 updatePitch(lastPlayedFrequency / Math.pow(2, octaveShift -1) * Math.pow(2, octaveShift));
            } else if (sustainPedalActive && soundPlaying && lastPlayedFrequency > 0) {
                 updatePitch(lastPlayedFrequency / Math.pow(2, octaveShift -1) * Math.pow(2, octaveShift));
            }
        } else if (event.code === "ArrowDown") {
            octaveShift--;
            octaveShiftDisplay.textContent = octaveShift;
            if (isPointerDown && lastPlayedFrequency > 0) {
                updatePitch(lastPlayedFrequency / Math.pow(2, octaveShift +1) * Math.pow(2, octaveShift));
            } else if (sustainPedalActive && soundPlaying && lastPlayedFrequency > 0) {
                 updatePitch(lastPlayedFrequency / Math.pow(2, octaveShift +1) * Math.pow(2, octaveShift));
            }
        } else if (event.code === "Space") {
            event.preventDefault();
            sustainPedalActive = true;
             // If sound is not playing but pointer was down (and just lifted),
             // re-trigger sound with sustain. This might be too complex.
             // For now, sustain just prevents stopping.
        }
    });
    window.addEventListener('keyup', (event) => {
        if (event.code === "Space") {
            event.preventDefault();
            sustainPedalActive = false;
            if (!isPointerDown && soundPlaying) { // If pointer was lifted while sustain was on
                rampDownGain();
            }
        }
    });

    // --- Note Markers on Stylophone Surface ---
    function drawNoteMarkers() {
        stylophoneSurface.innerHTML = ''; // Clear existing markers
        const surfaceWidth = stylophoneSurface.offsetWidth;
        if (surfaceWidth === 0) return; // Not visible yet

        const baseOctave = Math.floor(12 * (Math.log2(MIN_BASE_FREQ / 440)) + 69 / 12) -1;

        for (let i = 0; i < 3 * 12; i++) { // Draw markers for approx 3 octaves range
            const noteMidi = (baseOctave +1) * 12 + i; // Starting from C near min_freq
            const freq = 440 * Math.pow(2, (noteMidi - 69) / 12);

            if (freq > MAX_BASE_FREQ * 1.05 || freq < MIN_BASE_FREQ * 0.95) continue; // Only draw if within actual playing range

            // Calculate relativeX for this frequency
            // freq = MIN_BASE_FREQ * Math.pow(MAX_BASE_FREQ / MIN_BASE_FREQ, relativeX)
            // log(freq / MIN_BASE_FREQ) = relativeX * log(MAX_BASE_FREQ / MIN_BASE_FREQ)
            let relativeX = Math.log(freq / MIN_BASE_FREQ) / Math.log(MAX_BASE_FREQ / MIN_BASE_FREQ);

            if (relativeX >= 0 && relativeX <= 1) {
                const marker = document.createElement('span');
                marker.classList.add('note-marker');
                const noteName = NOTE_NAMES[noteMidi % 12];
                marker.textContent = noteName;
                if (noteName.length === 1) marker.classList.add('natural');
                if (noteName === "C") marker.classList.add('root');

                marker.style.left = `${relativeX * 100}%`;
                stylophoneSurface.appendChild(marker);
            }
        }
    }


    // --- Initial Page Setup ---
    volumeSlider.value = String(globalVolume);
    octaveShiftDisplay.textContent = octaveShift;

    if (!(window.AudioContext || window.webkitAudioContext)) {
        updateAudioStatus("Browser doesn't support Web Audio API.", "error");
    } else {
        // Initial attempt to set up audio context, might require user interaction
        initializeAudio().catch(err => { /* error handled in initializeAudio */ });
    }
    updateAudioStatus(); // Set initial status message

    // Fallback for browsers where audioContext starts suspended
    statusDiv.addEventListener('click', () => {
        if (audioContext && audioContext.state === 'suspended') {
            initializeAudio();
        }
    });
    // Also try to init audio on any first touch/click on body
    document.body.addEventListener('click', () => {
         if (audioContext && audioContext.state === 'suspended') {
            initializeAudio();
        }
    }, { once: true });
     document.body.addEventListener('touchstart', () => {
         if (audioContext && audioContext.state === 'suspended') {
            initializeAudio();
        }
    }, { once: true });


    // Draw markers after layout is stable
    // Use ResizeObserver for responsiveness if markers need to update on resize
    new ResizeObserver(drawNoteMarkers).observe(stylophoneSurface);
    // Initial draw if already visible
    if (stylophoneSurface.offsetWidth > 0) {
        drawNoteMarkers();
    } else {
        // Fallback if not immediately visible (e.g. hidden tab)
        setTimeout(drawNoteMarkers, 100);
    }
});
