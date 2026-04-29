# Studio DAW — Resume Prompt (paste into Claude Code)

---

We're resuming the Studio DAW build. Backend (Phases 1–5) is fully complete and committed to branch `claude/build-studio-daw-hITuO`. The frontend JS files were partially written before a stream timeout cut off the build mid-way through `index.html`.

## Step 1 — Audit what exists

Check `studio/frontend/js/` and list every file. For each one, check if it's complete (has proper exports, no truncated lines, no TODO stubs that should be filled). Fix any incomplete files before continuing.

## Step 2 — Write index.html

Write `studio/frontend/index.html`. This is the full DAW shell. Keep the HTML structure lean and load the JS modules as script tags at the bottom. All CSS goes in a `<style>` block in the head. Do not try to write it all in one go — write it in this order: (1) head + CSS variables + reset, (2) layout structure HTML, (3) toolbar HTML, (4) track headers + arrangement area HTML, (5) mixer HTML, (6) effects panel HTML, (7) modals (generate, export, new project), (8) script tags loading all JS files.

### CSS color scheme
```css
--bg-primary: #111111;
--bg-surface: #1a1a1a;
--bg-elevated: #222222;
--bg-header: #252525;
--border: #333333;
--text-primary: #e8e8e8;
--text-secondary: #888888;
--accent: #4CAF50;
--accent-hover: #66BB6A;
--danger: #ef5350;
--record-red: #f44336;
--playhead: #ffffff;
--grid-line: #2a2a2a;
--grid-line-bar: #333333;
```

### Layout (Ableton-style, dark theme)
```
┌─────────────────────────────────────────────────────────────────┐
│ TOOLBAR (48px): tools | transport | bpm | project name | export │
├────────────┬────────────────────────────────────────────────────┤
│ TRACK      │ TIMELINE RULER (32px, scrolls with arrangement)    │
│ HEADERS    ├────────────────────────────────────────────────────┤
│ (180px     │ ARRANGEMENT AREA (flex-grow, overflow-x: scroll)   │
│  fixed)    │ 8 track lanes, clips as positioned divs            │
│            │                                                     │
├────────────┴────────────────────────────────────────────────────┤
│ MIXER PANEL (160px): one column per track + master              │
└─────────────────────────────────────────────────────────────────┘

FX panel: fixed right sidebar, 320px, slides in/out
Modals: centered overlay for Generate, Export, New Project
```

### Track header (per track, stacked vertically in left sidebar)
- Color swatch (6px left border)
- Track name (editable on double-click)
- Track type icon (audio/midi)
- Height matches lane height (80px per track)

### Arrangement clip (absolutely positioned div in lane)
- Colored top bar (4px, track color)
- Track name label in top-left
- WaveSurfer waveform fill (non-interactive)
- Resize handle on right edge (8px draggable zone)
- Selected state: white border 1px

### Mixer column (per track)
- Track name (truncated)
- Color indicator
- VU meter (simple CSS bars)
- Volume fader (vertical range input, styled)
- Pan knob (range input -1 to 1)
- [M] mute button, [S] solo button, [FX] effects button
- Master column: same but wider, no FX button, Matchering button instead

### Transport controls
- ● REC (red), ▶ PLAY, ■ STOP, ↩ RETURN, ⟳ LOOP
- BPM display (click to edit)
- Playhead time display (MM:SS.ms)
- Project name (click to rename)

### Modals needed
1. **Generate Backing Tracks**: style text input, tempo/key optional overrides, checkboxes for which tracks (Drums, Bass, Chords, Lead, Custom), Generate button
2. **Export**: format selector (WAV/MP3/FLAC), mastering reference selector, include stems toggle, Export button
3. **New Project**: name input, BPM input, Create button
4. **Progress overlay**: shown during any long operation, animated spinner, step text, progress bar, estimated time

## Step 3 — Write electron files

`studio/electron/main.js`:
- Starts FastAPI: `uvicorn main:app --port 8765 --host 127.0.0.1` from the backend directory using the venv python
- Polls /health every 500ms until ready (max 30 seconds)
- Shows a splash BrowserWindow (800x500, frameless) while loading
- Opens main BrowserWindow (1400x900, min 1200x700) loading http://127.0.0.1:8765
- Closes splash when main is ready
- On quit: kills uvicorn child process
- System tray: Show, Hide, Quit

`studio/electron/preload.js`: minimal context bridge exposing only `versions`

`studio/electron/package.json`: name `studio-daw`, version `0.1.0`, scripts for start and build

## Step 4 — Write setup.sh and run.sh

`studio/setup.sh`:
- Check python3.11+ exists
- Create venv at studio/venv/
- Detect GPU (nvidia-smi), install torch with CUDA if found, CPU otherwise
- pip install -r backend/requirements.txt
- pip install git+https://github.com/facebookresearch/audiocraft.git
- Download Salamander Grand Piano SF2 to studio/soundfonts/ if not present
- cd electron && npm install
- Print success + run instructions

`studio/run.sh`:
- Activate venv
- cd backend && uvicorn main:app --host 127.0.0.1 --port 8765 --reload

## Step 5 — Write NOTES.md

Document: any workarounds used, known issues, missing features, how to run, how to package with Electron.

## Step 6 — Commit everything

Commit all new files to the current branch with message: "Phase 6-12: Complete frontend, Electron packaging, setup scripts"

## Constraints

- Do not ask permission between steps. Complete all steps.
- If you hit a stream timeout, on resume just check git status and continue from where you left off.
- Keep each individual file write focused — if a file is getting very long, that's fine, just write it completely before moving to the next one.
- All JS files use ES modules where practical. WaveSurfer.js loaded from CDN: `https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.min.js`
