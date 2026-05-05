// shared-utils.js — utilities shared across camera.js, viewer.js, and slowviewer.js

const WS_SCHEME = location.protocol === 'https:' ? 'wss:' : 'ws:';

function setStatus(state, text) {
  document.getElementById('status-dot').className = state;
  document.getElementById('status-text').textContent = text;
}

function updateAudioBars(rms, peak) {
  document.getElementById('rms-bar').style.width = (rms / 255 * 100) + '%';
  document.getElementById('rms-value').textContent = rms;
  document.getElementById('peak-bar').style.width = (peak / 255 * 100) + '%';
  document.getElementById('peak-value').textContent = peak;
}

async function fetchAudioLevel(chart, { onFetched } = {}) {
  try {
    const res = await fetch('/api/camera/audio-level');
    if (!res.ok) return;
    const data = await res.json();
    updateAudioBars(data.rms, data.peak);
    chart.push(data.rms, data.peak, new Date(data.timestamp));
    if (onFetched) onFetched(data);
  } catch (err) {
    console.error('[audio-level] fetch failed:', err);
  }
}
