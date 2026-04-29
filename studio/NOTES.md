# Studio DAW — Build Notes

## How to run

```bash
cd studio
./setup.sh          # first time only — installs all deps
./run.sh            # starts FastAPI on http://127.0.0.1:8765
# open http://127.0.0.1:8765 in browser
```

Desktop app (after setup):
```bash
cd studio/electron
npm start
```

## Architecture decisions

**Backend** (Python / FastAPI)
- All pipeline operations run in FastAPI `BackgroundTasks` threads; progress is broadcast over a single WebSocket (`/ws`). Every long job returns a `job_id` immediately and the frontend subscribes to events for that ID.
- Project files live at `~/Music/Studio Projects/<name>/project.json` with audio files alongside. This mirrors a typical DAW's project folder structure.
- Pedalboard is used for effects rather than manually building a DSP chain — it's faster, higher quality, and its `Pedalboard` class maps cleanly to our `EffectsChain` model.
- Matchering for mastering is wrapped in a try/except fallback to peak normalization — if no reference track is present or Matchering is not installed, the export still succeeds.

**Frontend** (Vanilla JS / Web Audio API)
- No framework, no build step. All state lives in `window.appState`.
- WaveSurfer.js (CDN) renders clip waveforms — non-interactive, display only.
- Web Audio API playback schedules `AudioBufferSourceNode`s at precise times. Buffers are cached by URL; invalidated when effects are applied.
- Undo/redo is a JSON snapshot stack (50 levels) — works for all track/clip mutations. Effects changes are applied server-side and not undoable in v1.

## Known issues / limitations

- **FluidSynth**: `pyfluidsynth` requires the system `fluidsynth` binary. On macOS: `brew install fluid-synth`. On Ubuntu: `sudo apt install fluidsynth`. The `/render` endpoint surfaces a human-readable error if it's missing.
- **MusicGen on CPU**: Generation takes 10–20 minutes for 30 seconds of audio. The backend warns about this in the `/health` response (`cpu_only: true`). The UI should surface this to the user before they click Generate (TODO: show warning in generate modal when health says cpu_only).
- **Matchering reference tracks**: The `studio/references/` directory is expected but not populated by setup.sh — Matchering falls back to normalization until real reference WAVs are placed there.
- **8-track limit**: Enforced in the UI (`addTrackBtn` is disabled at 8 tracks) but not enforced server-side. A future version should add a guard in the `/separate` and `/generate` handlers.
- **Electron tray icon**: Uses a placeholder data-URL icon. Replace with a real .png at packaging time.
- **CORS in production**: The backend allows `*` origins, fine for local use. Tighten before any network deployment.
- **WebM recording**: Browsers record in `audio/webm;codecs=opus`. The `/record/stop` endpoint converts to WAV via pydub/ffmpeg before saving. ffmpeg must be installed.
- **Audio format support**: The `/import` endpoint handles format conversion via pydub. Any format ffmpeg supports will work.
- **Arrangement scroll sync**: The ruler and lanes scroll together via a JS scroll listener. This can drift if the user scrolls both simultaneously — a CSS `subgrid` or sticky positioning approach would be cleaner but adds complexity.

## What's stubbed / not yet implemented

- Loop region drag (L toggles loop but the region bounds are fixed at 0–8s; drag UI not built)
- Automation draw tool (B key selects it but no automation lanes exist yet)
- MIDI track type (model supports it; UI defaults everything to "audio")
- Reference tracks for Matchering (directory exists; files need to be added)
- Electron code-signing and notarization (needed for macOS distribution)
- Progress ETA display (WebSocket sends `progress` float; ETA calculation not implemented)

## Packaging with Electron

```bash
cd studio/electron
npm run build        # produces dist/ with platform-specific installer
```

`electron-builder` is configured in `package.json` to bundle `backend/`, `venv/`, and `soundfonts/` as extra resources. The app launches uvicorn from the bundled venv on startup.

Note: bundling the full venv makes the installer large (~2–3 GB with torch). For distribution, consider a separate "install dependencies" step on first run instead.
