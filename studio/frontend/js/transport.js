/**
 * transport.js — Web Audio API playback engine + transport state.
 *
 * Responsibilities:
 *  - Maintain play/pause/stop state and playhead position
 *  - Schedule AudioBufferSourceNodes for all clips at play time
 *  - Apply per-track gain, pan, basic EQ and compression via Web Audio nodes
 *  - Animate playhead using requestAnimationFrame
 *  - Emit 'transport:tick' events so the arrangement view can update
 */

class Transport {
  constructor() {
    this._ctx = null;
    this._sources = []; // active AudioBufferSourceNodes
    this._startedAt = 0; // ctx.currentTime when playback began
    this._startOffset = 0; // playhead position at the time play was pressed
    this._playing = false;
    this._looping = false;
    this._loopStart = 0;
    this._loopEnd = 8; // seconds
    this._rafId = null;
    this._bufferCache = {}; // url → AudioBuffer
  }

  get context() {
    if (!this._ctx) {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return this._ctx;
  }

  get currentTime() {
    if (!this._playing) return this._startOffset;
    return this._startOffset + (this.context.currentTime - this._startedAt);
  }

  get playing() { return this._playing; }
  get looping() { return this._looping; }

  setLoop(enabled, start, end) {
    this._looping = enabled;
    this._loopStart = start;
    this._loopEnd = end;
  }

  // ── Playback control ──────────────────────────────────────────────────────

  async play(project) {
    if (this._playing) return;
    this._ctx = this.context;

    if (this._ctx.state === 'suspended') {
      await this._ctx.resume();
    }

    this._playing = true;
    this._startedAt = this._ctx.currentTime;

    const playhead = this._startOffset;
    const activeTracks = this._activeTracks(project);

    for (const track of activeTracks) {
      for (const clip of track.clips) {
        const clipEnd = clip.start + clip.duration;
        if (clipEnd <= playhead) continue; // clip already passed

        const url = window.api.clipAudioUrl(project.id, track.id, clip.id);
        let buffer;
        try {
          buffer = await this._loadBuffer(url);
        } catch (e) {
          console.warn(`Could not load clip ${clip.id}:`, e);
          continue;
        }

        const gain = this._ctx.createGain();
        gain.gain.value = track.volume ?? 0.8;

        const panner = this._ctx.createStereoPanner();
        panner.pan.value = track.pan ?? 0;

        const compressor = this._ctx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.01;
        compressor.release.value = 0.1;

        gain.connect(panner);
        panner.connect(compressor);
        compressor.connect(this._ctx.destination);

        const src = this._ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(gain);

        // Determine when to start this clip
        let scheduleOffset = clip.start - playhead; // seconds from now
        let bufferOffset = clip.offset || 0;

        if (scheduleOffset < 0) {
          // Clip started before playhead — start from middle of clip
          bufferOffset += -scheduleOffset;
          scheduleOffset = 0;
        }

        const startAt = this._ctx.currentTime + scheduleOffset;
        const duration = clip.duration - (bufferOffset - (clip.offset || 0));

        if (duration <= 0) continue;

        src.start(startAt, bufferOffset, duration);
        this._sources.push(src);
      }
    }

    this._startRaf();
  }

  stop() {
    if (!this._playing) return;
    this._playing = false;
    this._stopAllSources();
    this._stopRaf();
    this._startOffset = 0;
    this._emit('transport:stop', { time: 0 });
  }

  pause() {
    if (!this._playing) return;
    this._startOffset = this.currentTime;
    this._playing = false;
    this._stopAllSources();
    this._stopRaf();
    this._emit('transport:pause', { time: this._startOffset });
  }

  seek(seconds) {
    const wasPlaying = this._playing;
    if (wasPlaying) {
      this._playing = false;
      this._stopAllSources();
      this._stopRaf();
    }
    this._startOffset = Math.max(0, seconds);
    this._emit('transport:seek', { time: this._startOffset });
    if (wasPlaying && window.appState) {
      this.play(window.appState.project);
    }
  }

  toggleLoop(start, end) {
    this._looping = !this._looping;
    if (start !== undefined) this._loopStart = start;
    if (end !== undefined) this._loopEnd = end;
    this._emit('transport:loop', { looping: this._looping });
  }

  // ── Buffer management ─────────────────────────────────────────────────────

  async _loadBuffer(url) {
    if (this._bufferCache[url]) return this._bufferCache[url];
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuf = await resp.arrayBuffer();
    const audioBuf = await this.context.decodeAudioData(arrayBuf);
    this._bufferCache[url] = audioBuf;
    return audioBuf;
  }

  invalidateBuffer(url) {
    delete this._bufferCache[url];
  }

  invalidateAll() {
    this._bufferCache = {};
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _activeTracks(project) {
    const tracks = project.tracks || [];
    const soloed = tracks.filter(t => t.solo);
    const pool = soloed.length ? soloed : tracks;
    return pool.filter(t => !t.muted);
  }

  _stopAllSources() {
    for (const src of this._sources) {
      try { src.stop(); } catch {}
      try { src.disconnect(); } catch {}
    }
    this._sources = [];
  }

  _startRaf() {
    const tick = () => {
      const t = this.currentTime;

      // Loop region
      if (this._looping && t >= this._loopEnd) {
        this._stopAllSources();
        this._startOffset = this._loopStart;
        this._startedAt = this._ctx.currentTime;
        if (window.appState) this.play(window.appState.project);
        return;
      }

      this._emit('transport:tick', { time: t });

      if (this._playing) {
        this._rafId = requestAnimationFrame(tick);
      }
    };
    this._rafId = requestAnimationFrame(tick);
  }

  _stopRaf() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _emit(name, detail) {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  }
}

window.transport = new Transport();
