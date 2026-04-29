/**
 * app.js — Main application controller.
 *
 * Owns:
 *  - appState (project, selectedClip, selectedTrack, activeTool)
 *  - Undo/redo stack
 *  - Event coordination between modules
 *  - Modal management (generate, export, progress)
 */

window.appState = {
  project: null,
  selectedClip: null,
  selectedTrack: null,
  activeTool: 'select', // 'select' | 'cut' | 'draw'
};

// ── Undo/redo ─────────────────────────────────────────────────────────────────
const _history = [];
let _historyIdx = -1;
const MAX_HISTORY = 50;

function _snapshot() {
  if (!appState.project) return;
  const snap = JSON.parse(JSON.stringify(appState.project));
  // Truncate forward history
  _history.splice(_historyIdx + 1);
  _history.push(snap);
  if (_history.length > MAX_HISTORY) _history.shift();
  _historyIdx = _history.length - 1;
}

function _undo() {
  if (_historyIdx <= 0) return;
  _historyIdx--;
  appState.project = JSON.parse(JSON.stringify(_history[_historyIdx]));
  _renderAll();
}

function _redo() {
  if (_historyIdx >= _history.length - 1) return;
  _historyIdx++;
  appState.project = JSON.parse(JSON.stringify(_history[_historyIdx]));
  _renderAll();
}

// ── Module instances ──────────────────────────────────────────────────────────
let arrangement, mixer, effectsUI;

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  arrangement = new ArrangementView(document.getElementById('arrangementView'));
  mixer = new Mixer(document.getElementById('mixerStrips'));
  effectsUI = new EffectsUI();

  initShortcuts();
  _bindShortcuts();
  _bindToolbar();
  _bindProjectEvents();
  _bindGenerateModal();
  _bindExportModal();
  _bindImport();
  _bindProgress();

  // Check health + show GPU status
  try {
    const health = await window.api.health();
    _setStatus(`Backend ready — ${health.gpu ? 'GPU' : 'CPU'} · ${health.model}`);
  } catch (e) {
    _setStatus('Backend not reachable', true);
  }

  // Create or load a project
  const savedId = localStorage.getItem('studioProjectId');
  if (savedId) {
    try {
      const proj = await window.api.loadProject(savedId);
      appState.project = proj;
      document.getElementById('projectName').textContent = proj.name;
      document.getElementById('bpmInput').value = proj.bpm;
      _snapshot();
      _renderAll();
      _setStatus('Project loaded');
      return;
    } catch {}
  }

  // No saved project — create new
  const proj = await window.api.newProject('Untitled Project');
  appState.project = proj;
  localStorage.setItem('studioProjectId', proj.id);
  document.getElementById('projectName').textContent = proj.name;
  document.getElementById('bpmInput').value = proj.bpm;
  _snapshot();
  _renderAll();
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function _renderAll() {
  if (!appState.project) return;
  arrangement.render(appState.project);
  mixer.render(appState.project);
  _updateTrackCount();
}

function _updateTrackCount() {
  const count = appState.project?.tracks?.length || 0;
  const addBtn = document.getElementById('addTrackBtn');
  if (addBtn) addBtn.disabled = count >= 8;
}

// ── Project events ────────────────────────────────────────────────────────────

function _bindProjectEvents() {
  window.addEventListener('project:changed', (e) => {
    appState.project = e.detail;
    _snapshot();
    _renderAll();
    _autoSave();
  });

  // BPM input
  const bpmInput = document.getElementById('bpmInput');
  if (bpmInput) {
    bpmInput.addEventListener('change', () => {
      if (!appState.project) return;
      appState.project.bpm = parseFloat(bpmInput.value) || 120;
      _snapshot();
      arrangement.render(appState.project);
      _autoSave();
    });
  }

  // Project name edit
  const nameEl = document.getElementById('projectName');
  if (nameEl) {
    nameEl.addEventListener('dblclick', () => {
      const name = prompt('Project name:', appState.project?.name || 'Untitled');
      if (name && appState.project) {
        appState.project.name = name;
        nameEl.textContent = name;
        _autoSave();
      }
    });
  }
}

let _saveTimer = null;
async function _autoSave() {
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    if (!appState.project) return;
    try {
      await window.api.saveProject(appState.project);
    } catch (e) {
      console.warn('Auto-save failed:', e);
    }
  }, 2000);
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function _bindToolbar() {
  // Tool buttons
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      _setTool(btn.dataset.tool);
    });
  });

  // Transport buttons
  document.getElementById('playBtn')?.addEventListener('click', _playStop);
  document.getElementById('stopBtn')?.addEventListener('click', () => {
    window.transport.stop();
    _updateTransportUI(false);
  });
  document.getElementById('recBtn')?.addEventListener('click', _toggleRecord);
  document.getElementById('returnBtn')?.addEventListener('click', () => {
    window.transport.seek(0);
  });
  document.getElementById('loopBtn')?.addEventListener('click', () => {
    window.transport.toggleLoop();
    document.getElementById('loopBtn').classList.toggle('active', window.transport.looping);
  });

  // Separate stems button (on track headers — delegated)
  document.getElementById('arrangementView')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action=separate]');
    if (btn && appState.project) {
      const trackId = btn.dataset.trackId;
      const clipId = btn.dataset.clipId;
      _runSeparate(trackId, clipId);
    }
  });
}

function _setTool(tool) {
  appState.activeTool = tool;
  document.querySelectorAll('[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
}

// ── Transport ─────────────────────────────────────────────────────────────────

async function _playStop() {
  if (window.transport.playing) {
    window.transport.pause();
    _updateTransportUI(false);
  } else {
    _updateTransportUI(true);
    await window.transport.play(appState.project);
  }
}

function _updateTransportUI(playing) {
  const btn = document.getElementById('playBtn');
  if (btn) btn.textContent = playing ? '⏸' : '▶';
  btn?.classList.toggle('active', playing);
}

window.addEventListener('transport:stop', () => _updateTransportUI(false));
window.addEventListener('transport:pause', () => _updateTransportUI(false));

// ── Recording ─────────────────────────────────────────────────────────────────

let _recInterval = null;

async function _toggleRecord() {
  const btn = document.getElementById('recBtn');

  if (window.recorder.recording) {
    window.recorder.stop();
    btn?.classList.remove('active', 'recording');
    clearInterval(_recInterval);
    document.getElementById('recTimer').textContent = '';
    return;
  }

  try {
    await window.recorder.start();
    btn?.classList.add('active', 'recording');
    _recInterval = setInterval(() => {
      const s = Math.round(window.recorder.elapsedSeconds);
      document.getElementById('recTimer').textContent = _formatTime(s);
    }, 500);
  } catch (e) {
    _showError(e.message);
  }
}

window.addEventListener('recorder:stop', async (e) => {
  const { blob } = e.detail;
  if (!blob || !appState.project) return;
  try {
    _showProgress('Uploading recording…', 0.1);
    const result = await window.api.stopRecording(appState.project.id, blob);
    appState.project = result.project;
    _snapshot();
    _renderAll();
    _hideProgress();
    // Auto-trigger separate stems dialog
    _promptSeparate(result.track_id, result.clip_id);
  } catch (e) {
    _hideProgress();
    _showError('Recording upload failed: ' + e.message);
  }
});

window.addEventListener('recorder:level', (e) => {
  const meter = document.getElementById('vuMeter');
  if (meter) meter.style.width = (e.detail.level * 100) + '%';
});

function _promptSeparate(trackId, clipId) {
  if (confirm('Recording uploaded! Run stem separation now? (Demucs — takes ~1-2 min)')) {
    _runSeparate(trackId, clipId);
  }
}

// ── Stem separation ───────────────────────────────────────────────────────────

async function _runSeparate(trackId, clipId) {
  if (!appState.project) return;
  try {
    const { job_id } = await window.api.separate(appState.project.id, trackId, clipId);
    _showProgress('Starting stem separation…', 0.05, job_id);
    window.api.onJob(job_id, (msg) => {
      if (msg.type === 'progress') {
        _showProgress(msg.step, msg.progress, job_id);
      } else if (msg.type === 'complete') {
        window.api.removeJobHandler(job_id);
        _hideProgress();
        appState.project = msg.result.project;
        _snapshot();
        _renderAll();
        _setStatus('Stems separated ✓');
      } else if (msg.type === 'error') {
        window.api.removeJobHandler(job_id);
        _hideProgress();
        _showError('Separation failed: ' + msg.message);
      }
    });
  } catch (e) {
    _showError('Could not start separation: ' + e.message);
  }
}

// ── Generate modal ────────────────────────────────────────────────────────────

function _bindGenerateModal() {
  const modal = document.getElementById('generateModal');
  const openBtn = document.getElementById('generateBtn');
  const closeBtn = document.getElementById('genModalClose');
  const submitBtn = document.getElementById('genSubmit');

  openBtn?.addEventListener('click', () => modal?.classList.remove('hidden'));
  closeBtn?.addEventListener('click', () => modal?.classList.add('hidden'));
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  submitBtn?.addEventListener('click', async () => {
    const prompt = document.getElementById('genPrompt')?.value?.trim();
    if (!prompt) return;
    const duration = parseFloat(document.getElementById('genDuration')?.value || 30);
    const bpm = parseFloat(document.getElementById('genBpm')?.value || appState.project?.bpm || 120);
    const key = document.getElementById('genKey')?.value || '';

    modal?.classList.add('hidden');

    try {
      const { job_id } = await window.api.generate(appState.project.id, {
        stylePrompt: prompt, duration, bpm, key,
      });
      _showProgress('Starting AI generation…', 0.02, job_id);
      window.api.onJob(job_id, (msg) => {
        if (msg.type === 'progress') {
          _showProgress(msg.step, msg.progress, job_id);
        } else if (msg.type === 'complete') {
          window.api.removeJobHandler(job_id);
          _hideProgress();
          appState.project = msg.result.project;
          _snapshot();
          _renderAll();
          _setStatus('Generation complete ✓');
        } else if (msg.type === 'error') {
          window.api.removeJobHandler(job_id);
          _hideProgress();
          _showError('Generation failed: ' + msg.message);
        }
      });
    } catch (e) {
      _showError('Could not start generation: ' + e.message);
    }
  });
}

// ── Export modal ──────────────────────────────────────────────────────────────

function _bindExportModal() {
  const modal = document.getElementById('exportModal');
  const closeBtn = document.getElementById('expModalClose');
  const submitBtn = document.getElementById('expSubmit');

  window.addEventListener('app:exportRequest', () => modal?.classList.remove('hidden'));
  closeBtn?.addEventListener('click', () => modal?.classList.add('hidden'));
  modal?.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  submitBtn?.addEventListener('click', async () => {
    const format = document.getElementById('expFormat')?.value || 'wav';
    const style = document.getElementById('expMastering')?.value || 'neutral';
    modal?.classList.add('hidden');

    try {
      const { job_id } = await window.api.exportProject(appState.project.id, {
        format, masteringStyle: style,
      });
      _showProgress('Preparing export…', 0.02, job_id);
      window.api.onJob(job_id, (msg) => {
        if (msg.type === 'progress') {
          _showProgress(msg.step, msg.progress, job_id);
        } else if (msg.type === 'complete') {
          window.api.removeJobHandler(job_id);
          _hideProgress();
          // Trigger download
          const a = document.createElement('a');
          a.href = msg.result.download_url;
          a.download = msg.result.filename;
          a.click();
          _setStatus('Export complete ✓');
        } else if (msg.type === 'error') {
          window.api.removeJobHandler(job_id);
          _hideProgress();
          _showError('Export failed: ' + msg.message);
        }
      });
    } catch (e) {
      _showError('Could not start export: ' + e.message);
    }
  });
}

// ── File import ───────────────────────────────────────────────────────────────

function _bindImport() {
  const btn = document.getElementById('importBtn');
  const fileInput = document.getElementById('importFileInput');

  btn?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file || !appState.project) return;
    fileInput.value = '';
    try {
      _showProgress('Importing…', 0.1);
      const result = await window.api.importAudio(appState.project.id, file);
      appState.project = result.project;
      _snapshot();
      _renderAll();
      _hideProgress();
    } catch (e) {
      _hideProgress();
      _showError('Import failed: ' + e.message);
    }
  });
}

// ── Progress overlay ──────────────────────────────────────────────────────────

function _bindProgress() {
  // Already managed by _showProgress / _hideProgress
}

function _showProgress(step, pct, jobId) {
  const overlay = document.getElementById('progressOverlay');
  const stepEl = document.getElementById('progressStep');
  const barEl = document.getElementById('progressBar');
  if (overlay) overlay.classList.remove('hidden');
  if (stepEl) stepEl.textContent = step;
  if (barEl) barEl.style.width = Math.round((pct || 0) * 100) + '%';
}

function _hideProgress() {
  const overlay = document.getElementById('progressOverlay');
  if (overlay) overlay.classList.add('hidden');
}

// ── Keyboard shortcut handlers ────────────────────────────────────────────────

function _bindShortcuts() {
  window.addEventListener('shortcut:playStop', _playStop);
  window.addEventListener('shortcut:record', _toggleRecord);
  window.addEventListener('shortcut:returnToStart', () => window.transport.seek(0));
  window.addEventListener('shortcut:toggleLoop', () => {
    window.transport.toggleLoop();
    document.getElementById('loopBtn')?.classList.toggle('active', window.transport.looping);
  });
  window.addEventListener('shortcut:tool', (e) => _setTool(e.detail));
  window.addEventListener('shortcut:save', async () => {
    if (!appState.project) return;
    await window.api.saveProject(appState.project);
    _setStatus('Saved ✓');
  });
  window.addEventListener('shortcut:undo', _undo);
  window.addEventListener('shortcut:redo', _redo);
  window.addEventListener('shortcut:zoomIn', () => arrangement.zoomIn());
  window.addEventListener('shortcut:zoomOut', () => arrangement.zoomOut());
  window.addEventListener('shortcut:escape', () => {
    document.querySelectorAll('.arr-clip.selected').forEach(el => el.classList.remove('selected'));
    appState.selectedClip = null;
    appState.selectedTrack = null;
  });
  window.addEventListener('shortcut:delete', () => {
    const { selectedClip, selectedTrack, project } = appState;
    if (!selectedClip || !selectedTrack || !project) return;
    selectedTrack.clips = selectedTrack.clips.filter(c => c.id !== selectedClip.id);
    appState.selectedClip = null;
    window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
  });
  window.addEventListener('shortcut:duplicate', () => {
    const { selectedClip, selectedTrack, project } = appState;
    if (!selectedClip || !selectedTrack || !project) return;
    const dup = { ...selectedClip, id: crypto.randomUUID(), start: selectedClip.start + selectedClip.duration };
    selectedTrack.clips.push(dup);
    window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
  });
  window.addEventListener('shortcut:mute', () => {
    const { selectedTrack, project } = appState;
    if (!selectedTrack || !project) return;
    selectedTrack.muted = !selectedTrack.muted;
    window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
  });
  window.addEventListener('shortcut:solo', () => {
    const { selectedTrack, project } = appState;
    if (!selectedTrack || !project) return;
    selectedTrack.solo = !selectedTrack.solo;
    window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
  });
}

// ── Status bar ────────────────────────────────────────────────────────────────

function _setStatus(msg, error = false) {
  const el = document.getElementById('statusBar');
  if (!el) return;
  el.textContent = msg;
  el.className = error ? 'status-bar error' : 'status-bar';
}

function _showError(msg) {
  _setStatus('Error: ' + msg, true);
  console.error(msg);
}

// ── Time format helper ────────────────────────────────────────────────────────

function _formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
