/**
 * mixer.js — Mixer panel: per-track faders, pan, mute/solo/fx buttons
 */

const mixer = (() => {

  function render(project) {
    const list = document.getElementById('mixer-tracks-list');
    list.innerHTML = '';
    project.tracks.forEach(track => {
      list.appendChild(buildMixerTrack(track));
    });
  }

  function buildMixerTrack(track) {
    const col = document.createElement('div');
    col.className = 'mixer-track';
    col.dataset.trackId = track.id;
    if (app.state.selectedTrackId === track.id) col.classList.add('selected');

    const vol = Math.round(track.volume * 100);
    const pan = track.pan || 0;

    col.innerHTML = `
      <div class="mixer-color-dot" style="background:${track.color}"></div>
      <div class="mixer-track-label" title="${track.name}">${track.name}</div>
      <div class="fader-wrap">
        <input type="range" class="fader" min="0" max="100" value="${vol}" title="Volume: ${vol}%">
      </div>
      <div class="pan-wrap">
        <span class="pan-label">L</span>
        <input type="range" class="pan" min="-100" max="100" value="${Math.round(pan * 100)}" title="Pan">
        <span class="pan-label">R</span>
      </div>
      <div class="mixer-btns">
        <button class="mx-btn ${track.muted ? 'mute-on' : ''}" data-action="mute" title="Mute">M</button>
        <button class="mx-btn ${track.solo ? 'solo-on' : ''}" data-action="solo" title="Solo">S</button>
        <button class="mx-btn" data-action="fx" title="Effects chain">FX</button>
      </div>
    `;

    // Fader
    const fader = col.querySelector('.fader');
    fader.addEventListener('input', (e) => {
      app.setTrackVolume(track.id, e.target.value / 100);
    });

    // Pan
    const panSlider = col.querySelector('.pan');
    panSlider.addEventListener('input', (e) => {
      app.setTrackPan(track.id, e.target.value / 100);
    });

    // Double-click fader to reset
    fader.addEventListener('dblclick', () => {
      fader.value = 80;
      app.setTrackVolume(track.id, 0.8);
    });

    // Double-click pan to center
    panSlider.addEventListener('dblclick', () => {
      panSlider.value = 0;
      app.setTrackPan(track.id, 0);
    });

    // Mute / Solo / FX buttons
    col.querySelectorAll('.mx-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const t = app.getTrack(track.id);
        if (!t) return;
        switch (btn.dataset.action) {
          case 'mute':
            app.setTrackMute(track.id, !t.muted);
            btn.classList.toggle('mute-on', t.muted);
            break;
          case 'solo':
            app.setTrackSolo(track.id, !t.solo);
            btn.classList.toggle('solo-on', t.solo);
            break;
          case 'fx':
            fxUI.open(track.id);
            btn.classList.add('fx-open');
            break;
        }
      });
    });

    // Select track on click
    col.addEventListener('click', () => app.selectTrack(track.id));

    return col;
  }

  function renderTrack(trackId, track) {
    const existing = document.querySelector(`.mixer-track[data-track-id="${trackId}"]`);
    if (existing && track) {
      existing.replaceWith(buildMixerTrack(track));
    }
  }

  return { render, renderTrack };
})();
