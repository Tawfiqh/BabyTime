// audioVisualizer.js — AudioVisualizer class for audio meter lifecycle + rendering.
// Loaded by viewer.html before viewer.js; bump ?v= in the script tag when this changes.

class AudioVisualizer {
  constructor(audioSource, soundBarsContainer, barCount = 12) {
    console.log('[AudioVisualizer] Constructor called', {
      audioSource: audioSource?.constructor?.name || typeof audioSource,
      soundBarsContainer: !!soundBarsContainer,
      barCount
    });
    this.audioSource = audioSource;
    this.soundBarsContainer = soundBarsContainer;
    this.barCount = barCount;
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.animationId = null;
    this.onLevelUpdate = null;
  }

  start() {
    console.log('[AudioVisualizer] start() called');
    if (this.audioContext) {
      console.log('[AudioVisualizer] Already initialized, returning early');
      return;
    }

    const AudioContextAPI = window.AudioContext || window.webkitAudioContext;
    console.log('[AudioVisualizer] AudioContext API available:', !!AudioContextAPI);
    if (!AudioContextAPI) {
      console.error('[AudioVisualizer] AudioContext API is unavailable');
      throw new Error('AudioContext API is unavailable');
    }

    try {
      this.audioContext = new AudioContextAPI();
      console.log('[AudioVisualizer] AudioContext created, state:', this.audioContext.state);

      this.analyser = this.audioContext.createAnalyser();
      console.log('[AudioVisualizer] Analyser created, fftSize before:', this.analyser.fftSize);
      this.analyser.fftSize = 256;
      console.log('[AudioVisualizer] Analyser fftSize set to 256');

      console.log('[AudioVisualizer] Creating source node...');
      this.sourceNode = this.createSourceNode();
      console.log('[AudioVisualizer] Source node created:', this.sourceNode?.constructor?.name);

      this.sourceNode.connect(this.analyser);
      console.log('[AudioVisualizer] Source connected to analyser');

      this.ensureBars();
      console.log('[AudioVisualizer] Bars ensured');

      this.stopAnimationLoop();
      this.hasLoggedFirstFrame = false;
      this.animationId = requestAnimationFrame(() => this.renderFrame());
      console.log('[AudioVisualizer] Animation loop started, animationId:', this.animationId);
    } catch (err) {
      console.error('[AudioVisualizer] Error in start():', err);
      throw err;
    }
  }

  renderFrame() {
    if (!this.analyser) {
      console.warn('[AudioVisualizer] renderFrame: analyser is null');
      return;
    }

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    const bars = this.soundBarsContainer.querySelectorAll('.sound-bar');
    const barCount = bars.length;
    if (barCount === 0) {
      console.warn('[AudioVisualizer] renderFrame: no bars found in container');
      return;
    }
    const samplesPerBar = Math.max(1, Math.floor(dataArray.length / barCount));

    // Log first frame data to verify it's working
    if (!this.hasLoggedFirstFrame) {
      this.hasLoggedFirstFrame = true;
      const maxValue = Math.max(...dataArray);
      console.log('[AudioVisualizer] First frame rendered:', {
        frequencyBinCount: this.analyser.frequencyBinCount,
        barCount,
        samplesPerBar,
        maxFrequencyValue: maxValue,
        audioContextState: this.audioContext?.state
      });
    }

    for (let i = 0; i < barCount; i++) {
      let sum = 0;
      for (let j = 0; j < samplesPerBar; j++) {
        const sampleIndex = i * samplesPerBar + j;
        if (sampleIndex >= dataArray.length) break;
        sum += dataArray[sampleIndex];
      }
      const average = sum / samplesPerBar;
      const height = (average / 255) * 1;
      bars[i].style.height = Math.max(0.1, height) + 'rem';
    }

    if (this.onLevelUpdate) {
      const rms = Math.round(Math.sqrt(dataArray.reduce((s, v) => s + v * v, 0) / dataArray.length));
      const peak = Math.max(...dataArray);
      this.onLevelUpdate(rms, peak);
    }

    this.animationId = requestAnimationFrame(() => this.renderFrame());
  }

  ensureBars() {
    if (this.soundBarsContainer.children.length) {
      console.log('[AudioVisualizer] Bars already exist:', this.soundBarsContainer.children.length);
      return;
    }
    console.log('[AudioVisualizer] Creating bars, count:', this.barCount);
    for (let i = 0; i < this.barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'sound-bar';
      this.soundBarsContainer.appendChild(bar);
    }
    console.log('[AudioVisualizer] Bars created, container now has:', this.soundBarsContainer.children.length, 'bars');
  }

  createSourceNode() {
    console.log('[AudioVisualizer] createSourceNode called, source type:', this.audioSource?.constructor?.name);

    if (this.audioSource instanceof MediaStream) {
      console.log('[AudioVisualizer] Creating MediaStream source');
      try {
        const source = this.audioContext.createMediaStreamSource(this.audioSource);
        console.log('[AudioVisualizer] MediaStream source created successfully');
        return source;
      } catch (err) {
        console.error('[AudioVisualizer] Failed to create MediaStream source:', err);
        throw err;
      }
    }

    console.log('[AudioVisualizer] Creating MediaElement source');
    console.log('[AudioVisualizer] audioSource is HTMLElement:', this.audioSource instanceof HTMLElement);
    console.log('[AudioVisualizer] audioSource.tagName:', this.audioSource?.tagName);
    console.log('[AudioVisualizer] audioSource properties:', {
      canPlayType: typeof this.audioSource?.canPlayType,
      play: typeof this.audioSource?.play,
      pause: typeof this.audioSource?.pause,
      currentTime: this.audioSource?.currentTime
    });

    try {
      const methodName = this.audioContext.createMediaElementAudioSourceNode
        ? 'createMediaElementAudioSourceNode'
        : 'createMediaElementSource';
      console.log('[AudioVisualizer] Using method:', methodName);

      const createElementSource = this.audioContext[methodName]
        ? this.audioContext[methodName].bind(this.audioContext)
        : this.audioContext.createMediaElementSource.bind(this.audioContext);
      const source = createElementSource(this.audioSource);
      console.log('[AudioVisualizer] MediaElement source created successfully');
      return source;
    } catch (err) {
      console.error('[AudioVisualizer] Failed to create MediaElement source:', err);
      throw err;
    }
  }

  stop() {
    console.log('[AudioVisualizer] stop() called');
    this.stopAnimationLoop();
    if (this.audioContext) {
      console.log('[AudioVisualizer] Closing AudioContext, state:', this.audioContext.state);
      try {
        this.audioContext.close();
        console.log('[AudioVisualizer] AudioContext closed');
      } catch (err) {
        console.warn('[AudioVisualizer] Error closing AudioContext:', err);
      }
      this.audioContext = null;
    }
    this.analyser = null;
    this.sourceNode = null;
    this.soundBarsContainer.innerHTML = '';
    console.log('[AudioVisualizer] stop() completed');
  }

  stopAnimationLoop() {
    if (this.animationId != null) {
      console.log('[AudioVisualizer] Cancelling animation loop, id:', this.animationId);
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}

window.AudioVisualizer = AudioVisualizer;
