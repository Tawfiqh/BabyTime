class AudioLevelChart {
  constructor(canvasId, maxPoints = 120) {
    this.maxPoints = maxPoints;
    this._times = [];
    this._rms = [];
    this._peak = [];
    this._chart = this._init(canvasId);
  }

  _init(canvasId) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    return new Chart(ctx, {
      type: 'line',
      data: {
        labels: this._times,
        datasets: [
          {
            label: 'RMS',
            data: this._rms,
            borderColor: '#4caf50',
            backgroundColor: 'rgba(76,175,80,0.12)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1.5,
          },
          {
            label: 'Peak',
            data: this._peak,
            borderColor: '#ff6b6b',
            backgroundColor: 'rgba(255,107,107,0.08)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        animation: false,
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            ticks: { color: '#666', maxTicksLimit: 6 },
            grid: { color: 'rgba(255,255,255,0.06)' },
          },
          y: {
            min: 0,
            max: 255,
            ticks: { color: '#666' },
            grid: { color: 'rgba(255,255,255,0.06)' },
          },
        },
        plugins: {
          legend: { labels: { color: '#aaa', boxWidth: 12 } },
        },
      },
    });
  }

  push(rms, peak, date = new Date()) {
    this._times.push(date.toLocaleTimeString());
    this._rms.push(rms);
    this._peak.push(peak);
    if (this._times.length > this.maxPoints) {
      this._times.shift();
      this._rms.shift();
      this._peak.shift();
    }
    this._chart.update('none');
  }

  destroy() {
    this._chart.destroy();
  }
}
