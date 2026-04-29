/**
 * arrangement.js — Arrangement view: timeline, track lanes, clips
 * Handles rendering, clip drag/resize/cut, playhead, loop region, grid.
 */

const arrangement = (() => {

  let zoom = 100;         // pixels per second
  let currentTool = 'select';
  let dragState = null;   // active drag operation
  let contextTarget = null;

  const TRACK_HEIGHT = 80;
  const MIN_DURATION_PX = 16;

  // ── Public: render full arrangement ──────────────────────

  function render(project, zoomPx) {
    if (zoomPx !== undefined) zoom = zoomPx;

    renderHeaders(project.tracks);
    renderLanes(project.tracks);
    renderGrid(project);
    updateArrangementWidth(project);
  }

  function setZoom(z) {
    zoom = z;
    if (app.state.project) render(app.state.project, z);
  }

  function setTool(tool) {
    currentTool = tool;
  }

  // ── Headers ──────────────────────────────────────────────

  function renderHeaders(tracks) {
    const list = document.getElementById('track-header-list');
    list.innerHTML = '';
    tracks.forEach(track => {
      list.appendChild(buildHeader(track));
    });
  }

  function buildHeader(track) {
    const el = document.createElement('div');
    el.className = 'track-header';
    el.dataset.trackId = track.id;
    if (app.state.selectedTrackId === track.id) el.classList.add('selected');

    el.innerHTML = `
      <div class="track-color-bar" style="background:${track.color}"></div>
      <div class="track-info">
        <div class="track-name" title="${track.name}">${track.name}</div>
        <div class="track-type-tag">${track.type}</div>
      </div>
      <div class="track-header-btns">
        <button class="th-btn ${track.muted ? 'mute-active' : ''}" data-action="mute" title="Mute (M)">M</button>
        <button class="th-btn ${track.solo ? 'solo-active' : ''}" data-action="solo" title="Solo (S)">S</button>
      </div>
    `;

    el.addEventListener('click', (e) => {
      if (e.target.dataset.action === 'mute') {
        app.setTrackMute(track.id, !track.muted);
        return;
      }
      if (e.target.dataset.action === 'solo') {
        app.setTrackSolo(track.id, !track.solo);
        return;
      }
      app.selectTrack(track.id);
    });

    // Double-click to rename
    el.querySelector('.track-name').addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const name = prompt('Track name:', track.name);
      if (name) {
        track.name = name;
        el.querySelector('.track-name').textContent = name;
      }
    });

    // Right-click header
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showTrackContextMenu(e, track.id);
    });

    return el;
  }

  function renderTrackHeader(trackId, track) {
    const existing = document.querySelector(`.track-header[data-track-id="${trackId}"]`);
    if (existing && track) {
      const fresh = buildHeader(track);
      existing.replaceWith(fresh);
    }
  }

  // ── Lanes ────────────────────────────────────────────────

  function renderLanes(tracks) {
    const container = document.getElementById('track-lanes-container');
    container.innerHTML = '';
    container.style.position = 'relative';

    tracks.forEach((track, i) => {
      const lane = document.createElement('div');
      lane.className = 'track-lane';
      lane.dataset.trackId = track.id;
      lane.style.top = (i * TRACK_HEIGHT) + 'px';
      lane.style.position = 'absolute';
      lane.style.left = '0';
      lane.style.right = '0';
      lane.style.height = TRACK_HEIGHT + 'px';

      // Click on empty lane area
      lane.addEventListener('click', (e) => {
        if (e.target === lane) {
          app.selectTrack(track.id);
          app.selectClip(null, null);
        }
      });

      // Right-click lane
      lane.addEventListener('contextmenu', (e) => {
        if (e.target === lane) e.preventDefault();
      });

      track.clips.forEach(clip => {
        lane.appendChild(buildClip(track, clip));
      });

      container.appendChild(lane);
    });

    container.style.height = (tracks.length * TRACK_HEIGHT) + 'px';
  }

  function updateArrangementWidth(project) {
    const inner = document.getElementById('arrangement-inner');
    // Find the furthest clip end
    let maxEnd = 30; // minimum 30 seconds
    project.tracks.forEach(t => t.clips.forEach(c => {
      maxEnd = Math.max(maxEnd, c.start + c.duration + 10);
    }));
    inner.style.width = Math.ceil(maxEnd * zoom) + 'px';
    inner.style.height = (project.tracks.length * TRACK_HEIGHT) + 'px';

    drawTimeline(maxEnd);
  }

  // ── Clips ────────────────────────────────────────────────

  function buildClip(track, clip) {
    const el = document.createElement('div');
    el.className = 'clip';
    el.dataset.clipId = clip.id;
    el.dataset.trackId = track.id;
    if (app.state.selectedClipId === clip.id) el.classList.add('selected');

    positionClip(el, clip);
    el.style.background = hexToRgba(track.color, 0.18);
    el.style.border = `1px solid ${hexToRgba(track.color, 0.5)}`;

    el.innerHTML = `
      <div class="clip-top-bar" style="background:${track.color}"></div>
      <div class="clip-body">
        <div class="clip-label">${clip.name || track.name}</div>
        <div class="clip-waveform-container" id="wf-${clip.id}"></div>
      </div>
      <div class="clip-resize-handle"></div>
    `;

    // Load waveform async
    const audioUrl = API.clipAudioUrl(app.state.project?.id, track.id, clip.id);
    requestAnimationFrame(() => loadWaveform(clip.id, audioUrl, track.color));

    // Click to select
    el.addEventListener('mousedown', (e) => {
      e.stopPropagation();

      if (currentTool === 'cut') {
        const rect = el.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const atTime = clip.start + localX / zoom;
        app.splitClip(track.id, clip.id, atTime);
        return;
      }

      if (currentTool === 'select') {
        const isResize = e.target.classList.contains('clip-resize-handle');
        app.selectClip(track.id, clip.id);

        if (isResize) {
          startResizeDrag(e, track.id, clip.id, el);
        } else {
          startMoveDrag(e, track.id, clip.id, el);
        }
      }
    });

    // Right-click context menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      contextTarget = { trackId: track.id, clipId: clip.id };
      showClipContextMenu(e);
    });

    return el;
  }

  function positionClip(el, clip) {
    el.style.left = Math.round(clip.start * zoom) + 'px';
    el.style.width = Math.max(MIN_DURATION_PX, Math.round(clip.duration * zoom)) + 'px';
  }

  function addClipElement(trackId, clip) {
    const lane = document.querySelector(`.track-lane[data-track-id="${trackId}"]`);
    if (!lane) return;
    const track = app.getTrack(trackId);
    if (!track) return;
    lane.appendChild(buildClip(track, clip));
  }

  function removeClipElement(clipId) {
    document.querySelector(`.clip[data-clip-id="${clipId}"]`)?.remove();
  }

  // ── Waveforms ────────────────────────────────────────────

  const waveformCache = {};

  function loadWaveform(clipId, url, color) {
    const container = document.getElementById(`wf-${clipId}`);
    if (!container || waveformCache[clipId]) return;

    try {
      const ws = WaveSurfer.create({
        container,
        waveColor: hexToRgba(color, 0.7),
        progressColor: hexToRgba(color, 0.9),
        height: container.offsetHeight || 44,
        barWidth: 1,
        barGap: 1,
        interact: false,
        hideScrollbar: true,
        normalize: true,
        backend: 'WebAudio',
      });
      ws.load(url);
      waveformCache[clipId] = ws;
    } catch (e) {
      // WaveSurfer not loaded yet or URL not available — fail silently
    }
  }

  // ── Drag: Move ───────────────────────────────────────────

  function startMoveDrag(e, trackId, clipId, el) {
    const clip = app.getClip(trackId, clipId);
    if (!clip) return;

    const startX = e.clientX;
    const origStart = clip.start;
    const origEl = el;

    dragState = { type: 'move', trackId, clipId, startX, origStart };

    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      let newStart = origStart + dx / zoom;
      if (app.state.snapEnabled) newStart = snapToGrid(newStart);
      newStart = Math.max(0, newStart);
      origEl.style.left = Math.round(newStart * zoom) + 'px';
      clip.start = newStart; // live update
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      app.moveClip(trackId, clipId, clip.start);
      dragState = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Drag: Resize ─────────────────────────────────────────

  function startResizeDrag(e, trackId, clipId, el) {
    const clip = app.getClip(trackId, clipId);
    if (!clip) return;

    const startX = e.clientX;
    const origDuration = clip.duration;

    dragState = { type: 'resize', trackId, clipId, startX, origDuration };

    const onMove = (e2) => {
      const dx = e2.clientX - startX;
      let newDuration = origDuration + dx / zoom;
      if (app.state.snapEnabled) newDuration = snapToGrid(clip.start + newDuration) - clip.start;
      newDuration = Math.max(0.1, newDuration);
      el.style.width = Math.max(MIN_DURATION_PX, Math.round(newDuration * zoom)) + 'px';
      clip.duration = newDuration;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      app.resizeClip(trackId, clipId, clip.duration);
      dragState = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  // ── Snap ─────────────────────────────────────────────────

  function snapToGrid(timeSec) {
    const bpm = app.state.project?.bpm || 120;
    const beatSec = 60 / bpm;
    return Math.round(timeSec / beatSec) * beatSec;
  }

  // ── Grid ─────────────────────────────────────────────────

  function renderGrid(project) {
    const layer = document.getElementById('grid-layer');
    layer.innerHTML = '';
    const bpm = project.bpm || 120;
    const beatSec = 60 / bpm;
    const barSec = beatSec * 4;
    const inner = document.getElementById('arrangement-inner');
    const totalSec = parseInt(inner.style.width || '0') / zoom || 60;

    for (let t = 0; t <= totalSec; t += beatSec) {
      const x = Math.round(t * zoom);
      const line = document.createElement('div');
      line.className = 'grid-line ' + (t % barSec < 0.001 ? 'bar' : 'beat');
      line.style.cssText = `position:absolute;top:0;bottom:0;left:${x}px;width:1px;pointer-events:none;z-index:1;`;
      line.style.background = t % barSec < 0.001
        ? 'var(--grid-line-bar)'
        : 'var(--grid-line)';
      layer.appendChild(line);
    }
  }

  function redrawGrid() {
    if (app.state.project) renderGrid(app.state.project);
  }

  // ── Timeline ruler ───────────────────────────────────────

  function drawTimeline(totalSec) {
    const ruler = document.getElementById('timeline-ruler');
    const canvas = document.getElementById('timeline-canvas');
    const w = Math.ceil(totalSec * zoom);
    const h = ruler.offsetHeight || 32;

    canvas.width = w;
    canvas.height = h;
    canvas.style.width = w + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const bpm = app.state.project?.bpm || 120;
    const beatSec = 60 / bpm;
    const barSec = beatSec * 4;

    ctx.fillStyle = '#555';
    ctx.font = '10px -apple-system, sans-serif';
    ctx.textAlign = 'left';

    for (let t = 0; t < totalSec; t += beatSec) {
      const x = Math.round(t * zoom);
      const isBar = t % barSec < 0.001;

      ctx.fillStyle = isBar ? '#666' : '#444';
      ctx.fillRect(x, isBar ? 0 : h - 8, 1, isBar ? h : 8);

      if (isBar) {
        const bar = Math.round(t / barSec) + 1;
        ctx.fillStyle = '#aaa';
        ctx.fillText(bar.toString(), x + 3, 14);
      }
    }

    // Sync scroll with arrangement
    const scroll = document.getElementById('arrangement-scroll');
    ruler.style.overflow = 'hidden';
    scroll.addEventListener('scroll', () => {
      ruler.scrollLeft = scroll.scrollLeft;
    }, { passive: true });
  }

  // ── Playhead ─────────────────────────────────────────────

  function setPlayheadPosition(timeSec) {
    const ph = document.getElementById('playhead');
    ph.style.left = Math.round(timeSec * zoom) + 'px';

    // Auto-scroll to keep playhead in view
    const scroll = document.getElementById('arrangement-scroll');
    const phX = timeSec * zoom;
    const viewLeft = scroll.scrollLeft;
    const viewRight = viewLeft + scroll.offsetWidth;
    if (phX > viewRight - 60) {
      scroll.scrollLeft = phX - 60;
    }
  }

  // ── Loop region ──────────────────────────────────────────

  function showLoopRegion(enabled) {
    const lr = document.getElementById('loop-region');
    lr.style.display = enabled ? 'block' : 'none';
    if (enabled) updateLoopRegion(app.state.loopStart, app.state.loopEnd);
  }

  function updateLoopRegion(start, end) {
    const lr = document.getElementById('loop-region');
    lr.style.left = Math.round(start * zoom) + 'px';
    lr.style.width = Math.round((end - start) * zoom) + 'px';
  }

  // Drag on ruler to set loop region
  document.getElementById('timeline-ruler')?.addEventListener('mousedown', (e) => {
    if (!app.state.loopEnabled) return;
    const ruler = document.getElementById('timeline-ruler');
    const rect = ruler.getBoundingClientRect();
    const scroll = document.getElementById('arrangement-scroll').scrollLeft;
    const startX = (e.clientX - rect.left + scroll);
    let loopStart = startX / zoom;

    const onMove = (e2) => {
      const x = (e2.clientX - rect.left + scroll);
      const loopEnd = Math.max(loopStart + 0.1, x / zoom);
      app.state.loopStart = loopStart;
      app.state.loopEnd = loopEnd;
      updateLoopRegion(loopStart, loopEnd);
      transport.setLoop(true, loopStart, loopEnd);
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  // Click ruler to set playhead
  document.getElementById('timeline-ruler')?.addEventListener('click', (e) => {
    if (app.state.loopEnabled) return;
    const ruler = document.getElementById('timeline-ruler');
    const rect = ruler.getBoundingClientRect();
    const scroll = document.getElementById('arrangement-scroll').scrollLeft;
    const x = e.clientX - rect.left + scroll;
    const time = Math.max(0, x / zoom);
    transport.seekTo(time);
  });

  // ── Context menus ────────────────────────────────────────

  function showClipContextMenu(e) {
    const menu = document.getElementById('context-menu');
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('open');

    // Wire actions (replace each time)
    menu.querySelectorAll('.ctx-item').forEach(item => {
      item.onclick = (ev) => {
        ev.stopPropagation();
        menu.classList.remove('open');
        const { trackId, clipId } = contextTarget || {};
        if (!trackId || !clipId) return;
        switch (item.dataset.action) {
          case 'split': {
            const clip = app.getClip(trackId, clipId);
            if (clip) app.splitClip(trackId, clipId, clip.start + clip.duration / 2);
            break;
          }
          case 'duplicate': app.duplicateClip(trackId, clipId); break;
          case 'rename': {
            const clip = app.getClip(trackId, clipId);
            if (clip) {
              const name = prompt('Clip name:', clip.name || '');
              if (name !== null) {
                clip.name = name;
                const el = document.querySelector(`.clip[data-clip-id="${clipId}"] .clip-label`);
                if (el) el.textContent = name;
              }
            }
            break;
          }
          case 'reverse':
            // TODO: reverse clip audio via backend
            alert('Reverse: coming soon');
            break;
          case 'delete': app.deleteClip(trackId, clipId); break;
        }
      };
    });
  }

  function showTrackContextMenu(e, trackId) {
    // Reuse context menu with track-specific options
    const menu = document.getElementById('context-menu');
    menu.innerHTML = `
      <div class="ctx-item" data-action="separate">⚡ Separate stems</div>
      <div class="ctx-item" data-action="rename">✎ Rename track</div>
      <div class="ctx-item divider danger" data-action="delete-track">✕ Delete track</div>
    `;
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.classList.add('open');

    menu.querySelectorAll('.ctx-item').forEach(item => {
      item.onclick = (ev) => {
        ev.stopPropagation();
        menu.classList.remove('open');
        const track = app.getTrack(trackId);
        switch (item.dataset.action) {
          case 'separate':
            if (track?.clips?.[0]) app.separateStems(trackId, track.clips[0].id);
            break;
          case 'rename': {
            const name = prompt('Track name:', track?.name || '');
            if (name && track) {
              track.name = name;
              app.render();
            }
            break;
          }
          case 'delete-track':
            if (confirm('Delete this track?')) app.removeTrack(trackId);
            break;
        }
      };
    });
  }

  // ── Utilities ────────────────────────────────────────────

  function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  return {
    render, setZoom, setTool, redrawGrid,
    renderTrackHeader, addClipElement, removeClipElement,
    setPlayheadPosition, showLoopRegion, updateLoopRegion,
  };
})();
