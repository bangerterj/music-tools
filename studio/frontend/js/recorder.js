/**
 * recorder.js — Microphone recording via MediaRecorder.
 *
 * Emits:
 *   recorder:start   — recording has begun
 *   recorder:stop    — recording stopped, detail.blob contains the audio
 *   recorder:level   — RMS level 0-1 for VU meter, fires at ~30fps
 */

class Recorder {
  constructor() {
    this._stream = null;
    this._recorder = null;
    this._chunks = [];
    this._analyser = null;
    this._rafId = null;
    this._recording = false;
    this._startTime = null;
  }

  get recording() { return this._recording; }

  get elapsedSeconds() {
    if (!this._startTime) return 0;
    return (Date.now() - this._startTime) / 1000;
  }

  async start() {
    if (this._recording) return;

    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      throw new Error('Microphone access denied: ' + e.message);
    }

    // Level meter via AnalyserNode
    const ctx = window.transport.context;
    const src = ctx.createMediaStreamSource(this._stream);
    this._analyser = ctx.createAnalyser();
    this._analyser.fftSize = 256;
    src.connect(this._analyser);

    this._chunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    this._recorder = new MediaRecorder(this._stream, { mimeType });
    this._recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._chunks.push(e.data);
    };

    this._recorder.onstop = () => {
      const blob = new Blob(this._chunks, { type: mimeType });
      this._emit('recorder:stop', { blob });
      this._chunks = [];
      this._stopStream();
    };

    this._recorder.start(100); // collect chunks every 100ms
    this._recording = true;
    this._startTime = Date.now();
    this._startLevelMonitor();
    this._emit('recorder:start', {});
  }

  stop() {
    if (!this._recording) return;
    this._recording = false;
    this._stopLevelMonitor();
    if (this._recorder && this._recorder.state !== 'inactive') {
      this._recorder.stop();
    }
  }

  _stopStream() {
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
  }

  _startLevelMonitor() {
    const buf = new Float32Array(this._analyser.fftSize);
    const tick = () => {
      if (!this._recording) return;
      this._analyser.getFloatTimeDomainData(buf);
      let rms = 0;
      for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
      rms = Math.sqrt(rms / buf.length);
      this._emit('recorder:level', { level: Math.min(1, rms * 4) });
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopLevelMonitor() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

window.recorder = new Recorder();
