/**
 * effects_ui.js — FX chain panel: EQ, compression, reverb, delay
 * Slides in from the right when a track's FX button is clicked.
 */

const fxUI = (() => {

  let currentTrackId = null;

  function open(trackId) {
    const track = app.getTrack(trackId);
    if (!track) return;

    currentTrackId = trackId;
    document.getElementById('fx-track-name').textContent = track.name + ' — FX';
    document.getElementById('fx-panel').classList.add('open');

    renderSections(track);
  }

  function close() {
    document.getElementById('fx-panel').classList.remove('open');
    currentTrackId = null;

    // Remove fx-open class from all FX buttons
    document.querySelectorAll('.mx-btn[data-action="fx"]').forEach(btn => {
      btn.classList.remove('fx-open');
    });
  }

  function renderSections(track) {
    const container = document.getElementById('fx-sections');
    container.innerHTML = '';
    const fx = track.effects || app.defaultEffects();

    container.appendChild(buildEQSection(fx));
    container.appendChild(buildCompressionSection(fx));
    container.appendChild(buildReverbSection(fx));
    container.appendChild(buildDelaySection(fx));
  }

  // ── EQ ───────────────────────────────────────────────────

  function buildEQSection(fx) {
    const sec = buildSection('EQ', fx.eq?.enabled ?? true);

    const bands = fx.eq?.bands || [];
    const defaults = [
      { freq: 80, gain: 0, q: 0.7, type: 'highpass', label: 'Hi-Pass' },
      { freq: 250, gain: 0, q: 1.0, type: 'peak', label: '250 Hz' },
      { freq: 1000, gain: 0, q: 1.0, type: 'peak', label: '1 kHz' },
      { freq: 5000, gain: 0, q: 1.0, type: 'peak', label: '5 kHz' },
      { freq: 12000, gain: 0, q: 0.7, type: 'highshelf', label: 'Air' },
    ];

    // Merge defaults with saved bands
    const merged = defaults.map((def, i) => ({ ...def, ...(bands[i] || {}) }));

    merged.forEach((band, i) => {
      const row = document.createElement('div');
      row.className = 'fx-row';
      row.innerHTML = `
        <span class="fx-row-label">${band.label}</span>
        <input type="range" min="-18" max="18" step="0.5" value="${band.gain.toFixed(1)}"
               data-band="${i}" class="fx-slider eq-band-gain">
        <span class="fx-row-val">${band.gain > 0 ? '+' : ''}${band.gain.toFixed(1)} dB</span>
      `;
      row.querySelector('input').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = (val > 0 ? '+' : '') + val.toFixed(1) + ' dB';
        merged[i].gain = val;
      });
      sec.body.appendChild(row);
    });

    sec.enableToggle.addEventListener('click', () => {
      const on = sec.el.classList.toggle('enabled');
      sec.enableToggle.classList.toggle('on', on);
      if (fx.eq) fx.eq.enabled = on;
    });

    if (fx.eq?.enabled) sec.el.classList.add('enabled');

    sec.el._getData = () => ({ ...fx.eq, bands: merged, enabled: sec.enableToggle.classList.contains('on') });
    return sec.el;
  }

  // ── Compression ──────────────────────────────────────────

  function buildCompressionSection(fx) {
    const c = fx.compression || {};
    const sec = buildSection('Compression', c.enabled ?? true);

    const params = [
      { key: 'threshold', label: 'Threshold', min: -60, max: 0, step: 1, unit: 'dB', val: c.threshold ?? -24 },
      { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.5, unit: ':1', val: c.ratio ?? 4 },
      { key: 'attack_ms', label: 'Attack', min: 1, max: 200, step: 1, unit: 'ms', val: c.attack_ms ?? 10 },
      { key: 'release_ms', label: 'Release', min: 10, max: 1000, step: 10, unit: 'ms', val: c.release_ms ?? 100 },
      { key: 'makeup_gain', label: 'Makeup', min: 0, max: 24, step: 0.5, unit: 'dB', val: c.makeup_gain ?? 0 },
    ];

    const values = {};
    params.forEach(p => {
      values[p.key] = p.val;
      const row = buildSliderRow(p.label, p.min, p.max, p.step, p.val, p.unit, (v) => {
        values[p.key] = v;
      });
      sec.body.appendChild(row);
    });

    sec.enableToggle.addEventListener('click', () => {
      const on = sec.el.classList.toggle('enabled');
      sec.enableToggle.classList.toggle('on', on);
    });
    if (c.enabled ?? true) {
      sec.el.classList.add('enabled');
      sec.enableToggle.classList.add('on');
    }

    sec.el._getData = () => ({ ...values, enabled: sec.enableToggle.classList.contains('on') });
    return sec.el;
  }

  // ── Reverb ───────────────────────────────────────────────

  function buildReverbSection(fx) {
    const r = fx.reverb || {};
    const sec = buildSection('Reverb', r.enabled ?? false);

    const params = [
      { key: 'room_size', label: 'Room Size', min: 0, max: 1, step: 0.01, unit: '', val: r.room_size ?? 0.3 },
      { key: 'wet_dry', label: 'Wet/Dry', min: 0, max: 1, step: 0.01, unit: '', val: r.wet_dry ?? 0.2 },
      { key: 'damping', label: 'Damping', min: 0, max: 1, step: 0.01, unit: '', val: r.damping ?? 0.5 },
    ];

    const values = {};
    params.forEach(p => {
      values[p.key] = p.val;
      const row = buildSliderRow(p.label, p.min, p.max, p.step, p.val, p.unit, (v) => {
        values[p.key] = v;
      });
      sec.body.appendChild(row);
    });

    sec.enableToggle.addEventListener('click', () => {
      const on = sec.el.classList.toggle('enabled');
      sec.enableToggle.classList.toggle('on', on);
    });
    if (r.enabled) {
      sec.el.classList.add('enabled');
      sec.enableToggle.classList.add('on');
    }

    sec.el._getData = () => ({ ...values, enabled: sec.enableToggle.classList.contains('on') });
    return sec.el;
  }

  // ── Delay ────────────────────────────────────────────────

  function buildDelaySection(fx) {
    const d = fx.delay || {};
    const sec = buildSection('Delay', d.enabled ?? false);

    const params = [
      { key: 'time_ms', label: 'Time', min: 10, max: 1000, step: 10, unit: 'ms', val: d.time_ms ?? 250 },
      { key: 'feedback', label: 'Feedback', min: 0, max: 0.95, step: 0.01, unit: '', val: d.feedback ?? 0.3 },
      { key: 'wet_dry', label: 'Wet/Dry', min: 0, max: 1, step: 0.01, unit: '', val: d.wet_dry ?? 0.15 },
    ];

    const values = {};
    params.forEach(p => {
      values[p.key] = p.val;
      const row = buildSliderRow(p.label, p.min, p.max, p.step, p.val, p.unit, (v) => {
        values[p.key] = v;
      });
      sec.body.appendChild(row);
    });

    sec.enableToggle.addEventListener('click', () => {
      const on = sec.el.classList.toggle('enabled');
      sec.enableToggle.classList.toggle('on', on);
    });
    if (d.enabled) {
      sec.el.classList.add('enabled');
      sec.enableToggle.classList.add('on');
    }

    sec.el._getData = () => ({ ...values, enabled: sec.enableToggle.classList.contains('on') });
    return sec.el;
  }

  // ── Apply ────────────────────────────────────────────────

  document.getElementById('fx-apply-btn')?.addEventListener('click', async () => {
    if (!currentTrackId) return;
    const track = app.getTrack(currentTrackId);
    if (!track) return;

    // Collect data from each section
    const sections = document.querySelectorAll('.fx-section');
    const effectsData = {};
    sections.forEach(sec => {
      if (typeof sec._getData === 'function') {
        const sectionTitle = sec.querySelector('.fx-section-title')?.textContent?.toLowerCase();
        if (sectionTitle) effectsData[sectionTitle] = sec._getData();
      }
    });

    track.effects = {
      eq: effectsData['eq'] || track.effects?.eq,
      compression: effectsData['compression'] || track.effects?.compression,
      reverb: effectsData['reverb'] || track.effects?.reverb,
      delay: effectsData['delay'] || track.effects?.delay,
    };

    app.showProgress('Applying effects…', 0);
    try {
      await API.applyEffects(app.state.project.id, currentTrackId, track.effects);
      transport.clearBufferCache();
      app.hideProgress();
    } catch (e) {
      app.hideProgress();
      app.showError('Effects apply failed: ' + e.message);
    }

    app.saveProject();
  });

  // ── Helpers ──────────────────────────────────────────────

  function buildSection(title, enabled) {
    const el = document.createElement('div');
    el.className = 'fx-section' + (enabled ? ' expanded' : '');

    const toggle = document.createElement('div');
    toggle.className = 'fx-enabled-toggle' + (enabled ? ' on' : '');

    const header = document.createElement('div');
    header.className = 'fx-section-header';
    header.innerHTML = `<span class="fx-section-title">${title}</span>`;
    header.prepend(toggle);

    // Click title area to expand/collapse
    header.querySelector('.fx-section-title').addEventListener('click', () => {
      el.classList.toggle('expanded');
    });

    const body = document.createElement('div');
    body.className = 'fx-section-body';

    el.appendChild(header);
    el.appendChild(body);

    return { el, body, enableToggle: toggle };
  }

  function buildSliderRow(label, min, max, step, value, unit, onChange) {
    const row = document.createElement('div');
    row.className = 'fx-row';

    const fmt = (v) => {
      if (unit === 'dB') return (v > 0 ? '+' : '') + parseFloat(v).toFixed(1) + ' dB';
      if (unit === 'ms') return Math.round(v) + ' ms';
      if (unit === ':1') return parseFloat(v).toFixed(1) + ':1';
      return parseFloat(v).toFixed(2);
    };

    row.innerHTML = `
      <span class="fx-row-label">${label}</span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" class="fx-slider">
      <span class="fx-row-val">${fmt(value)}</span>
    `;

    row.querySelector('input').addEventListener('input', (e) => {
      const v = parseFloat(e.target.value);
      row.querySelector('.fx-row-val').textContent = fmt(v);
      onChange(v);
    });

    return row;
  }

  return { open, close };
})();
