// viewer.js — loaded by viewer.html after audioVisualizer.js (a ?v= cache-buster).
// Bump the version in viewer.html's <script> tag whenever this file changes.

const video = document.getElementById('stream');
const overlay = document.getElementById('overlay');
const overlayMsg = document.getElementById('overlay-msg');
const overlayIcon = document.getElementById('overlay-icon');
const dot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const unmuteBtn = document.getElementById('unmute-btn');
const soundBarsContainer = document.getElementById('sound-bars');

let ws = null;
let mediaSource = null;
let sourceBuffer = null;
let queue = [];
let reconnectTimer = null;
let hasVideo = false;
let hasSeekedToLive = false;
let audioVisualizer = null;
let viewerAudioChart = null;
let lastLevelTs = 0;

/** ws:// on HTTP (e.g. --http local test); wss:// on HTTPS */
const WS_SCHEME = location.protocol === 'https:' ? 'wss:' : 'ws:';

// ==============================
// Setup mime types
// ==============================
// Codec order: mp4/h264 for iOS, webm/vp8 fallback for desktop Chrome
const MIME_TYPES = [
  'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
  'video/mp4',
  'video/webm; codecs="vp8, opus"',
  'video/webm',
];

function getSupportedMime() {
  // Use ManagedMediaSource on iOS, standard MediaSource elsewhere
  const hasManagedMediaSource = typeof ManagedMediaSource !== 'undefined';
  const sourceApi = hasManagedMediaSource ? ManagedMediaSource : MediaSource;
  console.log('[MSE] API detection:', { hasManagedMediaSource, apiName: hasManagedMediaSource ? 'ManagedMediaSource' : 'MediaSource' });

  if (typeof sourceApi === 'undefined') {
    console.warn('[MSE] Neither MediaSource API is available');
    return null;
  }

  const supported = MIME_TYPES.find(m => {
    const isSupported = sourceApi.isTypeSupported(m);
    console.log(`[MSE] Checking MIME: ${m} → ${isSupported}`);
    return isSupported;
  });

  if (supported) {
    console.log('[MSE] Selected MIME:', supported);
  } else {
    console.error('[MSE] No supported MIME types found');
  }
  return supported ?? null;
}

// ==============================
// Setup status & Overlay - TBC refactor to different file
// ==============================
function setStatus(state, text) {
  dot.className = state;
  statusText.textContent = text;
}

function showOverlay(icon, msg) {
  overlayIcon.textContent = icon;
  overlayMsg.textContent = msg;
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

// ==============================
// Setup MediaSource
// ==============================
function resetMediaSource() {
  if (mediaSource && mediaSource.readyState === 'open') {
    try { mediaSource.endOfStream(); } catch { /* ignore */ }
  }
  sourceBuffer = null;
  mediaSource = null;
  queue = [];
  video.src = '';
  hasVideo = false;
  hasSeekedToLive = false;
}

function getMediaSourceMode() {
  const useManaged = typeof ManagedMediaSource !== 'undefined';
  return {
    useManaged,
    apiName: useManaged ? 'ManagedMediaSource' : 'MediaSource',
    MediaSourceAPI: useManaged ? ManagedMediaSource : MediaSource,
    readyEvent: useManaged ? 'startstreaming' : 'sourceopen',
    flushEvent: useManaged ? 'endstreaming' : 'updateend',
  };
}

function logAllMediaSourceEvents(ms) {
  const events = ['sourceopen', 'sourceended', 'sourceclosed', 'startstreaming', 'endstreaming', 'close'];
  for (const evt of events) {
    ms.addEventListener(evt, () => {
      console.log(`[MSE event] Event: ${evt}, readyState: ${ms.readyState}`);
    });
  }
}

function attachSourceBufferWhenOpen(mimeType, readyEvent, flushEvent) {

  // BEGINNING OF SOURCEBUFFER LOGIC
  mediaSource.addEventListener(readyEvent, () => {
    console.log(`[MSE] ${readyEvent} event fired, readyState: ${mediaSource.readyState}`);
    try {
      sourceBuffer = mediaSource.addSourceBuffer(mimeType);
      console.log('[MSE] SourceBuffer created:', { updating: sourceBuffer.updating });
    } catch (e) {
      console.error(`[MSE] Failed to add SourceBuffer: ${e.message}`, e);
      setStatus('error', `Codec not supported: ${mimeType}`);
      return;
    }

    // END OF SOURCEBUFFER LOGIC
    sourceBuffer.addEventListener(flushEvent, flushQueue);
    sourceBuffer.addEventListener('error', (e) => {
      console.error('[MSE] SourceBuffer error:', e);
      queue = [];
    });
    sourceBuffer.addEventListener('updatestart', () => console.log('[MSE] SourceBuffer updatestart'));
    sourceBuffer.addEventListener('update', () => console.log('[MSE] SourceBuffer update'));
    sourceBuffer.addEventListener('updateend', () => {
      console.log('[MSE] SourceBuffer updateend');
      // Re-evaluate live edge on every append: late joiners form a 2nd buffered
      // range when live chunks start arriving, and we need to jump to it.
      if (sourceBuffer.buffered.length > 1 || !hasSeekedToLive) {
        seekToLatestBufferedRange();
      }
    });
    console.log('[MSE] SourceBuffer event listeners attached');
  });
}

function attachVideoElementStreamHandlers() {
  video.addEventListener('playing', () => {
    console.log('[MSE] Video playing event fired');
    if (!hasVideo) {
      hasVideo = true;
      hideOverlay();
      setStatus('live', 'Live');
      unmuteBtn.classList.add('visible');
      initAudioMeter();
    }
  }, { once: false });

  video.addEventListener('waiting', () => {
    if (!sourceBuffer || !sourceBuffer.buffered.length) return;
    const n = sourceBuffer.buffered.length;
    const liveStart = sourceBuffer.buffered.start(n - 1);
    if (video.currentTime < liveStart) {
      console.log(`[MSE] Stalled — jumping to live at ${liveStart.toFixed(2)}`);
      video.currentTime = liveStart;
    }
  });

  video.addEventListener('error', (e) => {
    console.error('[MSE] Video element error:', e, 'mediaError:', video.error);
  });

  video.addEventListener('loadstart', () => console.log('[Video] loadstart'));
  video.addEventListener('loadedmetadata', () => console.log('[Video] loadedmetadata'));
  video.addEventListener('loadeddata', () => console.log('[Video] loadeddata'));
}

function initMediaSource(mimeType) {
  resetMediaSource();
  const mode = getMediaSourceMode();

  console.log(`[MSE] Initializing with ${mode.apiName}, MIME: ${mimeType}`);

  mediaSource = new mode.MediaSourceAPI();
  console.log('[MSE] MediaSource instance created:', { readyState: mediaSource.readyState, constructor: mediaSource.constructor.name });

  video.src = URL.createObjectURL(mediaSource);
  console.log('[MSE] Video src set with object URL');

  console.log(`[MSE] Using events: ready="${mode.readyEvent}", flush="${mode.flushEvent}"`);

  logAllMediaSourceEvents(mediaSource);

  console.log('[MSE] Attaching source buffer when open - for mimeType: ', mimeType, 'readyEvent: ', mode.readyEvent, 'flushEvent: ', mode.flushEvent);
  attachSourceBufferWhenOpen(mimeType, mode.readyEvent, mode.flushEvent);

  mediaSource.addEventListener('error', (e) => {
    console.error('[MSE] MediaSource error:', e);
  });

  attachVideoElementStreamHandlers();
}

function logBufferedRanges() {
  if (!sourceBuffer) return;
  const ranges = [];
  for (let i = 0; i < sourceBuffer.buffered.length; i++) {
    ranges.push(`[${sourceBuffer.buffered.start(i).toFixed(2)}–${sourceBuffer.buffered.end(i).toFixed(2)}]`);
  }
  console.log(`[MSE] Buffered ranges (${sourceBuffer.buffered.length}): ${ranges.join(' ')}, currentTime: ${video.currentTime.toFixed(2)}`);
}

function seekToLatestBufferedRange() {
  if (!sourceBuffer) { console.warn('[MSE] seek skipped: no sourceBuffer'); return; }
  const n = sourceBuffer.buffered.length;
  if (!n) {
    console.warn('[MSE] seek skipped: buffered range EMPTY — decoder rejected chunks. video.error:', video.error, 'readyState:', video.readyState);
    return;
  }
  logBufferedRanges();

  const liveRangeStart = sourceBuffer.buffered.start(n - 1);
  const liveRangeEnd = sourceBuffer.buffered.end(n - 1);

  // Seek aggressively: aim for 2 seconds before live edge (max 5s delay)
  const maxSeekBehind = 5;
  const targetSeekTime = Math.max(liveRangeStart, liveRangeEnd - maxSeekBehind);

  // Seek if we're more than 5 seconds behind live edge or outside range entirely
  const maxAllowedDelay = 10;
  const isFarBehind = liveRangeEnd - video.currentTime > maxAllowedDelay;
  const inLiveRange = video.currentTime >= liveRangeStart && video.currentTime <= liveRangeEnd;

  if (!inLiveRange || isFarBehind) {
    console.log(`[MSE] Seeking from ${video.currentTime.toFixed(2)} → ${targetSeekTime.toFixed(2)} (live-edge: ${liveRangeEnd.toFixed(2)}, delay: ${(liveRangeEnd - video.currentTime).toFixed(2)}s, ranges: ${n})`);
    video.currentTime = targetSeekTime;
  }
  hasSeekedToLive = true;
  // if (video.paused) video.play().catch(e => console.warn('[MSE] play() failed:', e));

}

function flushQueue() {
  if (!sourceBuffer || sourceBuffer.updating || queue.length === 0) return;
  try {
    sourceBuffer.appendBuffer(queue.shift());
  } catch (e) {
    // Buffer full or closed — drop this chunk.
    queue = [];
    console.warn('appendBuffer error', e);
  }
}

function appendChunk(data) {
  if (!sourceBuffer) {
    console.warn('[MSE] No sourceBuffer yet, queuing chunk');
    queue.push(data);
    return;
  }
  if (sourceBuffer.updating) {
    queue.push(data);
    console.log(`[MSE] SourceBuffer updating, queued chunk (queue size: ${queue.length})`);
  } else {
    try {
      sourceBuffer.appendBuffer(data);
      console.log(`[MSE] Appended chunk (${data.byteLength} bytes)`);
    } catch (e) {
      console.error('[MSE] appendBuffer error:', e.message, e);
      queue.push(data);
    }
  }
}

function tryInitViewerMSE() {
  const mimeType = getSupportedMime();
  if (!mimeType) {
    console.error('[MSE] No supported MIME type found');
    setStatus('error', 'MediaSource not supported on this browser');
    showOverlay('⚠️', 'This browser does not support live streaming. Try Safari or Chrome.');
    return false;
  }
  initMediaSource(mimeType);
  return true;
}

function onViewerWebSocketOpen() {
  console.log('[WS] Connected');
  setStatus('waiting', 'Waiting for camera…');
  showOverlay('👶', 'Waiting for camera to come online…');
}

function onViewerWebSocketMessage({ data }) {
  console.log(`[WS] Received chunk: ${data.byteLength} bytes`);
  appendChunk(data);
}

function onViewerWebSocketClose() {
  console.log('[WS] Disconnected');
  setStatus('error', 'Disconnected — reconnecting…');
  showOverlay('📡', 'Disconnected. Reconnecting…');
  hasVideo = false;
  unmuteBtn.classList.remove('visible');
  stopAudioMeter();
  reconnectTimer = setTimeout(connect, 3000);
}

function onViewerWebSocketError(e) {
  console.error('[WS] Connection error:', e);
  setStatus('error', 'Connection error');
}

function openViewerWebSocket() {
  const wsUrl = `${WS_SCHEME}//${location.host}/ws/viewer`;
  console.log(`[WS] Connecting to ${wsUrl}`);
  ws = new WebSocket(wsUrl);
  ws.binaryType = 'arraybuffer';
  ws.onopen = onViewerWebSocketOpen;
  ws.onmessage = onViewerWebSocketMessage;
  ws.onclose = onViewerWebSocketClose;
  ws.onerror = onViewerWebSocketError;
}

function connect() {
  console.log('[WS] Connecting...');
  if (ws) ws.close();
  clearTimeout(reconnectTimer);
  resetMediaSource();
  if (!tryInitViewerMSE()) return;
  setStatus('connecting', 'Connecting to server…');
  showOverlay('👶', 'Connecting…');
  openViewerWebSocket();
}

// ==============================
// INTIALISATION
// ==============================
connect();



// ==============================
// Controls 
// ==============================
function unmute() {
  video.muted = false;
  unmuteBtn.classList.remove('visible');
}

// ==============================
// Audio Meter
// ==============================
function initAudioMeter() {
  console.log('[viewer.js] initAudioMeter called');
  console.log('[viewer.js] video element:', {
    exists: !!video,
    src: video?.src,
    currentTime: video?.currentTime,
    duration: video?.duration,
    readyState: video?.readyState,
    networkState: video?.networkState,
    paused: video?.paused
  });
  console.log('[viewer.js] soundBarsContainer exists:', !!soundBarsContainer);

  try {
    if (!audioVisualizer) {
      console.log('[viewer.js] Creating new AudioVisualizer');
      audioVisualizer = new AudioVisualizer(video, soundBarsContainer);
      console.log('[viewer.js] AudioVisualizer instance created');
    } else {
      console.log('[viewer.js] AudioVisualizer already exists');
    }
    console.log('[viewer.js] Calling audioVisualizer.start()');
    audioVisualizer.start();
    console.log('[viewer.js] audioVisualizer.start() completed');

    viewerAudioChart = new AudioLevelChart('viewer-audio-chart', 600);
    audioVisualizer.onLevelUpdate = (rms, peak) => {
      const now = Date.now();
      if (now - lastLevelTs < 1000) return;
      lastLevelTs = now;

      document.getElementById('rms-bar').style.width = (rms / 255 * 100) + '%';
      document.getElementById('rms-value').textContent = rms;
      document.getElementById('peak-bar').style.width = (peak / 255 * 100) + '%';
      document.getElementById('peak-value').textContent = peak;

      viewerAudioChart.push(rms, peak);
    };
  } catch (err) {
    console.error('[viewer.js] Audio meter initialization failed:', err);
    console.warn('Audio meter not available:', err);
  }
}

function stopAudioMeter() {
  console.log('[viewer.js] stopAudioMeter called');
  if (audioVisualizer) {
    console.log('[viewer.js] Stopping audioVisualizer');
    audioVisualizer.stop();
    audioVisualizer = null;
    console.log('[viewer.js] audioVisualizer stopped and cleared');
    viewerAudioChart?.destroy();
    viewerAudioChart = null;
    lastLevelTs = 0;
  } else {
    console.log('[viewer.js] audioVisualizer is null, nothing to stop');
  }
}

// ==============================
// DEBUG
// ==============================

function debug_available_apis() {
  console.log('[BabyTime] API availability:', {
    MediaSource: typeof MediaSource !== 'undefined',
    ManagedMediaSource: typeof ManagedMediaSource !== 'undefined',
    WebSocket: typeof WebSocket !== 'undefined',
    getUserMedia: typeof navigator.mediaDevices !== 'undefined' && typeof navigator.mediaDevices.getUserMedia !== 'undefined',
  });

  // Try to see what's actually on window
  if (typeof ManagedMediaSource === 'undefined') {
    console.warn('[BabyTime] ManagedMediaSource is undefined');
    if (typeof MediaSource === 'undefined') {
      console.error('[BabyTime] MediaSource is undefined - MSE not supported at all');
    } else {
      console.log('[BabyTime] MediaSource exists:', MediaSource);
    }

  } else {
    console.log('[BabyTime] ManagedMediaSource exists:', ManagedMediaSource);
  }
  renderMimeSupportList();
}

function renderMimeSupportList() {
  mimeSupportPanel.style.display = '';
  const listEl = document.getElementById('mime-support-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  const sourceApi = (typeof ManagedMediaSource !== 'undefined') ? ManagedMediaSource : MediaSource;
  const apiName = (typeof ManagedMediaSource !== 'undefined') ? 'ManagedMediaSource' : 'MediaSource';

  if (typeof sourceApi === 'undefined') {
    const li = document.createElement('li');
    const flag = document.createElement('span');
    flag.className = 'mime-flag false';
    flag.textContent = 'false';
    const text = document.createElement('span');
    text.className = 'mime-type';
    text.textContent = `${apiName} API unavailable`;
    li.append(flag, text);
    listEl.appendChild(li);
    return;
  }

  for (const mime of MIME_TYPES) {
    const supported = sourceApi.isTypeSupported(mime);
    const li = document.createElement('li');
    const flag = document.createElement('span');
    flag.className = `mime-flag ${supported}`;
    flag.textContent = String(supported);
    const type = document.createElement('span');
    type.className = 'mime-type';
    type.textContent = mime;
    li.append(flag, type);
    listEl.appendChild(li);
  }
}
// debug_available_apis();
