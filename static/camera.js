const preview = document.getElementById('preview');
const viewerCount = document.getElementById('viewer-count');
const errorBox = document.getElementById('error-box');
const soundBarsContainer = document.getElementById('sound-bars');

let stream = null;
let ws = null;
let recorder = null;
let micEnabled = true;
let reconnectTimer = null;
let viewerPollTimer = null;
let audioVisualizer = null;
let snapshotTimer = null;

function showError(title, msg) {
    document.getElementById('error-title').textContent = title;
    document.getElementById('error-msg').textContent = msg;
    errorBox.classList.add('visible');
}

async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1280 },
                height: { ideal: 720 },
            },
            audio: true,
        });
        preview.srcObject = stream;
        connectWebSocket();
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            showError('Permission Denied', 'Camera or microphone access was denied. Check your browser permissions and try again.');
        } else if (err.name === 'NotFoundError') {
            showError('No Camera Found', 'No camera was found on this device.');
        } else {
            showError('Camera Error', err.message);
        }
    }
}

function connectWebSocket() {
    if (ws) ws.close();
    clearTimeout(reconnectTimer);

    setStatus('connecting', 'Connecting to server…');
    ws = new WebSocket(`${WS_SCHEME}//${location.host}/ws/camera`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        setStatus('live', 'Live — streaming');
        startRecorder();
        initAudioMeter();
        startSnapshotCapture();
        pollViewerCount(); // disabled for now as it fills up the logs
    };

    ws.onclose = () => {
        stopRecorder();
        stopAudioMeter();
        clearInterval(viewerPollTimer);
        clearInterval(snapshotTimer);
        setStatus('error', 'Disconnected — reconnecting…');
        viewerCount.textContent = '';
        reconnectTimer = setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
        setStatus('error', 'Connection error');
    };
}

function startRecorder() {
    stopRecorder();

    // Prefer video/mp4 (works on iOS Safari, macOS Safari).
    // Fall back to video/webm for Chrome/Firefox on desktop.
    const mimeType = MediaRecorder.isTypeSupported('video/mp4')
        ? 'video/mp4'
        : 'video/webm;codecs=vp8,opus';

    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => {
        if (e.data.size > 0 && ws?.readyState === WebSocket.OPEN) {
            ws.send(e.data);
        }
    };
    recorder.start(500);
}

function stopRecorder() {
    if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
    }
    recorder = null;
}

async function capturePeriodicSnapshot() {
    if (!stream || !preview || !audioVisualizer) return;

    const canvas = document.createElement('canvas');
    canvas.width = preview.videoWidth || 320;
    canvas.height = preview.videoHeight || 240;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(preview, 0, 0);
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.7);

    if (audioVisualizer?.analyser) {
        const dataArray = new Uint8Array(audioVisualizer.analyser.frequencyBinCount);
        audioVisualizer.analyser.getByteFrequencyData(dataArray);

        const rms = Math.sqrt(dataArray.reduce((sum, v) => sum + v * v) / dataArray.length);
        const peak = Math.max(...dataArray);

        try {
            await fetch('/api/camera/snapshot', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: jpegDataUrl,
                    audioRms: Math.round(rms),
                    audioPeak: peak,
                }),
            });
        } catch (err) {
            console.warn('[camera.js] Snapshot capture failed:', err);
        }
    }
}

function startSnapshotCapture() {
    clearInterval(snapshotTimer);
    snapshotTimer = setInterval(capturePeriodicSnapshot, 5000);
}

async function pollViewerCount() {
    clearInterval(viewerPollTimer);
    viewerPollTimer = setInterval(async () => {
        try {
            const r = await fetch('/api/status');
            if (r.ok) {
                const data = await r.json();
                const n = data.viewer_count;
                viewerCount.textContent = n === 0 ? 'No viewers' : `${n} viewer${n === 1 ? '' : 's'}`;
            }
        } catch { /* ignore */ }
    }, 5000);
}

function toggleMic() {
    if (!stream) return;
    micEnabled = !micEnabled;
    stream.getAudioTracks().forEach(t => t.enabled = micEnabled);
    document.querySelector('#controls button').textContent = micEnabled ? '🎤 Mute mic' : '🔇 Unmute mic';
}

function initAudioMeter() {
    console.log('[camera.js] initAudioMeter called');
    console.log('[camera.js] stream exists:', !!stream);
    console.log('[camera.js] soundBarsContainer exists:', !!soundBarsContainer);

    try {
        if (!audioVisualizer) {
            console.log('[camera.js] Creating new AudioVisualizer');
            audioVisualizer = new AudioVisualizer(stream, soundBarsContainer);
            console.log('[camera.js] AudioVisualizer instance created');
        } else {
            console.log('[camera.js] AudioVisualizer already exists');
        }
        console.log('[camera.js] Calling audioVisualizer.start()');
        audioVisualizer.start();
        console.log('[camera.js] audioVisualizer.start() completed');
    } catch (err) {
        console.error('[camera.js] Audio meter initialization failed:', err);
        console.warn('Audio meter not available:', err);
    }
}

function stopAudioMeter() {
    console.log('[camera.js] stopAudioMeter called');
    if (audioVisualizer) {
        console.log('[camera.js] Stopping audioVisualizer');
        audioVisualizer.stop();
        audioVisualizer = null;
        console.log('[camera.js] audioVisualizer stopped and cleared');
    } else {
        console.log('[camera.js] audioVisualizer is null, nothing to stop');
    }
}

startCamera();

