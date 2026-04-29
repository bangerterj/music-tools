/**
 * app.js — Main application controller and state manager
 * Owns the project state, coordinates all modules, handles modals.
 */

const app = (() => {

  // ── State ────────────────────────────────────────────────

  let state = {
    project: null,       // current project JSON
    selectedTrackId: null,
    selectedClipId: null,
    currentTool: 'select', // 'select' | 'cut' | 'draw'
    snapEnabled: true,
    loopEnabled: false,
    loopStart: 0,
    loopEnd: 4,
    zoom: 100,           // pixels per second
    isPlaying: false,
    isRecording: false,
    undoStack: [],
    redoStack: [],
  };

  const TRACK_COLORS = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
    '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  ];

  // ── Init ─────────────────────────────────────────────────

  async function init() {
    // Check backend health
    try {
      const health = await API.health();
      console.log('Backend ready:', health);
    } catch (e) {
      showError('Cannot connect to Studio backend. Make sure the server is running.');
      return;
    }

    // Create a default project
    await createNewProject('Untitled Project', 120);

    // Wire up toolbar buttons
    bindToolbar();

    // Wire up WebSocket progress
    API.onWS('progress', handleProgress);
    API.onWS('complete', handleJobComplete);
    API.onWS('error', handleJobError);

    // Wire up modal close buttons
    document.querySelectorAll('[data-close]').forEach(btn => {
      btn.addEventListener('click', () => closeModal(btn.dataset.close));
    });

    // Close modals on overlay click
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal(overlay.id);
      });
    });

    // Close context menu on click elsewhere
    document.addEventListener('click', () => {
      document.getElementById('context-menu').classList.remove('open');
    });

    console.log('Studio initialized');
  }

  // ── Project management ───────────────────────────────────

  async function createNewProject(name, bpm) {
    try {
      showProgress('Creating project…', 0);
      const project = await API.newProject(name, bpm);
      state.project = project;
      hideProgress();
      render();
      document.getElementById('project-name-display').textContent = project.name;
      document.getElementById('bpm-display').value = project.bpm;
    } catch (e) {
      hideProgress();
      showError('Failed to create project: ' + e.message);
    }
  }

  async function saveProject() {
    if (!state.project) return;
    try {
      await API.saveProject(state.project.id, state.project);
    } catch (e) {
      showError('Save failed: ' + e.message);
    }
  }

  // ── Toolbar bindings ─────────────────────────────────────

  function bindToolbar() {
    // Tools
    document.getElementById('tool-select').addEventListener('click', () => setTool('select'));
    document.getElementById('tool-cut').addEventListener('click', () => setTool('cut'));
    document.getElementById('tool-draw').addEventListener('click', () => setTool('draw'));

    // Transport
    document.getElementById('btn-record').addEventListener('click', () => recorder.toggleRecord());
    document.getElementById('btn-play').addEventListener('click', () => transport.playPause());
    document.getElementById('btn-stop').addEventListener('click', () => transport.stop());
    document.getElementById('btn-return').addEventListener('click', () => transport.returnToStart());
    document.getElementById('btn-loop').addEventListener('click', toggleLoop);

    // BPM
    document.getElementById('bpm-display').addEventListener('change', (e) => {
      if (state.project) {
        state.project.bpm = parseFloat(e.target.value) || 120;
        arrangement.redrawGrid();
      }
    });

    // Generate
    document.getElementById('btn-generate').addEventListener('click', () => openModal('modal-generate'));
    document.getElementById('btn-generate-go').addEventListener('click', runGenerate);

    // Import
    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file-input').click();
    });
    document.getElementById('import-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) await importAudioFile(file);
      e.target.value = '';
    });

    // Zoom
    document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(state.zoom * 1.5));
    document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(state.zoom / 1.5));

    // Snap
    document.getElementById('btn-snap').addEventListener('click', () => {
      state.snapEnabled = !state.snapEnabled;
      document.getElementById('btn-snap').classList.toggle('active', state.snapEnabled);
    });

    // Export
    document.getElementById('btn-export').addEventListener('click', () => openModal('modal-export'));
    document.getElementById('btn-export-go').addEventListener('click', runExport);

    // New project
    document.getElementById('btn-new-project').addEventListener('click', () => openModal('modal-new-project'));
    document.getElementById('btn-new-project-go').addEventListener('click', async () => {
      const name = document.getElementById('new-project-name').value.trim() || 'Untitled Project';
      const bpm = parseInt(document.getElementById('new-project-bpm').value) || 120;
      closeModal('modal-new-project');
      await createNewProject(name, bpm);
    });

    // Project name rename
    document.getElementById('project-name-display').addEventListener('click', () => {
      const name = prompt('Project name:', state.project?.name || 'Untitled');
      if (name && state.project) {
        state.project.name = name;
        document.getElementById('project-name-display').textContent = name;
      }
    });

    // Add track
    document.getElementById('add-track-btn').addEventListener('click', addEmptyTrack);

    // FX panel close
    document.getElementById('fx-close-btn').addEventListener('click', () => fxUI.close());
    document.getElementById('fx-close-btn2').addEventListener('click', () => fxUI.close());

    // Master fader
    document.getElementById('master-fader').addEventListener('input', (e) => {
      transport.setMasterVolume(e.target.value / 100);
    });

    // AI Mastering shortcut
    document.getElementById('btn-ai-mastering').addEventListener('click', () => openModal('modal-export'));
  }

  // ── Tools ────────────────────────────────────────────────

  function setTool(tool) {
    state.currentTool = tool;
    ['select', 'cut', 'draw'].forEach(t => {
      document.getElementById(`tool-${t}`).classList.toggle('active', t === tool);
    });
    const scroll = document.getElementById('arrangement-scroll');
    scroll.className = `tool-${tool}`;
    arrangement.setTool(tool);
  }

  // ── Loop ─────────────────────────────────────────────────

  function toggleLoop() {
    state.loopEnabled = !state.loopEnabled;
    document.getElementById('btn-loop').classList.toggle('active', state.loopEnabled);
    arrangement.showLoopRegion(state.loopEnabled);
    transport.setLoop(state.loopEnabled, state.loopStart, state.loopEnd);
  }

  // ── Zoom ─────────────────────────────────────────────────

  function setZoom(pxPerSec) {
    state.zoom = Math.max(20, Math.min(800, pxPerSec));
    document.getElementById('zoom-label').textContent = Math.round(state.zoom) + '%';
    arrangement.setZoom(state.zoom);
  }

  // ── Track management ─────────────────────────────────────

  function addEmptyTrack() {
    if (!state.project) return;
    if (state.project.tracks.length >= 8) {
      showError('Maximum 8 tracks reached.');
      return;
    }
    const idx = state.project.tracks.length;
    const track = {
      id: 'track_' + Date.now(),
      name: `Track ${idx + 1}`,
      type: 'audio',
      color: TRACK_COLORS[idx % TRACK_COLORS.length],
      muted: false,
      solo: false,
      volume: 0.8,
      pan: 0.0,
      clips: [],
      effects: defaultEffects(),
    };
    pushUndo({ type: 'add_track', track });
    state.project.tracks.push(track);
    render();
    saveProject();
  }

  function removeTrack(trackId) {
    if (!state.project) return;
    const idx = state.project.tracks.findIndex(t => t.id === trackId);
    if (idx === -1) return;
    pushUndo({ type: 'remove_track', track: state.project.tracks[idx], index: idx });
    state.project.tracks.splice(idx, 1);
    if (state.selectedTrackId === trackId) state.selectedTrackId = null;
    render();
    saveProject();
  }

  function selectTrack(trackId) {
    state.selectedTrackId = trackId;
    document.querySelectorAll('.track-header').forEach(el => {
      el.classList.toggle('selected', el.dataset.trackId === trackId);
    });
    document.querySelectorAll('.mixer-track').forEach(el => {
      el.classList.toggle('selected', el.dataset.trackId === trackId);
    });
  }

  function setTrackMute(trackId, muted) {
    const track = getTrack(trackId);
    if (!track) return;
    track.muted = muted;
    transport.updateTrackGain(trackId, track);
    renderTrackHeader(trackId);
    renderMixerTrack(trackId);
  }

  function setTrackSolo(trackId, solo) {
    const track = getTrack(trackId);
    if (!track) return;
    track.solo = solo;
    // If any track is soloed, mute all non-soloed tracks in transport
    const anySoloed = state.project.tracks.some(t => t.solo);
    state.project.tracks.forEach(t => {
      transport.updateTrackGain(t.id, t, anySoloed);
    });
    renderTrackHeader(trackId);
    renderMixerTrack(trackId);
  }

  function setTrackVolume(trackId, volume) {
    const track = getTrack(trackId);
    if (!track) return;
    track.volume = volume;
    transport.updateTrackGain(trackId, track);
  }

  function setTrackPan(trackId, pan) {
    const track = getTrack(trackId);
    if (!track) return;
    track.pan = pan;
    transport.updateTrackPan(trackId, pan);
  }

  // ── Clip management ──────────────────────────────────────

  function selectClip(trackId, clipId) {
    state.selectedTrackId = trackId;
    state.selectedClipId = clipId;
    document.querySelectorAll('.clip').forEach(el => {
      el.classList.toggle('selected', el.dataset.clipId === clipId);
    });
    selectTrack(trackId);
  }

  function deleteClip(trackId, clipId) {
    const track = getTrack(trackId);
    if (!track) return;
    const idx = track.clips.findIndex(c => c.id === clipId);
    if (idx === -1) return;
    pushUndo({ type: 'delete_clip', clip: track.clips[idx], trackId, index: idx });
    track.clips.splice(idx, 1);
    arrangement.removeClipElement(clipId);
    saveProject();
  }

  function moveClip(trackId, clipId, newStart) {
    const clip = getClip(trackId, clipId);
    if (!clip) return;
    const old = clip.start;
    pushUndo({ type: 'move_clip', trackId, clipId, oldStart: old, newStart });
    clip.start = Math.max(0, newStart);
    saveProject();
  }

  function resizeClip(trackId, clipId, newDuration) {
    const clip = getClip(trackId, clipId);
    if (!clip) return;
    clip.duration = Math.max(0.1, newDuration);
    saveProject();
  }

  function splitClip(trackId, clipId, atTime) {
    const track = getTrack(trackId);
    const clip = getClip(trackId, clipId);
    if (!track || !clip) return;
    const localTime = atTime - clip.start;
    if (localTime <= 0.05 || localTime >= clip.duration - 0.05) return;

    const rightClip = {
      id: 'clip_' + Date.now() + '_r',
      file: clip.file,
      start: clip.start + localTime,
      duration: clip.duration - localTime,
      offset: clip.offset + localTime,
      color: clip.color,
    };
    const leftDuration = localTime;
    pushUndo({ type: 'split', trackId, clipId, rightClip, leftDuration });
    clip.duration = leftDuration;
    track.clips.push(rightClip);
    render();
    saveProject();
  }

  function duplicateClip(trackId, clipId) {
    const track = getTrack(trackId);
    const clip = getClip(trackId, clipId);
    if (!track || !clip) return;
    const dup = {
      ...clip,
      id: 'clip_' + Date.now(),
      start: clip.start + clip.duration + 0.1,
    };
    track.clips.push(dup);
    arrangement.addClipElement(trackId, dup);
    saveProject();
  }

  // ── Stem separation ──────────────────────────────────────

  async function separateStems(trackId, clipId) {
    if (!state.project) return;
    showProgress('Separating stems with Demucs…', 0);
    try {
      const result = await API.separateStems(state.project.id, trackId, clipId);
      // Job started — progress comes via WebSocket
      pendingJob(result.job_id, 'separate');
    } catch (e) {
      hideProgress();
      showError('Stem separation failed: ' + e.message);
    }
  }

  // ── AI Generation ────────────────────────────────────────

  async function runGenerate() {
    if (!state.project) return;
    const style = document.getElementById('gen-style').value.trim();
    if (!style) { showError('Please enter a style description.'); return; }

    const tracks = [...document.querySelectorAll('input[name="gen-track"]:checked')]
      .map(el => el.value);
    if (tracks.length === 0) { showError('Select at least one track type to generate.'); return; }

    const tempo = parseFloat(document.getElementById('gen-tempo').value) || null;
    const key = document.getElementById('gen-key').value.trim() || null;

    closeModal('modal-generate');
    showProgress('Starting AI generation…', 0);

    try {
      const result = await API.generateBacking(state.project.id, {
        style, tracks, tempo, key,
      });
      pendingJob(result.job_id, 'generate');
    } catch (e) {
      hideProgress();
      showError('Generation failed: ' + e.message);
    }
  }

  // ── Import ───────────────────────────────────────────────

  async function importAudioFile(file) {
    if (!state.project) return;
    showProgress(`Importing ${file.name}…`, 0);
    try {
      const result = await API.importAudio(state.project.id, file);
      // Returns new track + clip
      state.project.tracks.push(result.track);
      render();
      hideProgress();
      // Offer to separate stems
      if (confirm(`"${file.name}" imported. Separate into stems with Demucs?`)) {
        const clip = result.track.clips[0];
        await separateStems(result.track.id, clip.id);
      }
    } catch (e) {
      hideProgress();
      showError('Import failed: ' + e.message);
    }
  }

  // ── Export ───────────────────────────────────────────────

  async function runExport() {
    if (!state.project) return;
    const format = document.getElementById('export-format').value;
    const masterRef = document.getElementById('export-master-ref').value;
    const includeStems = document.getElementById('export-stems').checked;

    closeModal('modal-export');
    showProgress('Preparing export…', 0);

    try {
      const result = await API.exportMix(state.project.id, {
        format,
        mastering_ref: masterRef,
        include_stems: includeStems,
      });
      pendingJob(result.job_id, 'export');
    } catch (e) {
      hideProgress();
      showError('Export failed: ' + e.message);
    }
  }

  // ── Job tracking ─────────────────────────────────────────

  const activeJobs = {};

  function pendingJob(jobId, type) {
    activeJobs[jobId] = type;
  }

  function handleProgress(msg) {
    const pct = Math.round((msg.progress || 0) * 100);
    document.getElementById('progress-step').textContent = msg.step || 'Working…';
    document.getElementById('progress-bar').style.width = pct + '%';
    if (msg.eta) {
      document.getElementById('progress-eta').textContent = `~${msg.eta}s remaining`;
    }
  }

  async function handleJobComplete(msg) {
    hideProgress();
    const type = activeJobs[msg.job_id];
    delete activeJobs[msg.job_id];

    if (!msg.result) return;

    if (type === 'separate' || type === 'generate') {
      // New tracks added — reload project
      const updated = await API.loadProject(state.project.id);
      state.project = updated;
      render();
    } else if (type === 'export') {
      // Download the result
      await API.downloadExport(state.project.id, msg.job_id);
    }
  }

  function handleJobError(msg) {
    hideProgress();
    delete activeJobs[msg.job_id];
    showError(msg.message || 'An error occurred.');
  }

  // ── Undo / Redo ──────────────────────────────────────────

  function pushUndo(action) {
    state.undoStack.push(action);
    state.redoStack = [];
  }

  function undo() {
    const action = state.undoStack.pop();
    if (!action) return;
    applyUndo(action);
    state.redoStack.push(action);
    render();
  }

  function redo() {
    const action = state.redoStack.pop();
    if (!action) return;
    applyRedo(action);
    state.undoStack.push(action);
    render();
  }

  function applyUndo(action) {
    switch (action.type) {
      case 'move_clip': {
        const clip = getClip(action.trackId, action.clipId);
        if (clip) clip.start = action.oldStart;
        break;
      }
      case 'delete_clip': {
        const track = getTrack(action.trackId);
        if (track) track.clips.splice(action.index, 0, action.clip);
        break;
      }
      case 'add_track': {
        const idx = state.project.tracks.findIndex(t => t.id === action.track.id);
        if (idx !== -1) state.project.tracks.splice(idx, 1);
        break;
      }
      case 'remove_track': {
        state.project.tracks.splice(action.index, 0, action.track);
        break;
      }
    }
  }

  function applyRedo(action) {
    switch (action.type) {
      case 'move_clip': {
        const clip = getClip(action.trackId, action.clipId);
        if (clip) clip.start = action.newStart;
        break;
      }
      case 'delete_clip': {
        const track = getTrack(action.trackId);
        if (track) {
          const idx = track.clips.findIndex(c => c.id === action.clip.id);
          if (idx !== -1) track.clips.splice(idx, 1);
        }
        break;
      }
      case 'add_track': {
        state.project.tracks.push(action.track);
        break;
      }
      case 'remove_track': {
        const idx = state.project.tracks.findIndex(t => t.id === action.track.id);
        if (idx !== -1) state.project.tracks.splice(idx, 1);
        break;
      }
    }
  }

  // ── Render ───────────────────────────────────────────────

  function render() {
    if (!state.project) return;
    arrangement.render(state.project, state.zoom);
    mixer.render(state.project);
    const btn = document.getElementById('add-track-btn');
    btn.disabled = state.project.tracks.length >= 8;
  }

  function renderTrackHeader(trackId) {
    arrangement.renderTrackHeader(trackId, getTrack(trackId));
  }

  function renderMixerTrack(trackId) {
    mixer.renderTrack(trackId, getTrack(trackId));
  }

  // ── Helpers ──────────────────────────────────────────────

  function getTrack(trackId) {
    return state.project?.tracks.find(t => t.id === trackId) || null;
  }

  function getClip(trackId, clipId) {
    return getTrack(trackId)?.clips.find(c => c.id === clipId) || null;
  }

  function defaultEffects() {
    return {
      eq: { bands: [], enabled: true },
      compression: { threshold: -24, ratio: 4, attack_ms: 10, release_ms: 100, makeup_gain: 0, enabled: true },
      reverb: { room_size: 0.3, wet_dry: 0.2, damping: 0.5, enabled: false },
      delay: { time_ms: 250, feedback: 0.3, wet_dry: 0.15, enabled: false },
    };
  }

  // ── Modals ───────────────────────────────────────────────

  function openModal(id) {
    document.getElementById(id)?.classList.add('open');
  }

  function closeModal(id) {
    document.getElementById(id)?.classList.remove('open');
  }

  // ── Progress ─────────────────────────────────────────────

  function showProgress(step, pct) {
    const overlay = document.getElementById('progress-overlay');
    overlay.classList.add('open');
    document.getElementById('progress-step').textContent = step;
    document.getElementById('progress-bar').style.width = (pct * 100) + '%';
    document.getElementById('progress-eta').textContent = '';
  }

  function hideProgress() {
    document.getElementById('progress-overlay').classList.remove('open');
  }

  // ── Error ────────────────────────────────────────────────

  function showError(msg) {
    console.error(msg);
    // Simple toast — replace with richer UI if desired
    const el = document.createElement('div');
    el.style.cssText = `
      position:fixed;bottom:${170 + 12}px;left:50%;transform:translateX(-50%);
      background:#c62828;color:white;padding:10px 20px;border-radius:4px;
      font-size:13px;z-index:9999;max-width:400px;text-align:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.5);
    `;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  // ── Boot ─────────────────────────────────────────────────

  window.addEventListener('DOMContentLoaded', init);

  return {
    get state() { return state; },
    openModal, closeModal,
    showProgress, hideProgress, showError,
    selectTrack, selectClip,
    setTrackMute, setTrackSolo, setTrackVolume, setTrackPan,
    addEmptyTrack, removeTrack,
    deleteClip, moveClip, resizeClip, splitClip, duplicateClip,
    separateStems,
    undo, redo,
    saveProject,
    render,
    getTrack, getClip,
    TRACK_COLORS,
    defaultEffects,
  };
})();
