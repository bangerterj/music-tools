/**
 * recorder.js — Microphone recording via MediaRecorder API
 * Shows live waveform during recording, uploads on stop.
 */

const recorder = (() => {

  let mediaRecorder = null;
  let chunks = [];
  let stream = null;
  let timerInterval = null;
  let startedAt = null;
  let analyser = null;
  let animRaf = null;
  let audioCtxRec = null;

  const MAX_SECONDS = parseInt(window.__STUDIO_MAX_RECORD_SEC__ || '60', 10);

  function toggleRecord() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      stopRecording();
    } else {
      startRecording();
    }
  }

  async function startRecording() {
    if (!app.state.project) {
      app.showError('No project loaded. Create a project first.');
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      app.showError('Microphone access denied. Please allow microphone access and try again.');
      return;
    }

    chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType: getSupportedMimeType() });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = handleRecordingStop;
    mediaRecorder.start(100); // collect in 100ms chunks

    startedAt = Date.now();

    // UI
    document.getElementById('btn-record').classList.add('recording');
    app.openModal('modal-record');
    startTimer();
    startWaveformPreview();

    // Auto-stop at max duration
    setTimeout(() => {
      if (mediaRecorder?.state === 'recording') stopRecording();
    }, MAX_SECONDS * 1000);
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
    mediaRecorder.stop();
    stream?.getTracks().forEach(t => t.stop());
    clearInterval(timerInterval);
    cancelAnimationFrame(animRaf);
    document.getElementById('btn-record').classList.remove('recording');
  }

  async function handleRecordingStop() {
    app.closeModal('modal-record');

    const mimeType = getSupportedMimeType();
    const blob = new Blob(chunks, { type: mimeType });
    chunks = [];

    if (blob.size < 1000) {
      app.showError('Recording too short or empty. Please try again.');
      return;
    }

    app.showProgress('Uploading recording…', 0.1);

    try {
      const result = await API.uploadRecording(app.state.project.id, blob);
      // result: { track, clip }
      app.state.project.tracks.push(result.track);
      app.render();
      app.hideProgress();

      // Offer stem separation
      if (confirm('Recording saved! Separate into stems with Demucs?\n(This takes 30–120 seconds depending on length.)')) {
        await app.separateStems(result.track.id, result.track.clips[0].id);
      }
    } catch (e) {
      app.hideProgress();
      app.showError('Upload failed: ' + e.message);
    }
  }

  // ── Timer display ────────────────────────────────────────

  function startTimer() {
    const el = document.getElementById('record-timer');
    timerInterval = setInterval(() => {
      const elapsed = (Date.now() - startedAt) / 1000;
      const m = Math.floor(elapsed / 60);
      const s = Math.floor(elapsed % 60);
      el.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }, 250);
  }

  // ── Live waveform ────────────────────────────────────────

  function startWaveformPreview() {
    const canvas = document.getElementById('record-canvas');
    if (!canvas) return;

    canvas.width = canvas.offsetWidth || 400;
    canvas.height = canvas.offsetHeight || 56;
    const ctx = canvas.getContext('2d');

    audioCtxRec = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtxRec.createMediaStreamSource(stream);
    analyser = audioCtxRec.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufLen = analyser.frequencyBinCount;
    const dataArr = new Uint8Array(bufLen);

    function draw() {
      animRaf = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArr);

      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#f44336';
      ctx.beginPath();

      const sliceW = canvas.width / bufLen;
      let x = 0;
      for (let i = 0; i < bufLen; i++) {
        const v = dataArr[i] / 128.0;
        const y = (v * canvas.height) / 2;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        x += sliceW;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    }

    draw();
  }

  // ── Stop button in modal ─────────────────────────────────

  document.getElementById('btn-stop-record')?.addEventListener('click', stopRecording);

  // ── MIME type detection ──────────────────────────────────

  function getSupportedMimeType() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || 'audio/webm';
  }

  return { toggleRecord, startRecording, stopRecording };
})();
