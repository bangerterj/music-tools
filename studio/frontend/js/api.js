/**
 * api.js — Backend communication layer
 * Handles all HTTP requests and the WebSocket connection for progress events.
 */

const API = (() => {
  const BASE = 'http://127.0.0.1:8765';
  let ws = null;
  let wsListeners = {};

  // ── WebSocket ────────────────────────────────────────────

  function connectWS() {
    if (ws && ws.readyState <= 1) return;
    ws = new WebSocket(`ws://127.0.0.1:8765/ws`);

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        const listeners = wsListeners[msg.type] || [];
        listeners.forEach(cb => cb(msg));
        const allListeners = wsListeners['*'] || [];
        allListeners.forEach(cb => cb(msg));
      } catch (err) {
        console.warn('WS parse error', err);
      }
    };

    ws.onclose = () => {
      // Reconnect after 2s if not intentional
      setTimeout(connectWS, 2000);
    };

    ws.onerror = (e) => console.warn('WS error', e);
  }

  function onWS(type, cb) {
    if (!wsListeners[type]) wsListeners[type] = [];
    wsListeners[type].push(cb);
    return () => {
      wsListeners[type] = wsListeners[type].filter(fn => fn !== cb);
    };
  }

  // ── HTTP helpers ─────────────────────────────────────────

  async function get(path) {
    const res = await fetch(BASE + path);
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    return res.json();
  }

  async function post(path, body) {
    const isForm = body instanceof FormData;
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: isForm ? {} : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} → ${res.status}: ${text}`);
    }
    return res.json();
  }

  // ── Project ──────────────────────────────────────────────

  async function newProject(name, bpm) {
    return post('/project/new', { name, bpm });
  }

  async function loadProject(id) {
    return get(`/project/${id}`);
  }

  async function saveProject(id, projectData) {
    return post(`/project/${id}/save`, projectData);
  }

  async function listProjects() {
    return get('/project/list');
  }

  // ── Audio serving ────────────────────────────────────────

  function clipAudioUrl(projectId, trackId, clipId) {
    return `${BASE}/project/${projectId}/audio/${trackId}/${clipId}`;
  }

  async function fetchAudioBuffer(url, audioCtx) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Audio fetch failed: ${res.status}`);
    const arrayBuf = await res.arrayBuffer();
    return audioCtx.decodeAudioData(arrayBuf);
  }

  // ── Recording ────────────────────────────────────────────

  async function uploadRecording(projectId, blob) {
    const fd = new FormData();
    fd.append('audio', blob, 'recording.webm');
    fd.append('project_id', projectId);
    return post('/record/stop', fd);
  }

  // ── Import ───────────────────────────────────────────────

  async function importAudio(projectId, file) {
    const fd = new FormData();
    fd.append('audio', file, file.name);
    fd.append('project_id', projectId);
    return post('/import', fd);
  }

  // ── Stem separation ──────────────────────────────────────

  async function separateStems(projectId, trackId, clipId) {
    return post(`/separate/${projectId}`, { track_id: trackId, clip_id: clipId });
  }

  // ── Generation ───────────────────────────────────────────

  async function generateBacking(projectId, opts) {
    // opts: { style, tracks, tempo, key }
    return post(`/generate/${projectId}`, opts);
  }

  // ── Effects ──────────────────────────────────────────────

  async function applyEffects(projectId, trackId, effectsChain) {
    return post(`/effects/${projectId}/${trackId}`, effectsChain);
  }

  // ── Export ───────────────────────────────────────────────

  async function exportMix(projectId, opts) {
    // opts: { format, mastering_ref, include_stems }
    return post(`/export/${projectId}`, opts);
  }

  async function downloadExport(projectId, jobId) {
    const url = `${BASE}/export/${projectId}/download/${jobId}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `studio_export_${Date.now()}.zip`;
    a.click();
  }

  // ── Health ───────────────────────────────────────────────

  async function health() {
    return get('/health');
  }

  // Init WS on load
  connectWS();

  return {
    onWS, connectWS, health,
    newProject, loadProject, saveProject, listProjects,
    clipAudioUrl, fetchAudioBuffer,
    uploadRecording, importAudio,
    separateStems, generateBacking,
    applyEffects, exportMix, downloadExport,
  };
})();
