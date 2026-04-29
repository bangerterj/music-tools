/**
 * api.js — Backend API client + WebSocket connection manager.
 * All fetch calls go through here so the rest of the app never touches URLs directly.
 */

const API_BASE = window.location.origin;

class ApiClient {
  constructor() {
    this._ws = null;
    this._handlers = {}; // job_id → callback(msg)
    this._globalHandlers = []; // called for every message
    this._reconnectDelay = 1000;
    this._connectWS();
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  _connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this._ws = new WebSocket(`${proto}://${location.host}/ws`);

    this._ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      // Dispatch to job-specific handler
      if (msg.job_id && this._handlers[msg.job_id]) {
        this._handlers[msg.job_id](msg);
      }
      // Dispatch to global handlers
      this._globalHandlers.forEach(h => h(msg));
    };

    this._ws.onclose = () => {
      setTimeout(() => this._connectWS(), this._reconnectDelay);
      this._reconnectDelay = Math.min(this._reconnectDelay * 2, 10000);
    };

    this._ws.onopen = () => { this._reconnectDelay = 1000; };
  }

  /** Register a handler for messages from a specific job. */
  onJob(jobId, handler) {
    this._handlers[jobId] = handler;
  }

  /** Register a handler for all WebSocket messages. */
  onAny(handler) {
    this._globalHandlers.push(handler);
  }

  removeJobHandler(jobId) {
    delete this._handlers[jobId];
  }

  // ── Health ────────────────────────────────────────────────────────────────

  async health() {
    const r = await fetch(`${API_BASE}/health`);
    return r.json();
  }

  // ── Project ───────────────────────────────────────────────────────────────

  async newProject(name = 'Untitled Project') {
    const r = await fetch(`${API_BASE}/project/new?name=${encodeURIComponent(name)}`, { method: 'POST' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async loadProject(id) {
    const r = await fetch(`${API_BASE}/project/${id}`);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async saveProject(project) {
    const r = await fetch(`${API_BASE}/project/${project.id}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  clipAudioUrl(projectId, trackId, clipId) {
    return `${API_BASE}/project/${projectId}/tracks/${trackId}/clip/${clipId}/audio`;
  }

  // ── Recording ─────────────────────────────────────────────────────────────

  async stopRecording(projectId, blob) {
    const fd = new FormData();
    fd.append('project_id', projectId);
    fd.append('audio', blob, 'recording.webm');
    const r = await fetch(`${API_BASE}/record/stop`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async importAudio(projectId, file, trackName) {
    const fd = new FormData();
    fd.append('project_id', projectId);
    fd.append('audio', file, file.name);
    fd.append('track_name', trackName || file.name.replace(/\.[^.]+$/, ''));
    const r = await fetch(`${API_BASE}/import`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // ── Stem separation ───────────────────────────────────────────────────────

  async separate(projectId, trackId, clipId) {
    const fd = new FormData();
    fd.append('track_id', trackId);
    fd.append('clip_id', clipId);
    const r = await fetch(`${API_BASE}/separate/${projectId}`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json(); // { job_id }
  }

  // ── MusicGen ──────────────────────────────────────────────────────────────

  async generate(projectId, { stylePrompt, duration = 30, bpm = 120, key = '' }) {
    const fd = new FormData();
    fd.append('style_prompt', stylePrompt);
    fd.append('duration', duration);
    fd.append('bpm', bpm);
    fd.append('key', key);
    const r = await fetch(`${API_BASE}/generate/${projectId}`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json(); // { job_id }
  }

  // ── MIDI render ───────────────────────────────────────────────────────────

  async renderMidi(projectId, { key = 'C major', bpm = 120, duration = 30 }) {
    const fd = new FormData();
    fd.append('key', key);
    fd.append('bpm', bpm);
    fd.append('duration', duration);
    const r = await fetch(`${API_BASE}/render/${projectId}`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  // ── Effects ───────────────────────────────────────────────────────────────

  async applyEffects(projectId, trackId, clipId, effectsChain) {
    const url = `${API_BASE}/effects/${projectId}/${trackId}?clip_id=${clipId}`;
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(effectsChain),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.blob();
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async exportProject(projectId, { format = 'wav', masteringStyle = 'neutral', includeStems = false }) {
    const fd = new FormData();
    fd.append('format', format);
    fd.append('mastering_style', masteringStyle);
    fd.append('include_stems', includeStems);
    const r = await fetch(`${API_BASE}/export/${projectId}`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text());
    return r.json(); // { job_id }
  }

  downloadExportUrl(projectId, jobId) {
    return `${API_BASE}/export/${projectId}/download/${jobId}`;
  }
}

window.api = new ApiClient();
