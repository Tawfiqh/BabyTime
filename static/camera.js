
const preview = document.getElementById('preview');
const dot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
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

function setStatus(state, text) {
    dot.className = state;
    statusText.textContent = text;
}

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
    ws = new WebSocket(`wss://${location.host}/ws/camera`);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
        setStatus('live', 'Live — streaming');
        startRecorder();
        initAudioMeter();
        pollViewerCount(); // disabled for now as it fills up the logs
    };

    ws.onclose = () => {
        stopRecorder();
        stopAudioMeter();
        clearInterval(viewerPollTimer);
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

function switchRole() {
    if (confirm('Switch this device to Viewer?')) {
        localStorage.setItem('babyTimeRole', 'viewer');
        window.location.href = '/viewer.html';
    }
}

function initAudioMeter() {
    try {
        if (!audioVisualizer) {
            audioVisualizer = new AudioVisualizer(stream, soundBarsContainer);
        }
        audioVisualizer.start();
    } catch (err) {
        console.warn('Audio meter not available:', err);
    }
}

function stopAudioMeter() {
    if (audioVisualizer) {
        audioVisualizer.stop();
        audioVisualizer = null;
    }
}

startCamera();

