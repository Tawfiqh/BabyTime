// audioVisualizer.js — AudioVisualizer class for audio meter lifecycle + rendering.
// Loaded by viewer.html before viewer.js; bump ?v= in the script tag when this changes.

class AudioVisualizer {
  constructor(audioSource, soundBarsContainer, barCount = 12) {
    this.audioSource = audioSource;
    this.soundBarsContainer = soundBarsContainer;
    this.barCount = barCount;
    this.audioContext = null;
    this.analyser = null;
    this.sourceNode = null;
    this.animationId = null;
  }

  start() {
    if (this.audioContext) {
      console.log('[AudioVisualizer] Already initialized');
      return;
    }

    const AudioContextAPI = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextAPI) {
      throw new Error('AudioContext API is unavailable');
    }

    this.audioContext = new AudioContextAPI();
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    this.sourceNode = this.createSourceNode();
    this.sourceNode.connect(this.analyser);

    this.ensureBars();
    this.stopAnimationLoop();
    this.animationId = requestAnimationFrame(() => this.renderFrame());
  }

  renderFrame() {
    if (!this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    const bars = this.soundBarsContainer.querySelectorAll('.sound-bar');
    const barCount = bars.length;
    if (barCount === 0) return;
    const samplesPerBar = Math.max(1, Math.floor(dataArray.length / barCount));

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

    this.animationId = requestAnimationFrame(() => this.renderFrame());
  }

  ensureBars() {
    if (this.soundBarsContainer.children.length) return;
    for (let i = 0; i < this.barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'sound-bar';
      this.soundBarsContainer.appendChild(bar);
    }
  }

  createSourceNode() {
    if (this.audioSource instanceof MediaStream) {
      return this.audioContext.createMediaStreamSource(this.audioSource);
    }

    const createElementSource = this.audioContext.createMediaElementAudioSourceNode
      ? this.audioContext.createMediaElementAudioSourceNode.bind(this.audioContext)
      : this.audioContext.createMediaElementSource.bind(this.audioContext);
    return createElementSource(this.audioSource);
  }

  stop() {
    this.stopAnimationLoop();
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.sourceNode = null;
    this.soundBarsContainer.innerHTML = '';
  }

  stopAnimationLoop() {
    if (this.animationId != null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}

window.AudioVisualizer = AudioVisualizer;
