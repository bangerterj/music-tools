/**
 * transport.js — Web Audio playback engine
 * Handles synchronized multi-track playback, scheduling, playhead animation.
 */

const transport = (() => {

  let audioCtx = null;
  let isPlaying = false;
  let startTime = 0;       // audioCtx time when play started
  let startOffset = 0;     // track time position when play started
  let playheadTime = 0;    // current track time in seconds
  let rafId = null;
  let masterGain = null;
  let loopEnabled = false;
  let loopStart = 0;
  let loopEnd = 4;

  // Per-track nodes: { trackId: { gain, panner, sources: [] } }
  const trackNodes = {};

  // Audio buffer cache: url → AudioBuffer
  const bufferCache = {};

  // ── AudioContext ─────────────────────────────────────────

  function getCtx() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.85;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // ── Play / Pause / Stop ──────────────────────────────────

  async function playPause() {
    if (isPlaying) {
      pause();
    } else {
      await play();
    }
  }

  async function play() {
    const project = app.state.project;
    if (!project || project.tracks.length === 0) return;

    const ctx = getCtx();
    const startAt = ctx.currentTime + 0.05; // small scheduling buffer

    // Stop any existing playback
    stopAllSources();

    isPlaying = true;
    startTime = startAt;
    startOffset = playheadTime;

    document.getElementById('btn-play').classList.add('active');

    const anySoloed = project.tracks.some(t => t.solo);

    // Schedule all clips
    for (const track of project.tracks) {
      if (track.muted) continue;
      if (anySoloed && !track.solo) continue;

      // Ensure track nodes exist
      ensureTrackNodes(track);

      for (const clip of track.clips) {
        await scheduleClip(ctx, track, clip, startAt, startOffset);
      }
    }

    // Start animation loop
    rafId = requestAnimationFrame(animateTick);
  }

  async function scheduleClip(ctx, track, clip, startAt, offset) {
    // Determine when this clip plays relative to playhead
    const clipEnd = clip.start + clip.duration;
    if (clipEnd <= offset) return; // already past

    const audioStart = Math.max(0, offset - clip.start); // trim start if playing mid-clip
    const delayFromNow = Math.max(0, clip.start - offset);

    const url = API.clipAudioUrl(app.state.project?.id, track.id, clip.id);
    let buffer;
    try {
      buffer = await loadBuffer(ctx, url);
    } catch (e) {
      console.warn(`Could not load audio for clip ${clip.id}:`, e);
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Connect through track gain/pan chain
    const nodes = trackNodes[track.id];
    if (!nodes) return;
    source.connect(nodes.gain);

    const when = startAt + delayFromNow;
    const offsetInBuffer = audioStart + (clip.offset || 0);
    const duration = clip.duration - audioStart;

    source.start(when, Math.max(0, offsetInBuffer), Math.max(0.01, duration));

    nodes.sources.push(source);

    // Loop handling: re-schedule at loop end
    source.onended = () => {
      if (isPlaying && loopEnabled) {
        // Will be handled by the tick loop
      }
    };
  }

  function pause() {
    isPlaying = false;
    stopAllSources();
    cancelAnimationFrame(rafId);
    document.getElementById('btn-play').classList.remove('active');
  }

  function stop() {
    isPlaying = false;
    stopAllSources();
    cancelAnimationFrame(rafId);
    playheadTime = 0;
    arrangement.setPlayheadPosition(0);
    updateTimeDisplay(0);
    document.getElementById('btn-play').classList.remove('active');
  }

  function returnToStart() {
    const wasPlaying = isPlaying;
    stop();
    playheadTime = 0;
    if (wasPlaying) play();
  }

  function seekTo(timeSec) {
    const wasPlaying = isPlaying;
    if (isPlaying) pause();
    playheadTime = Math.max(0, timeSec);
    arrangement.setPlayheadPosition(playheadTime);
    updateTimeDisplay(playheadTime);
    if (wasPlaying) play();
  }

  // ── Animation tick ───────────────────────────────────────

  function animateTick() {
    if (!isPlaying) return;

    const ctx = getCtx();
    const elapsed = ctx.currentTime - startTime;
    playheadTime = startOffset + elapsed;

    // Loop
    if (loopEnabled && playheadTime >= loopEnd) {
      playheadTime = loopStart;
      startTime = ctx.currentTime;
      startOffset = loopStart;
      stopAllSources();
      play(); // restart from loop start
      return;
    }

    arrangement.setPlayheadPosition(playheadTime);
    updateTimeDisplay(playheadTime);

    rafId = requestAnimationFrame(animateTick);
  }

  // ── Track nodes ──────────────────────────────────────────

  function ensureTrackNodes(track) {
    if (trackNodes[track.id]) return;

    const ctx = getCtx();

    const gain = ctx.createGain();
    gain.gain.value = track.muted ? 0 : track.volume;

    const panner = ctx.createStereoPanner();
    panner.pan.value = track.pan || 0;

    // Simple EQ chain: high-pass + low-pass + 3 peak bands
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 20;

    const eq1 = ctx.createBiquadFilter();
    eq1.type = 'peaking';
    eq1.frequency.value = 250;

    const eq2 = ctx.createBiquadFilter();
    eq2.type = 'peaking';
    eq2.frequency.value = 2500;

    const eq3 = ctx.createBiquadFilter();
    eq3.type = 'peaking';
    eq3.frequency.value = 10000;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 4;
    comp.attack.value = 0.01;
    comp.release.value = 0.1;

    // Chain: gain → hp → eq1 → eq2 → eq3 → comp → panner → master
    gain.connect(hp);
    hp.connect(eq1);
    eq1.connect(eq2);
    eq2.connect(eq3);
    eq3.connect(comp);
    comp.connect(panner);
    panner.connect(masterGain);

    trackNodes[track.id] = {
      gain, panner, hp, eq1, eq2, eq3, comp,
      sources: [],
    };
  }

  function stopAllSources() {
    Object.values(trackNodes).forEach(nodes => {
      nodes.sources.forEach(src => {
        try { src.stop(); } catch (e) {}
      });
      nodes.sources = [];
    });
  }

  // ── Track parameter updates ──────────────────────────────

  function updateTrackGain(trackId, track, anySoloed) {
    const nodes = trackNodes[trackId];
    if (!nodes) return;
    const shouldMute = track.muted || (anySoloed && !track.solo);
    nodes.gain.gain.setTargetAtTime(
      shouldMute ? 0 : track.volume,
      getCtx().currentTime, 0.02
    );
  }

  function updateTrackPan(trackId, pan) {
    const nodes = trackNodes[trackId];
    if (!nodes) return;
    nodes.panner.pan.setTargetAtTime(pan, getCtx().currentTime, 0.02);
  }

  function setMasterVolume(vol) {
    if (masterGain) {
      masterGain.gain.setTargetAtTime(vol, getCtx().currentTime, 0.02);
    }
  }

  function setLoop(enabled, start, end) {
    loopEnabled = enabled;
    loopStart = start;
    loopEnd = end;
  }

  // ── Buffer loading ───────────────────────────────────────

  async function loadBuffer(ctx, url) {
    if (bufferCache[url]) return bufferCache[url];
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    const decoded = await ctx.decodeAudioData(arrayBuf);
    bufferCache[url] = decoded;
    return decoded;
  }

  function clearBufferCache() {
    Object.keys(bufferCache).forEach(k => delete bufferCache[k]);
  }

  // ── Time display ─────────────────────────────────────────

  function updateTimeDisplay(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const ms = Math.floor((sec % 1) * 1000);
    document.getElementById('time-display').textContent =
      `${m}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
  }

  return {
    playPause, play, pause, stop, returnToStart, seekTo,
    updateTrackGain, updateTrackPan, setMasterVolume,
    setLoop,
    clearBufferCache,
    get isPlaying() { return isPlaying; },
    get playheadTime() { return playheadTime; },
  };
})();
