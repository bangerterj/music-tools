/**
 * shortcuts.js — Keyboard shortcuts
 * Ableton-inspired keybindings wired to app/transport actions.
 */

const shortcuts = (() => {

  function init() {
    document.addEventListener('keydown', handleKey);
  }

  function handleKey(e) {
    // Don't fire shortcuts when typing in an input/textarea
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (document.activeElement?.isContentEditable) return;

    const ctrl = e.ctrlKey || e.metaKey;

    switch (e.code) {

      // Transport
      case 'Space':
        e.preventDefault();
        transport.playPause();
        break;

      case 'KeyR':
        if (!ctrl) { e.preventDefault(); recorder.toggleRecord(); }
        break;

      case 'Enter':
      case 'NumpadEnter':
        e.preventDefault();
        transport.returnToStart();
        break;

      case 'KeyL':
        if (!ctrl) { e.preventDefault(); app.state.loopEnabled = !app.state.loopEnabled;
          document.getElementById('btn-loop').click(); }
        break;

      // Tools
      case 'KeyV':
        if (!ctrl) { e.preventDefault(); document.getElementById('tool-select').click(); }
        break;

      case 'KeyC':
        if (!ctrl) { e.preventDefault(); document.getElementById('tool-cut').click(); }
        break;

      case 'KeyB':
        if (!ctrl) { e.preventDefault(); document.getElementById('tool-draw').click(); }
        break;

      // Track controls
      case 'KeyM':
        if (!ctrl) {
          e.preventDefault();
          const tid = app.state.selectedTrackId;
          if (tid) {
            const t = app.getTrack(tid);
            if (t) app.setTrackMute(tid, !t.muted);
          }
        }
        break;

      case 'KeyS':
        if (!ctrl) {
          e.preventDefault();
          const tid = app.state.selectedTrackId;
          if (tid) {
            const t = app.getTrack(tid);
            if (t) app.setTrackSolo(tid, !t.solo);
          }
        }
        break;

      // Edit
      case 'KeyZ':
        if (ctrl) { e.preventDefault(); e.shiftKey ? app.redo() : app.undo(); }
        break;

      case 'KeyY':
        if (ctrl) { e.preventDefault(); app.redo(); }
        break;

      case 'KeyD':
        if (ctrl) {
          e.preventDefault();
          const { selectedTrackId, selectedClipId } = app.state;
          if (selectedTrackId && selectedClipId) {
            app.duplicateClip(selectedTrackId, selectedClipId);
          }
        }
        break;

      case 'KeyS':
        if (ctrl) { e.preventDefault(); app.saveProject(); }
        break;

      case 'KeyA':
        if (ctrl) {
          e.preventDefault();
          // Select all clips on selected track (just highlights them visually for now)
          document.querySelectorAll('.clip').forEach(el => el.classList.add('selected'));
        }
        break;

      case 'Delete':
      case 'Backspace':
        if (!ctrl) {
          e.preventDefault();
          const { selectedTrackId, selectedClipId } = app.state;
          if (selectedTrackId && selectedClipId) {
            app.deleteClip(selectedTrackId, selectedClipId);
          }
        }
        break;

      case 'Escape':
        e.preventDefault();
        // Deselect
        app.state.selectedClipId = null;
        document.querySelectorAll('.clip.selected').forEach(el => el.classList.remove('selected'));
        document.getElementById('context-menu').classList.remove('open');
        // Close any open modal
        document.querySelectorAll('.modal-overlay.open').forEach(el => el.classList.remove('open'));
        break;

      // Zoom
      case 'Equal':
      case 'NumpadAdd':
        e.preventDefault();
        document.getElementById('btn-zoom-in').click();
        break;

      case 'Minus':
      case 'NumpadSubtract':
        e.preventDefault();
        document.getElementById('btn-zoom-out').click();
        break;
    }
  }

  // Init on DOM ready
  window.addEventListener('DOMContentLoaded', init);

  return { init };
})();
