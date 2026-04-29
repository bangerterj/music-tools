# Studio DAW — Build Notes

## How to Run

```bash
# First time setup (creates venv, installs everything)
cd studio
chmod +x setup.sh run.sh
./setup.sh

# Start the backend server
./run.sh

# Open in browser
open http://127.0.0.1:8765

# Or run as desktop app (after setup)
cd electron && npm start
```

## What's Working (Phases 1–12)

### Backend
- **FastAPI server** with WebSocket broadcast for real-time progress
- **Project save/load** to `~/Music/Studio Projects/{name}/project.json`
- **Stem separation** via Demucs `htdemucs` model — vocals, drums, bass, other
- **Audio → MIDI** via Basic Pitch
- **MIDI generation** via pretty_midi (algorithmic, key/tempo aware)
- **MIDI → audio render** via FluidSynth + Salamander Grand Piano soundfont
- **MusicGen generation** via audiocraft (Meta) — auto-detects GPU, picks model size
- **Effects chain** via Pedalboard — EQ (5-band), compression, reverb, delay
- **AI mastering** via Matchering — reference-track-based
- **Export** — WAV/MP3/FLAC with optional per-stem export

### Frontend
- **Arrangement view** — Ableton-style horizontal timeline, 8 track lanes
- **Clips** — drag to move, drag edge to resize, cut tool splits, right-click context menu
- **Waveforms** — WaveSurfer.js per clip
- **Mixer panel** — fader, pan, mute, solo, FX button per track
- **FX chain panel** — EQ bands, compression, reverb, delay with enable toggles
- **Transport** — play/pause/stop/return, loop region
- **Web Audio playback** — synchronized multi-track, respects mute/solo/volume/pan
- **Recording** — getUserMedia → MediaRecorder → upload → auto-stem separation offer
- **Keyboard shortcuts** — full Ableton-inspired set (see below)
- **Undo/redo** — move, delete, add/remove track
- **AI Generate modal** — style prompt, track type selection, tempo/key overrides
- **Export modal** — format, mastering reference style, include stems option

### Electron
- Starts FastAPI backend as child process
- Polls /health before opening window
- Splash screen while loading
- System tray (Show/Hide/Quit)
- Cleans up backend process on quit

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play / Pause |
| R | Record |
| Enter | Return to start |
| L | Toggle loop |
| V | Select tool |
| C | Cut tool |
| B | Draw tool |
| M | Mute selected track |
| S | Solo selected track |
| Cmd/Ctrl+Z | Undo |
| Cmd/Ctrl+Y | Redo |
| Cmd/Ctrl+D | Duplicate clip |
| Cmd/Ctrl+S | Save project |
| Delete | Delete selected clip |
| + / - | Zoom in / out |
| Escape | Deselect / close modal |

## Known Issues / Workarounds

- **torchaudio on newer Python builds**: Demucs resampling falls back to torchaudio.functional if available, otherwise skips resampling (minor quality impact if source SR differs from model SR). See `pipeline/stems.py`.
- **MusicGen on CPU**: Very slow (~15-30 min for 30s). User is warned via /health endpoint. Use GPU if available.
- **FluidSynth missing**: MIDI → audio render will fail gracefully with an error message. Install fluidsynth via brew or apt.
- **audiocraft install**: Must be installed from GitHub source (`pip install git+https://...`). PyPI package may be outdated.
- **Matchering reference tracks**: The reference audio files for mastering styles (warm/modern/cinematic/neutral) need to be placed in `studio/backend/assets/reference/` as `warm.wav`, `modern.wav`, etc. Without them, mastering is skipped with a warning. Short commercially-released tracks work well as references.
- **Stem separation on piano+vocals**: Demucs performs well on most material but piano and vocals can bleed slightly on intimate recordings. This is a model limitation, not a bug.
- **Effects apply**: The `/effects` endpoint re-renders the clip through Pedalboard and saves a new processed file. The original is preserved as `{clip_id}_original.wav`. Undo restores the original.
- **Loop region**: Drag on the timeline ruler while Loop is enabled (L) to set the loop range.

## Project File Format

Projects are saved as JSON at `~/Music/Studio Projects/{name}/project.json` with audio files in the same directory. The format matches the `Project` Pydantic model in `backend/models.py`.

## Adding VST Plugins (Power Users)

Pedalboard supports VST3 and AU plugins. To load one, add to `pipeline/effects.py`:

```python
from pedalboard import load_plugin
my_plugin = load_plugin("/path/to/Plugin.vst3")
board.append(my_plugin)
```

## Packaging as a Desktop App

```bash
cd electron
npm run build        # builds for current platform
npm run build:mac    # macOS
npm run build:win    # Windows
npm run build:linux  # Linux AppImage
```

Output goes to `electron/dist/`. The Python backend and venv need to be bundled separately — this is a known limitation of the v0.1 packaging. For a fully self-contained app, consider PyInstaller for the backend.
