/**
 * arrangement.js — Arrangement view: track lanes, clips, playhead, zoom/scroll.
 *
 * Relies on:
 *  window.appState  — { project, selectedClip, selectedTrack, activeTool }
 *  window.transport — Transport instance
 *  WaveSurfer       — loaded from CDN
 */

const PX_PER_SEC_DEFAULT = 100;
const TRACK_HEIGHT = 72;
const HEADER_WIDTH = 200;
const MIN_CLIP_WIDTH = 4;
const SNAP_GRID = 0.25; // seconds

class ArrangementView {
  constructor(containerEl) {
    this.container = containerEl;
    this.pxPerSec = PX_PER_SEC_DEFAULT;
    this._wavesurfers = {}; // clipId → WaveSurfer
    this._dragState = null;
    this._resizeState = null;
    this._playheadEl = null;
    this._rulerEl = null;
    this._lanesEl = null;

    this._build();
    this._bindTransport();
  }

  // ── DOM construction ──────────────────────────────────────────────────────

  _build() {
    this.container.innerHTML = `
      <div class="arr-ruler" id="arrRuler"></div>
      <div class="arr-lanes" id="arrLanes">
        <div class="arr-playhead" id="arrPlayhead"></div>
      </div>
    `;
    this._rulerEl = this.container.querySelector('#arrRuler');
    this._lanesEl = this.container.querySelector('#arrLanes');
    this._playheadEl = this.container.querySelector('#arrPlayhead');

    // Click on ruler to seek
    this._rulerEl.addEventListener('click', (e) => {
      const x = e.clientX - this._rulerEl.getBoundingClientRect().left + this._lanesEl.scrollLeft;
      const t = Math.max(0, x / this.pxPerSec);
      window.transport.seek(t);
    });

    // Scroll sync between ruler and lanes
    this._lanesEl.addEventListener('scroll', () => {
      this._rulerEl.scrollLeft = this._lanesEl.scrollLeft;
    });
  }

  // ── Full render ───────────────────────────────────────────────────────────

  render(project) {
    if (!project) return;
    this._renderRuler(project);
    this._renderLanes(project);
  }

  _renderRuler(project) {
    const totalSecs = this._totalDuration(project) + 30;
    const width = totalSecs * this.pxPerSec;
    this._rulerEl.style.width = width + 'px';

    let html = '';
    const barDuration = (60 / project.bpm) * 4;
    const numBars = Math.ceil(totalSecs / barDuration) + 1;
    for (let b = 0; b < numBars; b++) {
      const t = b * barDuration;
      const left = t * this.pxPerSec;
      html += `<div class="ruler-mark bar" style="left:${left}px"><span>${b + 1}</span></div>`;
      // Beat marks
      for (let beat = 1; beat < 4; beat++) {
        const bt = t + beat * (60 / project.bpm);
        html += `<div class="ruler-mark beat" style="left:${bt * this.pxPerSec}px"></div>`;
      }
    }
    this._rulerEl.innerHTML = html;
  }

  _renderLanes(project) {
    const totalSecs = this._totalDuration(project) + 30;
    const contentWidth = totalSecs * this.pxPerSec;

    // Preserve scroll position
    const scrollLeft = this._lanesEl.scrollLeft;
    const scrollTop = this._lanesEl.scrollTop;

    // Destroy old wavesurfers
    Object.values(this._wavesurfers).forEach(ws => { try { ws.destroy(); } catch {} });
    this._wavesurfers = {};

    let html = '';
    (project.tracks || []).forEach((track, idx) => {
      html += `
        <div class="arr-lane" data-track-id="${track.id}" style="height:${TRACK_HEIGHT}px;min-width:${contentWidth}px">
      `;
      (track.clips || []).forEach(clip => {
        const left = clip.start * this.pxPerSec;
        const width = Math.max(MIN_CLIP_WIDTH, clip.duration * this.pxPerSec);
        html += `
          <div class="arr-clip" data-clip-id="${clip.id}" data-track-id="${track.id}"
               style="left:${left}px;width:${width}px;border-color:${track.color}"
               title="${clip.id}">
            <div class="arr-clip-header" style="background:${track.color}">
              <span class="arr-clip-name">${track.name}</span>
            </div>
            <div class="arr-clip-wave" id="wave-${clip.id}"></div>
            <div class="arr-clip-resize-handle"></div>
          </div>
        `;
      });
      html += '</div>';
    });

    // Re-insert playhead after lanes
    this._lanesEl.innerHTML = html;
    const ph = document.createElement('div');
    ph.className = 'arr-playhead';
    ph.id = 'arrPlayhead';
    this._lanesEl.appendChild(ph);
    this._playheadEl = ph;

    this._lanesEl.scrollLeft = scrollLeft;
    this._lanesEl.scrollTop = scrollTop;

    // Init WaveSurfers and interaction
    (project.tracks || []).forEach(track => {
      (track.clips || []).forEach(clip => {
        this._initWaveSurfer(track, clip, project);
      });
    });

    this._bindClipInteractions(project);
    this._updatePlayhead(window.transport.currentTime);
  }

  // ── WaveSurfer ────────────────────────────────────────────────────────────

  _initWaveSurfer(track, clip, project) {
    const el = document.getElementById(`wave-${clip.id}`);
    if (!el || typeof WaveSurfer === 'undefined') return;

    const url = window.api.clipAudioUrl(project.id, track.id, clip.id);
    try {
      const ws = WaveSurfer.create({
        container: el,
        waveColor: 'rgba(255,255,255,0.4)',
        progressColor: 'rgba(255,255,255,0.7)',
        height: TRACK_HEIGHT - 22,
        normalize: true,
        interact: false,
        hideScrollbar: true,
        backend: 'WebAudio',
        url,
      });
      this._wavesurfers[clip.id] = ws;
    } catch (e) {
      console.warn('WaveSurfer init failed for clip', clip.id, e);
    }
  }

  // ── Clip interactions ─────────────────────────────────────────────────────

  _bindClipInteractions(project) {
    const lanes = this._lanesEl;

    lanes.querySelectorAll('.arr-clip').forEach(clipEl => {
      const clipId = clipEl.dataset.clipId;
      const trackId = clipEl.dataset.trackId;
      const track = project.tracks.find(t => t.id === trackId);
      if (!track) return;
      const clip = track.clips.find(c => c.id === clipId);
      if (!clip) return;

      // Select on click
      clipEl.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('arr-clip-resize-handle')) return;
        e.stopPropagation();

        document.querySelectorAll('.arr-clip.selected').forEach(el => el.classList.remove('selected'));
        clipEl.classList.add('selected');
        window.appState.selectedClip = clip;
        window.appState.selectedTrack = track;
        window.dispatchEvent(new CustomEvent('arrangement:clipSelected', { detail: { clip, track } }));

        // Cut tool splits the clip
        if (window.appState.activeTool === 'cut') {
          const rect = clipEl.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const splitTime = clip.start + x / this.pxPerSec;
          this._splitClip(project, track, clip, splitTime);
          return;
        }

        // Drag to move
        if (window.appState.activeTool === 'select') {
          this._startDrag(e, clipEl, clip, track, project);
        }
      });

      // Double-click to rename
      clipEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        const name = prompt('Rename clip:', track.name);
        if (name !== null) {
          track.name = name;
          window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
        }
      });

      // Right-click context menu
      clipEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._showContextMenu(e, project, track, clip);
      });

      // Resize handle
      const handle = clipEl.querySelector('.arr-clip-resize-handle');
      if (handle) {
        handle.addEventListener('mousedown', (e) => {
          e.stopPropagation();
          this._startResize(e, clipEl, clip, track, project);
        });
      }
    });

    // Click on empty lane to deselect
    lanes.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.arr-clip')) {
        document.querySelectorAll('.arr-clip.selected').forEach(el => el.classList.remove('selected'));
        window.appState.selectedClip = null;
        window.appState.selectedTrack = null;
      }
    });
  }

  // ── Drag to move ──────────────────────────────────────────────────────────

  _startDrag(e, clipEl, clip, track, project) {
    const startX = e.clientX;
    const origStart = clip.start;

    const onMove = (mv) => {
      const dx = mv.clientX - startX;
      const dt = dx / this.pxPerSec;
      let newStart = Math.max(0, origStart + dt);
      // Snap to grid
      newStart = Math.round(newStart / SNAP_GRID) * SNAP_GRID;
      clip.start = newStart;
      clipEl.style.left = (newStart * this.pxPerSec) + 'px';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  _startResize(e, clipEl, clip, track, project) {
    const startX = e.clientX;
    const origDuration = clip.duration;

    const onMove = (mv) => {
      const dx = mv.clientX - startX;
      const dt = dx / this.pxPerSec;
      clip.duration = Math.max(0.1, origDuration + dt);
      clipEl.style.width = (clip.duration * this.pxPerSec) + 'px';
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Split ─────────────────────────────────────────────────────────────────

  _splitClip(project, track, clip, splitTime) {
    if (splitTime <= clip.start || splitTime >= clip.start + clip.duration) return;

    const leftDuration = splitTime - clip.start;
    const rightDuration = clip.duration - leftDuration;

    clip.duration = leftDuration;

    const newClip = {
      id: crypto.randomUUID(),
      file: clip.file,
      start: splitTime,
      duration: rightDuration,
      offset: (clip.offset || 0) + leftDuration,
      color: clip.color,
    };
    track.clips.push(newClip);
    window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
  }

  // ── Context menu ──────────────────────────────────────────────────────────

  _showContextMenu(e, project, track, clip) {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
      <div class="ctx-item" data-action="split">Split here</div>
      <div class="ctx-item" data-action="duplicate">Duplicate</div>
      <div class="ctx-item" data-action="reverse">Reverse</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" data-action="delete">Delete</div>
    `;
    document.body.appendChild(menu);

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const splitTime = clip.start + x / this.pxPerSec;

    menu.addEventListener('click', (ev) => {
      const action = ev.target.dataset.action;
      menu.remove();
      if (action === 'delete') {
        track.clips = track.clips.filter(c => c.id !== clip.id);
        window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
      } else if (action === 'duplicate') {
        const dup = { ...clip, id: crypto.randomUUID(), start: clip.start + clip.duration };
        track.clips.push(dup);
        window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
      } else if (action === 'split') {
        this._splitClip(project, track, clip, splitTime);
      }
    });

    const dismiss = () => { menu.remove(); document.removeEventListener('click', dismiss); };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }

  // ── Playhead ──────────────────────────────────────────────────────────────

  _bindTransport() {
    window.addEventListener('transport:tick', (e) => this._updatePlayhead(e.detail.time));
    window.addEventListener('transport:seek', (e) => this._updatePlayhead(e.detail.time));
    window.addEventListener('transport:stop', (e) => this._updatePlayhead(e.detail.time));
  }

  _updatePlayhead(t) {
    if (!this._playheadEl) return;
    const x = t * this.pxPerSec;
    this._playheadEl.style.left = x + 'px';

    // Auto-scroll to keep playhead visible
    if (window.transport.playing) {
      const laneRect = this._lanesEl.getBoundingClientRect();
      const phX = x - this._lanesEl.scrollLeft;
      if (phX > laneRect.width * 0.8) {
        this._lanesEl.scrollLeft = x - laneRect.width * 0.3;
      }
    }
  }

  // ── Zoom ──────────────────────────────────────────────────────────────────

  zoomIn() {
    this.pxPerSec = Math.min(400, this.pxPerSec * 1.25);
    if (window.appState) this.render(window.appState.project);
  }

  zoomOut() {
    this.pxPerSec = Math.max(20, this.pxPerSec / 1.25);
    if (window.appState) this.render(window.appState.project);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  _totalDuration(project) {
    let t = 0;
    (project.tracks || []).forEach(track => {
      (track.clips || []).forEach(clip => {
        t = Math.max(t, clip.start + clip.duration);
      });
    });
    return Math.max(t, 60);
  }
}

window.ArrangementView = ArrangementView;
