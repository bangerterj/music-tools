/**
 * shortcuts.js — Global keyboard shortcuts.
 *
 * Space       → Play / Stop toggle
 * R           → Record toggle
 * Enter       → Return to start
 * L           → Toggle loop
 * V           → Select tool
 * C           → Cut tool
 * B           → Draw tool
 * M           → Mute selected track
 * S           → Solo selected track
 * Cmd+Z       → Undo
 * Cmd+Y       → Redo
 * Cmd+D       → Duplicate selected clip
 * Cmd+S       → Save project
 * Delete      → Delete selected clip
 * +           → Zoom in
 * -           → Zoom out
 * Cmd+A       → Select all clips on selected track
 * Escape      → Deselect all
 */

function initShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ignore shortcuts when typing in inputs/textareas
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const ctrl = e.ctrlKey || e.metaKey;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('shortcut:playStop'));
        break;

      case 'r':
      case 'R':
        if (!ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:record'));
        }
        break;

      case 'Enter':
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('shortcut:returnToStart'));
        break;

      case 'l':
      case 'L':
        if (!ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:toggleLoop'));
        }
        break;

      case 'v':
      case 'V':
        if (!ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:tool', { detail: 'select' }));
        }
        break;

      case 'c':
      case 'C':
        if (!ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:tool', { detail: 'cut' }));
        }
        break;

      case 'b':
      case 'B':
        if (!ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:tool', { detail: 'draw' }));
        }
        break;

      case 'm':
      case 'M':
        if (!ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:mute'));
        }
        break;

      case 's':
      case 'S':
        if (ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:save'));
        } else {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:solo'));
        }
        break;

      case 'z':
      case 'Z':
        if (ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:undo'));
        }
        break;

      case 'y':
      case 'Y':
        if (ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:redo'));
        }
        break;

      case 'd':
      case 'D':
        if (ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:duplicate'));
        }
        break;

      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('shortcut:delete'));
        break;

      case '+':
      case '=':
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('shortcut:zoomIn'));
        break;

      case '-':
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('shortcut:zoomOut'));
        break;

      case 'a':
      case 'A':
        if (ctrl) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('shortcut:selectAll'));
        }
        break;

      case 'Escape':
        window.dispatchEvent(new CustomEvent('shortcut:escape'));
        break;
    }
  });
}

window.initShortcuts = initShortcuts;
