const snapshotImage = document.getElementById('snapshot-image');
const fetchStatus = document.getElementById('fetch-status');

let fetchTimer = null;
let audioChart = null;

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

    const screenShotTimeStamp = new Date(data.timestamp);
    document.getElementById('snapshot-timestamp').textContent = `Snapshot: ${screenShotTimeStamp.toLocaleTimeString()}`;

    setStatus('live', 'Snapshot updated');
  } catch (err) {
    console.error('Snapshot fetch failed:', err);
    setStatus('error', 'Connection error');
  }
}

function updateTimestamp(data) {
  fetchStatus.textContent = `Updated Audio Reading: ${new Date(data.timestamp).toLocaleTimeString()}`;
}

function fetchAudioLevelAndTimestamp() {
  return fetchAudioLevel(audioChart, { onFetched: updateTimestamp });
}

async function pollData() {
  await Promise.all([fetchSnapshot(), fetchAudioLevelAndTimestamp()]);

  clearInterval(fetchTimer);
  fetchTimer = setInterval(() => {
    Promise.all([fetchSnapshot(), fetchAudioLevelAndTimestamp()]);
  }, 5000);
}

audioChart = new AudioLevelChart('audio-chart', 120); // 10 min at 5s intervals
pollData();
