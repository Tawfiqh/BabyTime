const snapshotImage = document.getElementById('snapshot-image');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const fetchStatus = document.getElementById('fetch-status');

let fetchTimer = null;

function setStatus(state, text) {
  statusDot.className = state;
  statusText.textContent = text;
}

async function fetchSnapshot() {
  try {
    const res = await fetch('/api/camera/snapshot');
    if (!res.ok) {
      setStatus('error', 'Snapshot unavailable');
      return;
    }

    const data = await res.json();
    snapshotImage.src = data.image;
    snapshotImage.style.display = 'block';

    const ts = new Date(data.timestamp);
    document.getElementById('snapshot-timestamp').textContent = `Snapshot: ${ts.toLocaleTimeString()}`;

    setStatus('live', 'Live');
  } catch (err) {
    console.error('Snapshot fetch failed:', err);
    setStatus('error', 'Connection error');
  }
}

async function fetchAudioLevel() {
  try {
    const res = await fetch('/api/camera/audio-level');
    if (!res.ok) return;

    const data = await res.json();
    const rmsPercent = (data.rms / 255) * 100;
    const peakPercent = (data.peak / 255) * 100;

    document.getElementById('rms-bar').style.width = rmsPercent + '%';
    document.getElementById('rms-value').textContent = data.rms;

    document.getElementById('peak-bar').style.width = peakPercent + '%';
    document.getElementById('peak-value').textContent = data.peak;

    const ts = new Date(data.timestamp);
    fetchStatus.textContent = `Updated: ${ts.toLocaleTimeString()}`;
  } catch (err) {
    console.error('Audio level fetch failed:', err);
  }
}

async function pollData() {
  // Fetch immediately on load, then every 5 seconds
  await Promise.all([fetchSnapshot(), fetchAudioLevel()]);

  clearInterval(fetchTimer);
  fetchTimer = setInterval(() => {
    Promise.all([fetchSnapshot(), fetchAudioLevel()]);
  }, 5000);
}

function switchRole() {
  if (confirm('Switch this device to Camera?')) {
    localStorage.setItem('babyTimeRole', 'camera');
    window.location.href = '/camera.html';
  }
}

pollData();
