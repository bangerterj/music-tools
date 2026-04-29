/**
 * mixer.js — Mixer panel: faders, pan knobs, mute/solo/fx per track.
 *
 * Renders into #mixerStrip elements. Reads/writes window.appState.project.
 */

class Mixer {
  constructor(containerEl) {
    this.container = containerEl;
  }

  render(project) {
    if (!project) return;
    const tracks = project.tracks || [];

    let html = '';
    tracks.forEach((track, idx) => {
      html += `
        <div class="mix-strip" data-track-id="${track.id}">
          <div class="mix-color-bar" style="background:${track.color}"></div>
          <div class="mix-name" title="${track.name}">${track.name}</div>
          <div class="mix-buttons">
            <button class="mix-btn ${track.muted ? 'active danger' : ''}" data-action="mute" title="Mute">M</button>
            <button class="mix-btn ${track.solo ? 'active accent' : ''}" data-action="solo" title="Solo">S</button>
            <button class="mix-btn" data-action="fx" title="Effects">FX</button>
          </div>
          <div class="mix-pan-wrap">
            <label class="mix-label">PAN</label>
            <input type="range" class="mix-pan" min="-100" max="100" value="${Math.round(track.pan * 100)}"
                   data-track-id="${track.id}" title="Pan: ${Math.round(track.pan * 100)}">
            <span class="mix-pan-val">${track.pan === 0 ? 'C' : (track.pan > 0 ? 'R' + Math.round(track.pan * 100) : 'L' + Math.round(-track.pan * 100))}</span>
          </div>
          <div class="mix-fader-wrap">
            <input type="range" class="mix-fader" min="0" max="100" value="${Math.round(track.volume * 100)}"
                   data-track-id="${track.id}" orient="vertical" title="Volume">
            <span class="mix-fader-val">${Math.round(track.volume * 100)}</span>
          </div>
        </div>
      `;
    });

    // Master channel
    html += `
      <div class="mix-strip master">
        <div class="mix-color-bar" style="background:#4CAF50"></div>
        <div class="mix-name">MASTER</div>
        <div class="mix-buttons">
          <button class="mix-btn" id="masterExportBtn" title="Export">EXP</button>
        </div>
        <div class="mix-fader-wrap">
          <input type="range" class="mix-fader" id="masterFader" min="0" max="100" value="100" orient="vertical">
          <span class="mix-fader-val" id="masterFaderVal">100</span>
        </div>
      </div>
    `;

    this.container.innerHTML = html;
    this._bindEvents(project);
  }

  _bindEvents(project) {
    // Faders
    this.container.querySelectorAll('.mix-fader').forEach(input => {
      const trackId = input.dataset.trackId;
      if (!trackId) return; // master
      input.addEventListener('input', () => {
        const track = project.tracks.find(t => t.id === trackId);
        if (!track) return;
        track.volume = input.value / 100;
        const valEl = input.nextElementSibling;
        if (valEl) valEl.textContent = input.value;
        window.dispatchEvent(new CustomEvent('mixer:volumeChanged', { detail: { track } }));
      });
    });

    // Pan
    this.container.querySelectorAll('.mix-pan').forEach(input => {
      const trackId = input.dataset.trackId;
      input.addEventListener('input', () => {
        const track = project.tracks.find(t => t.id === trackId);
        if (!track) return;
        track.pan = input.value / 100;
        const valEl = input.nextElementSibling;
        if (valEl) {
          valEl.textContent = track.pan === 0 ? 'C' :
            (track.pan > 0 ? 'R' + Math.round(track.pan * 100) : 'L' + Math.round(-track.pan * 100));
        }
        window.dispatchEvent(new CustomEvent('mixer:panChanged', { detail: { track } }));
      });
    });

    // Mute / Solo / FX buttons
    this.container.querySelectorAll('.mix-btn').forEach(btn => {
      const strip = btn.closest('.mix-strip');
      const trackId = strip?.dataset.trackId;
      const action = btn.dataset.action;
      if (!trackId || !action) return;

      btn.addEventListener('click', () => {
        const track = project.tracks.find(t => t.id === trackId);
        if (!track) return;

        if (action === 'mute') {
          track.muted = !track.muted;
          btn.classList.toggle('active', track.muted);
          btn.classList.toggle('danger', track.muted);
          window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
        } else if (action === 'solo') {
          track.solo = !track.solo;
          btn.classList.toggle('active', track.solo);
          btn.classList.toggle('accent', track.solo);
          window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
        } else if (action === 'fx') {
          window.dispatchEvent(new CustomEvent('mixer:openFX', { detail: { track, project } }));
        }
      });
    });

    // Master export
    const expBtn = this.container.querySelector('#masterExportBtn');
    if (expBtn) {
      expBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('app:exportRequest', { detail: { project } }));
      });
    }

    // Master fader (just scales gain in transport — future enhancement)
    const masterFader = this.container.querySelector('#masterFader');
    if (masterFader) {
      masterFader.addEventListener('input', () => {
        const val = document.getElementById('masterFaderVal');
        if (val) val.textContent = masterFader.value;
      });
    }
  }
}

window.Mixer = Mixer;
