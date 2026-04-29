/**
 * effects_ui.js — FX chain side panel.
 *
 * Opens as a slide-in panel from the right when the user clicks FX on a track.
 * Reads the track's EffectsChain and renders controls for EQ, Compression,
 * Reverb, and Delay. On Apply, POSTs to /effects/:projectId/:trackId and
 * refreshes the arrangement.
 */

class EffectsUI {
  constructor() {
    this._panel = null;
    this._currentTrack = null;
    this._currentProject = null;
    this._build();

    window.addEventListener('mixer:openFX', (e) => {
      this.open(e.detail.track, e.detail.project);
    });
  }

  _build() {
    this._panel = document.createElement('div');
    this._panel.id = 'fxPanel';
    this._panel.className = 'fx-panel hidden';
    document.body.appendChild(this._panel);
  }

  open(track, project) {
    this._currentTrack = track;
    this._currentProject = project;
    const fx = track.effects || {};

    this._panel.innerHTML = `
      <div class="fx-header">
        <span class="fx-title">FX: ${track.name}</span>
        <button class="fx-close" id="fxClose">✕</button>
      </div>
      <div class="fx-body">

        <div class="fx-section">
          <label class="fx-section-label">
            <input type="checkbox" id="eqEnabled" ${fx.eq_enabled ? 'checked' : ''}> EQ
          </label>
          <div class="fx-controls" id="eqControls">
            ${this._renderEQBands(fx.eq?.bands || [])}
            <button class="fx-add-band" id="addEqBand">+ Band</button>
          </div>
        </div>

        <div class="fx-section">
          <label class="fx-section-label">
            <input type="checkbox" id="compEnabled" ${fx.compression_enabled ? 'checked' : ''}> Compression
          </label>
          <div class="fx-controls">
            ${this._knob('compThreshold', 'Threshold', fx.compression?.threshold ?? -24, -60, 0, 'dB')}
            ${this._knob('compRatio', 'Ratio', fx.compression?.ratio ?? 4, 1, 20, ':1')}
            ${this._knob('compAttack', 'Attack', fx.compression?.attack_ms ?? 10, 0.1, 200, 'ms')}
            ${this._knob('compRelease', 'Release', fx.compression?.release_ms ?? 100, 10, 1000, 'ms')}
            ${this._knob('compMakeup', 'Makeup', fx.compression?.makeup_gain ?? 0, 0, 24, 'dB')}
          </div>
        </div>

        <div class="fx-section">
          <label class="fx-section-label">
            <input type="checkbox" id="reverbEnabled" ${fx.reverb_enabled ? 'checked' : ''}> Reverb
          </label>
          <div class="fx-controls">
            ${this._knob('reverbRoom', 'Room', fx.reverb?.room_size ?? 0.3, 0, 1, '')}
            ${this._knob('reverbWet', 'Wet/Dry', fx.reverb?.wet_dry ?? 0.2, 0, 1, '')}
            ${this._knob('reverbDamp', 'Damping', fx.reverb?.damping ?? 0.5, 0, 1, '')}
          </div>
        </div>

        <div class="fx-section">
          <label class="fx-section-label">
            <input type="checkbox" id="delayEnabled" ${fx.delay_enabled ? 'checked' : ''}> Delay
          </label>
          <div class="fx-controls">
            ${this._knob('delayTime', 'Time', fx.delay?.time_ms ?? 250, 10, 2000, 'ms')}
            ${this._knob('delayFeedback', 'Feedback', fx.delay?.feedback ?? 0.3, 0, 0.95, '')}
            ${this._knob('delayWet', 'Wet/Dry', fx.delay?.wet_dry ?? 0.15, 0, 1, '')}
          </div>
        </div>

        <div class="fx-actions">
          <button class="btn-primary" id="fxApply">Apply</button>
          <button class="btn-secondary" id="fxClose2">Close</button>
        </div>
        <div class="fx-status" id="fxStatus"></div>
      </div>
    `;

    this._panel.classList.remove('hidden');
    this._bindPanelEvents();
  }

  close() {
    this._panel.classList.add('hidden');
  }

  _renderEQBands(bands) {
    if (!bands.length) bands = [{ freq: 1000, gain: 0, q: 1, type: 'peak' }];
    return bands.map((b, i) => `
      <div class="eq-band" data-index="${i}">
        <select class="eq-type" data-field="type">
          ${['peak','highpass','lowpass','lowshelf','highshelf'].map(t =>
            `<option value="${t}" ${b.type === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
        <label>Freq <input type="number" class="eq-freq" data-field="freq" value="${b.freq}" min="20" max="20000"> Hz</label>
        <label>Gain <input type="number" class="eq-gain" data-field="gain" value="${b.gain}" min="-18" max="18" step="0.5"> dB</label>
        <label>Q <input type="number" class="eq-q" data-field="q" value="${b.q}" min="0.1" max="10" step="0.1"></label>
        <button class="eq-remove-band" data-index="${i}">−</button>
      </div>
    `).join('');
  }

  _knob(id, label, value, min, max, unit) {
    const step = (max - min) > 10 ? 1 : 0.01;
    return `
      <label class="fx-knob">
        <span>${label}</span>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
        <span class="fx-knob-val" id="${id}Val">${typeof value === 'number' ? value.toFixed(max <= 1 ? 2 : 0) : value}${unit}</span>
      </label>
    `;
  }

  _bindPanelEvents() {
    // Live knob value display
    this._panel.querySelectorAll('input[type=range]').forEach(inp => {
      const valEl = document.getElementById(inp.id + 'Val');
      inp.addEventListener('input', () => {
        if (valEl) {
          const num = parseFloat(inp.value);
          const max = parseFloat(inp.max);
          valEl.textContent = (max <= 1 ? num.toFixed(2) : num.toFixed(0));
        }
      });
    });

    // Add EQ band
    const addBandBtn = document.getElementById('addEqBand');
    if (addBandBtn) {
      addBandBtn.addEventListener('click', () => {
        const eqControls = document.getElementById('eqControls');
        const bands = this._readEQBands();
        bands.push({ freq: 1000, gain: 0, q: 1, type: 'peak' });
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = this._renderEQBands(bands);
        const newBand = tempDiv.lastElementChild;
        eqControls.insertBefore(newBand, addBandBtn);
      });
    }

    // Remove EQ band
    this._panel.addEventListener('click', (e) => {
      if (e.target.classList.contains('eq-remove-band')) {
        e.target.closest('.eq-band').remove();
      }
    });

    // Close buttons
    ['fxClose', 'fxClose2'].forEach(id => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', () => this.close());
    });

    // Apply
    const applyBtn = document.getElementById('fxApply');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => this._apply());
    }
  }

  async _apply() {
    const status = document.getElementById('fxStatus');
    if (status) { status.textContent = 'Applying effects…'; status.className = 'fx-status'; }

    const chain = this._readChain();
    const track = this._currentTrack;
    const project = this._currentProject;

    // Update the in-memory model immediately
    track.effects = chain;

    if (!track.clips || !track.clips.length) {
      if (status) status.textContent = 'No clips on this track.';
      return;
    }

    const clip = track.clips[0];
    try {
      await window.api.applyEffects(project.id, track.id, clip.id, chain);
      window.transport.invalidateAll(); // force re-fetch of processed audio
      if (status) { status.textContent = 'Effects applied ✓'; status.className = 'fx-status ok'; }
      window.dispatchEvent(new CustomEvent('project:changed', { detail: project }));
    } catch (e) {
      if (status) { status.textContent = 'Error: ' + e.message; status.className = 'fx-status err'; }
    }
  }

  _readChain() {
    return {
      eq: {
        bands: this._readEQBands(),
      },
      compression: {
        threshold: parseFloat(document.getElementById('compThreshold')?.value ?? -24),
        ratio: parseFloat(document.getElementById('compRatio')?.value ?? 4),
        attack_ms: parseFloat(document.getElementById('compAttack')?.value ?? 10),
        release_ms: parseFloat(document.getElementById('compRelease')?.value ?? 100),
        makeup_gain: parseFloat(document.getElementById('compMakeup')?.value ?? 0),
      },
      reverb: {
        room_size: parseFloat(document.getElementById('reverbRoom')?.value ?? 0.3),
        wet_dry: parseFloat(document.getElementById('reverbWet')?.value ?? 0.2),
        damping: parseFloat(document.getElementById('reverbDamp')?.value ?? 0.5),
      },
      delay: {
        time_ms: parseFloat(document.getElementById('delayTime')?.value ?? 250),
        feedback: parseFloat(document.getElementById('delayFeedback')?.value ?? 0.3),
        wet_dry: parseFloat(document.getElementById('delayWet')?.value ?? 0.15),
      },
      eq_enabled: document.getElementById('eqEnabled')?.checked ?? true,
      compression_enabled: document.getElementById('compEnabled')?.checked ?? true,
      reverb_enabled: document.getElementById('reverbEnabled')?.checked ?? false,
      delay_enabled: document.getElementById('delayEnabled')?.checked ?? false,
    };
  }

  _readEQBands() {
    const bands = [];
    this._panel.querySelectorAll('.eq-band').forEach(bandEl => {
      bands.push({
        type: bandEl.querySelector('[data-field=type]')?.value ?? 'peak',
        freq: parseFloat(bandEl.querySelector('[data-field=freq]')?.value ?? 1000),
        gain: parseFloat(bandEl.querySelector('[data-field=gain]')?.value ?? 0),
        q: parseFloat(bandEl.querySelector('[data-field=q]')?.value ?? 1),
      });
    });
    return bands;
  }
}

window.EffectsUI = EffectsUI;
