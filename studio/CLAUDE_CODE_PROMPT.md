# Studio DAW — Claude Code Bootstrap Prompt

Paste everything below the horizontal rule into Claude Code running in the Default Cloud Environment.

---

Build me a fully functional local DAW application called **Studio** — a mini digital audio workstation for musicians who want to record a rough idea, have AI separate and augment the stems, add backing tracks, and mix everything down. Think stripped-down Ableton Live with AI generation baked in.

## Important: Existing Codebase Context

This project lives inside an existing repo at the `music-tools/` root. There is already a working v1 simple tool in `music-tools/backend/pipeline.py` and `music-tools/backend/main.py`. **Read those files before writing anything.** They contain working, tested implementations of:

- Demucs stem separation (with correct stereo handling, soundfile vs torchaudio workaround, resampling logic) — reuse this code directly in the new `pipeline/stems.py`
- Self-hosted MusicGen via HuggingFace transformers (GPU/CPU detection, model caching, audio export) — reuse this in `pipeline/musicgen.py`
- Basic Pitch audio→MIDI extraction — reuse in `pipeline/midi_gen.py`

**Do not overwrite or modify anything in `music-tools/backend/` or `music-tools/frontend/`.** The new Studio DAW is built entirely inside `music-tools/studio/` which already exists. All new files go there.

## What this is

A musician sits at a piano, records themselves playing and singing (up to ~1 minute). The app:
1. Separates their recording into individual stems (voice, piano, bass, drums, other) using Demucs
2. Generates AI backing tracks in a style they describe using self-hosted MusicGen (audiocraft)
3. Presents everything as a multitrack arrangement they can mix, cut, and edit
4. Applies per-track effects (EQ, compression, reverb, delay) using Pedalboard
5. Runs AI mastering on the final mix using Matchering
6. Exports a finished, polished audio file

The core promise: your performance stays. AI fills in everything else.

## Tech Stack — all open source, zero paid APIs

| Component | Library |
|---|---|
| Backend | FastAPI + uvicorn + websockets |
| Stem separation | Demucs (htdemucs model) |
| Audio → MIDI | Basic Pitch (Spotify) |
| MIDI generation | pretty_midi + midiutil (algorithmic from key/tempo) |
| MIDI → audio | FluidSynth + Salamander Grand Piano soundfont |
| AI music generation | audiocraft (Meta's MusicGen, self-hosted) |
| Effects chain | Pedalboard (Spotify) |
| AI mastering | Matchering |
| Audio manipulation | pydub + librosa + soundfile |
| Frontend | Vanilla HTML/CSS/JS, Web Audio API |
| Waveform display | WaveSurfer.js (CDN) |
| Desktop packaging | Electron |

**No Replicate. No paid APIs. Everything runs locally.**

MusicGen model selection: auto-detect GPU. If CUDA available and VRAM >= 8GB, use `facebook/musicgen-stereo-medium`. If CUDA but < 8GB VRAM, use `facebook/musicgen-stereo-small`. If CPU only, use `facebook/musicgen-small` and warn user about wait times (~10-20 min for 30s).

## Project Structure

```
studio/
  backend/
    main.py              # FastAPI app, all routes, WebSocket
    models.py            # Pydantic data models
    project.py           # Project save/load to JSON
    pipeline/
      __init__.py
      stems.py           # Demucs stem separation
      effects.py         # Pedalboard effects chain
      mastering.py       # Matchering AI mastering
      musicgen.py        # audiocraft MusicGen generation
      midi_gen.py        # MIDI generation + FluidSynth render
    requirements.txt
  frontend/
    index.html           # App shell + all CSS inline
    js/
      app.js             # Main controller + state management
      arrangement.js     # Arrangement view (tracks + clips)
      mixer.js           # Mixer panel
      transport.js       # Transport + Web Audio playback engine
      effects_ui.js      # Effects chain UI panels
      api.js             # Backend API + WebSocket client
      shortcuts.js       # Keyboard shortcuts
      recorder.js        # Microphone recording
  electron/
    main.js              # Electron entry — starts backend, opens UI
    preload.js           # Context bridge
    package.json
  soundfonts/            # (download Salamander Grand Piano here)
  setup.sh               # One-command setup script
  run.sh                 # Start the app
```

## Data Models (Pydantic)

```python
class EQBand(BaseModel):
    freq: float          # Hz (20-20000)
    gain: float          # dB (-18 to +18)
    q: float             # Q factor (0.1-10)
    type: str            # "lowshelf" | "highshelf" | "peak" | "lowpass" | "highpass"

class EQSettings(BaseModel):
    bands: List[EQBand] = []  # up to 5 bands

class CompressionSettings(BaseModel):
    threshold: float = -24.0   # dB
    ratio: float = 4.0
    attack_ms: float = 10.0
    release_ms: float = 100.0
    makeup_gain: float = 0.0

class ReverbSettings(BaseModel):
    room_size: float = 0.3    # 0-1
    wet_dry: float = 0.2      # 0-1
    damping: float = 0.5

class DelaySettings(BaseModel):
    time_ms: float = 250.0
    feedback: float = 0.3
    wet_dry: float = 0.15

class EffectsChain(BaseModel):
    eq: EQSettings = EQSettings()
    compression: CompressionSettings = CompressionSettings()
    reverb: ReverbSettings = ReverbSettings()
    delay: DelaySettings = DelaySettings()
    eq_enabled: bool = True
    compression_enabled: bool = True
    reverb_enabled: bool = False
    delay_enabled: bool = False

class Clip(BaseModel):
    id: str
    file: str            # relative path to audio file within project dir
    start: float         # seconds on timeline
    duration: float      # seconds
    offset: float = 0.0  # trim start within the file (seconds)
    color: str = "#4CAF50"

class Track(BaseModel):
    id: str
    name: str
    type: str = "audio"  # "audio" | "midi"
    color: str
    muted: bool = False
    solo: bool = False
    volume: float = 0.8  # 0-1
    pan: float = 0.0     # -1 to 1
    clips: List[Clip] = []
    effects: EffectsChain = EffectsChain()

class Project(BaseModel):
    id: str
    name: str
    bpm: float = 120.0
    sample_rate: int = 44100
    tracks: List[Track] = []
    created_at: str
    updated_at: str
```

## Track Color Palette (8 tracks, Ableton-inspired)

```
Track 1: #FF6B6B  (coral/red)
Track 2: #4ECDC4  (teal)
Track 3: #45B7D1  (blue)
Track 4: #96CEB4  (sage green)
Track 5: #FFEAA7  (yellow)
Track 6: #DDA0DD  (plum)
Track 7: #98D8C8  (mint)
Track 8: #F7DC6F  (gold)
```

## Default Effects Presets by Track Type

Apply these when stems are first created:

**Vocals**: EQ (high-pass at 80Hz, presence boost +2dB at 3kHz, air boost +1.5dB at 12kHz), Compression (threshold -18dB, ratio 3:1, attack 10ms, release 80ms), Reverb (room 0.25, wet 0.18)

**Piano**: EQ (high-pass at 40Hz, slight warmth +1.5dB at 200Hz, de-harsh -1dB at 2kHz), Compression (threshold -20dB, ratio 2.5:1, attack 30ms, release 200ms)

**Drums**: EQ (high-pass at 30Hz, punch +2dB at 80Hz, presence +1dB at 5kHz), Compression (threshold -12dB, ratio 6:1, attack 5ms, release 50ms)

**Bass**: EQ (low-pass at 8kHz, sub boost +2dB at 60Hz, mud cut -2dB at 250Hz), Compression (threshold -18dB, ratio 4:1, attack 20ms, release 150ms)

**Other/Pads**: EQ (high-pass at 120Hz), Reverb (room 0.5, wet 0.3), Delay (time 375ms, feedback 0.25, wet 0.12)

**Generated/AI tracks**: Same as above matching the instrument type. If unknown, use Other/Pads preset.

## Backend API Routes

```
GET  /                          → serve index.html
GET  /health                    → {"status": "ok", "gpu": bool, "model": str}
WS   /ws                        → WebSocket for all progress events

POST /project/new               → create new project, return project JSON
GET  /project/{id}              → load project JSON
POST /project/{id}/save         → save project JSON
GET  /project/{id}/tracks/{track_id}/clip/{clip_id}/audio  → serve audio file

POST /record/stop               → receive recorded audio blob, save to project
POST /import                    → import audio file into project as new track

POST /separate/{project_id}     → run Demucs on a clip, returns job_id
POST /generate/{project_id}     → run MusicGen generation, returns job_id
POST /render/{project_id}       → render MIDI to audio via FluidSynth, returns job_id
POST /export/{project_id}       → mixdown all tracks + mastering, returns job_id

POST /effects/{project_id}/{track_id}  → apply effects chain to a clip, return processed audio
```

WebSocket message format:
```json
{"type": "progress", "job_id": "...", "step": "Separating stems...", "progress": 0.45}
{"type": "complete", "job_id": "...", "result": {...}}
{"type": "error", "job_id": "...", "message": "..."}
```

## Frontend Architecture

Single-page app in vanilla JS. No frameworks, no build step.

**Layout (dark theme, Ableton-inspired):**
```
┌─────────────────────────────────────────────────────────────────┐
│ TOOLBAR: [▶ Select] [✂ Cut] [✏ Draw] │ [● REC] [▶ PLAY] [■ STOP] [↩] [⟳ LOOP] │ BPM: 120 │ PROJECT NAME │
├────────────┬────────────────────────────────────────────────────┤
│ TRACK      │ TIMELINE RULER (scrollable)                        │
│ HEADERS    ├────────────────────────────────────────────────────┤
│ (fixed)    │ ARRANGEMENT VIEW                                   │
│            │ 8 track lanes, clips as colored blocks w/ waveform │
│            │                                                     │
├────────────┴────────────────────────────────────────────────────┤
│ MIXER: [Track1] [Track2] ... [Track8] [Master]                  │
│  Each: name, fader, pan, [M] [S] [FX] buttons                  │
└─────────────────────────────────────────────────────────────────┘
```

Side panel (slides in from right when FX clicked):
```
┌──────────────────────┐
│ FX CHAIN: Track Name │
│ [✓] EQ               │
│   [band controls]    │
│ [✓] Compression      │
│   [controls]         │
│ [ ] Reverb           │
│ [ ] Delay            │
│ [Apply] [Close]      │
└──────────────────────┘
```

**Color scheme:**
```css
--bg-primary: #111111
--bg-surface: #1a1a1a
--bg-elevated: #222222
--bg-header: #252525
--border: #333333
--text-primary: #e8e8e8
--text-secondary: #888888
--accent: #4CAF50
--accent-hover: #66BB6A
--danger: #ef5350
--record-red: #f44336
--playhead: #ffffff
--grid-line: #2a2a2a
--grid-line-bar: #333333
```

**Arrangement view clip rendering:**
- Clips are absolutely-positioned divs within each track lane
- Width = duration * pixelsPerSecond (default 100px/sec, zoom adjustable)
- Left = start * pixelsPerSecond
- Each clip contains a WaveSurfer.js instance (non-interactive, display only)
- Clip header shows name + color bar at top
- Drag clip body to move horizontally (snap to grid when grid is on)
- Drag right edge to resize (extend/trim)
- With Cut tool: click anywhere on clip to split at that time position
- Double-click clip to rename
- Right-click clip: context menu [Split, Duplicate, Delete, Rename, Reverse]

**Playback engine (transport.js):**
Use Web Audio API. On Play:
1. Create AudioContext if not exists
2. For each non-muted track, for each clip that intersects the play range:
   - Fetch audio via /project/{id}/tracks/{track_id}/clip/{clip_id}/audio
   - Decode into AudioBuffer
   - Apply track gain (GainNode), pan (StereoPannerNode), EQ (BiquadFilterNodes), Compression (DynamicsCompressorNode), Reverb (ConvolverNode with IR), Delay (DelayNode)
   - Schedule AudioBufferSourceNode.start(ctx.currentTime + (clip.start - playheadTime))
3. Animate playhead with requestAnimationFrame using ctx.currentTime
4. Solo logic: if any track is soloed, mute all non-soloed tracks

**Recording (recorder.js):**
- getUserMedia → MediaRecorder → collect chunks
- On stop: assemble Blob, POST to /record/stop
- Show waveform preview while recording using AnalyserNode
- Display countdown timer
- After upload: auto-trigger stem separation flow

## Keyboard Shortcuts

```
Space           → Play / Stop (toggle)
R               → Record (toggle)
Return/Enter    → Return to start
L               → Toggle loop region
V               → Select tool
C               → Cut tool  
B               → Draw automation tool
M               → Mute selected track
S               → Solo selected track
Cmd/Ctrl+Z      → Undo
Cmd/Ctrl+Y      → Redo
Cmd/Ctrl+D      → Duplicate selected clip
Cmd/Ctrl+S      → Save project
Delete/Backspace → Delete selected clip
+               → Zoom in (arrangement)
-               → Zoom out (arrangement)
Cmd/Ctrl+A      → Select all clips on selected track
Escape          → Deselect all / cancel operation
```

## AI Generation Flow (frontend)

When user clicks "Generate Backing Tracks":
1. Show modal: style text input ("jazzy piano trio", "80s synthwave", "lo-fi hip hop")
2. Optional: tempo override, key override
3. Choose which tracks to generate: [Drums] [Bass] [Chords/Pads] [Lead] (checkboxes)
4. Click Generate → POST /generate/{project_id}
5. WebSocket progress updates shown in animated progress panel
6. On complete: generated stems automatically added as new tracks in arrangement

## Stem Separation Flow

After recording or importing:
1. Show "Separate Stems" button on the imported track
2. Click → POST /separate/{project_id} with clip info
3. WebSocket progress
4. On complete: original track stays, new tracks added (Vocals, Piano, Drums, Bass, Other)
5. Auto-apply default effects presets per stem type
6. Demucs model: htdemucs (best quality/speed balance)

## Export Flow

Click Export button (top right):
1. Choose: export format (WAV 24-bit, MP3 320k, FLAC), include stems toggle
2. Click Export → POST /export/{project_id}
3. Backend: render all tracks through Pedalboard effects, mix down, run Matchering mastering
4. Matchering reference: bundle a few reference tracks by style (warm/vintage, modern pop, cinematic, neutral). User picks one or can skip mastering.
5. On complete: download link shown, file saved to ~/Music/Studio Exports/

## Electron Packaging

electron/main.js should:
1. Start the FastAPI backend as a child process: `uvicorn main:app --port 8765 --host 127.0.0.1`
2. Wait for backend to be healthy (poll /health)
3. Open BrowserWindow loading http://127.0.0.1:8765
4. Window size: 1400x900, min 1200x700
5. On app quit: kill the backend child process
6. Show a splash screen while backend is loading (simple HTML with spinner)
7. Add a tray icon with: Show, Hide, Quit options

electron/package.json:
```json
{
  "name": "studio-daw",
  "version": "0.1.0",
  "main": "main.js",
  "scripts": {
    "start": "electron .",
    "build": "electron-builder"
  },
  "dependencies": {
    "electron": "^31.0.0"
  },
  "devDependencies": {
    "electron-builder": "^24.0.0"
  }
}
```

## Setup Script (setup.sh)

Write a setup script that:
1. Checks Python 3.11+ is installed
2. Creates a venv at studio/venv/
3. Installs PyTorch (CPU build if no GPU detected, CUDA build if GPU found)
4. Installs all requirements.txt packages
5. Downloads audiocraft: `pip install git+https://github.com/facebookresearch/audiocraft.git`
6. Downloads Salamander Grand Piano soundfont to studio/soundfonts/ (link: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html or similar freely available SF2)
7. Installs Node deps for Electron: `cd electron && npm install`
8. Prints success message with run instructions

## Run Script (run.sh)

```bash
#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate
cd backend
uvicorn main:app --host 127.0.0.1 --port 8765 --reload
```

## Implementation Notes + Constraints

- **No hard recording limit** — configurable via env var `MAX_RECORD_SECONDS` (default 60)
- **8 tracks max** — enforce in the UI (disable Add Track when at 8)
- **Project files** — saved as `~/Music/Studio Projects/{project_name}/project.json` with audio files alongside
- **Temp files** — use `~/.studio-daw/tmp/` for processing intermediates, clean on startup
- **GPU detection** — detect at startup, cache result, expose via /health endpoint
- **Model caching** — Demucs and MusicGen models download once to `~/.cache/`, never re-download
- **Error handling** — all pipeline errors should surface as human-readable messages in the UI, never raw stack traces
- **Progress granularity** — send WebSocket progress updates at minimum every 5 seconds during long operations; include estimated time remaining when possible
- **Undo/redo** — implement as a simple action stack (move clip, delete clip, add clip, mute/unmute); effects changes are not undoable in v1
- **WaveSurfer.js** — load from CDN: `https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.min.js`
- **pyfluidsynth** — requires system-level `fluidsynth` binary; check at startup and show friendly error if missing

## Build Instructions for Claude Code

**Before writing any code:** Read `music-tools/backend/pipeline.py` and `music-tools/backend/main.py` in full. Extract and adapt the working Demucs, MusicGen, and Basic Pitch code into the new pipeline modules rather than rewriting from scratch.

Work through this in phases. After each phase, verify it works before continuing:

**Phase 1 — Backend foundation:** Write models.py, project.py, backend/main.py (all routes, WebSocket). Test with curl that all routes respond. Don't implement pipeline yet — return mock responses.

**Phase 2 — Pipeline — Stems:** Write pipeline/stems.py (Demucs). Test with a sample audio file. Verify 4 stems are produced.

**Phase 3 — Pipeline — Effects + Mastering:** Write pipeline/effects.py (Pedalboard), pipeline/mastering.py (Matchering). Test effects chain on a WAV file.

**Phase 4 — Pipeline — MusicGen:** Write pipeline/musicgen.py (audiocraft). Test generation with a short prompt. Handle GPU/CPU detection.

**Phase 5 — Pipeline — MIDI:** Write pipeline/midi_gen.py (Basic Pitch + pretty_midi + FluidSynth). Test audio→MIDI→audio round trip.

**Phase 6 — Frontend — Shell + Transport:** Write index.html with layout, CSS, transport controls. Wire up Web Audio API playback with a test audio file.

**Phase 7 — Frontend — Arrangement view:** Write arrangement.js. Implement clip rendering, drag/resize, cut tool, zoom, snap.

**Phase 8 — Frontend — Mixer + Effects UI:** Write mixer.js, effects_ui.js. Wire faders/pan to Web Audio nodes, FX panel to backend /effects route.

**Phase 9 — Frontend — Recording + Generation flows:** Write recorder.js. Wire the full record→separate→arrange flow. Wire the generate→arrange flow.

**Phase 10 — Keyboard shortcuts:** Write shortcuts.js. Test all shortcuts listed above.

**Phase 11 — Electron:** Write electron/main.js, preload.js, package.json. Test that the app opens as a desktop window.

**Phase 12 — Setup script + polish:** Write setup.sh and run.sh. Do an end-to-end test: record audio, separate, generate, mix, export. Fix any broken connections.

Do not ask for permission to proceed between phases. If you hit a dependency issue or API incompatibility, work around it and note the workaround in a NOTES.md file. Commit working code after each phase using git.

When done, print a summary of: what works, what's stubbed, any known issues, and how to run the app.
