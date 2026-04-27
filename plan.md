# Plan — Track 001: MVP Pipeline

## Status: Pending Approval

---

## Phase 1: Project Scaffold
*Goal: repo exists, dependencies defined, server starts*

- [ ] Create folder structure (backend/, frontend/, conductor/)
- [ ] Create backend/requirements.txt with all dependencies
- [ ] Create .env.example with REPLICATE_API_TOKEN placeholder
- [ ] Create backend/main.py with FastAPI app skeleton + CORS
- [ ] Create backend/pipeline.py as empty module with function stubs
- [ ] Verify: `uvicorn main:app --reload` starts without errors
- [ ] Create README.md with setup instructions
- [ ] Git commit: `feat(scaffold): initial project structure`

---

## Phase 2: Audio Upload + Storage
*Goal: frontend can record audio and send it to backend*

- [ ] Add POST /generate route to main.py that accepts:
  - audio file (multipart)
  - bpm (int)
  - style_prompt (string)
- [ ] Save uploaded file to /tmp with a unique ID
- [ ] Return job_id in response
- [ ] Test with curl using a sample WAV file
- [ ] Add basic frontend: record button, BPM field, style input, submit
- [ ] Wire frontend to POST /generate
- [ ] Verify: file arrives in /tmp after submit
- [ ] Git commit: `feat(upload): audio recording and upload`

---

## Phase 3: Stem Separation (Demucs)
*Goal: uploaded audio gets separated into stems*

- [ ] Implement `separate_stems(input_path, output_dir)` in pipeline.py
- [ ] Run demucs programmatically on the uploaded file
- [ ] Return paths to separated stems (drums, bass, other, vocals)
- [ ] Handle demucs errors gracefully (wrap in try/except)
- [ ] Test independently: call function with a sample file, verify stems exist
- [ ] Wire into /generate route after file save
- [ ] Git commit: `feat(pipeline): demucs stem separation`

---

## Phase 4: Audio → MIDI (Basic Pitch)
*Goal: extract pitch/note information from the recording*

- [ ] Implement `extract_midi(input_path, output_dir)` in pipeline.py
- [ ] Run basic-pitch on the uploaded audio
- [ ] Extract: detected tempo, key estimate, MIDI note events
- [ ] Return structured dict with musical context
- [ ] Test independently with a hummed melody file
- [ ] Wire into /generate route after stem separation
- [ ] Git commit: `feat(pipeline): basic-pitch MIDI extraction`

---

## Phase 5: MusicGen Generation via Replicate
*Goal: AI generates new stems based on style prompt + musical context*

- [ ] Implement `generate_stems(style_prompt, bpm, musical_context)` in pipeline.py
- [ ] Build a rich prompt from style_prompt + detected tempo + key
  - e.g. "trap drum kit, 140 bpm, heavy 808s, crisp hi-hats"
- [ ] Call Replicate API with meta/musicgen model
- [ ] Poll for completion (max 120 second timeout)
- [ ] Download generated audio file to /tmp
- [ ] Handle API errors and timeouts gracefully
- [ ] Test independently: call with a style prompt, verify audio output
- [ ] Wire into /generate route after MIDI extraction
- [ ] Git commit: `feat(pipeline): musicgen generation via replicate`

---

## Phase 6: Mix Down
*Goal: blend original recording with generated stems into final WAV*

- [ ] Implement `mix_audio(original_path, generated_path, output_path)` in pipeline.py
- [ ] Load both audio files with pydub
- [ ] Normalize levels before mixing
- [ ] Overlay original on generated at appropriate volume balance
- [ ] Export as WAV to /tmp
- [ ] Test independently with two sample audio files
- [ ] Wire into /generate route as final step
- [ ] Git commit: `feat(pipeline): mix down original + generated audio`

---

## Phase 7: Async Job Status + Polling
*Goal: frontend shows progress while backend works*

- [ ] Add GET /status/{job_id} route that returns job state:
  - pending | processing | complete | error
  - current step (e.g. "Separating stems...")
  - output_url when complete
- [ ] Store job state in a simple in-memory dict (no DB needed)
- [ ] Update job state at each pipeline step
- [ ] Add GET /download/{job_id} route that serves the final WAV
- [ ] Frontend polls /status every 2 seconds after submit
- [ ] Show progress steps in UI as they update
- [ ] Show playback player + download button when complete
- [ ] Git commit: `feat(api): async job status and polling`

---

## Phase 8: UI Polish
*Goal: UI feels like a music tool, not a prototype*

- [ ] Dark theme with music-tool aesthetic
- [ ] Waveform visualizer during recording (Web Audio API)
- [ ] Record button turns red while recording, shows timer
- [ ] Tap tempo button for BPM detection
- [ ] Style prompt with placeholder examples ("trap drums", "john bonham")
- [ ] Progress indicator with step names during generation
- [ ] Before/after toggle in the playback player
- [ ] Error states with clear human-readable messages
- [ ] Git commit: `feat(ui): polished music tool interface`

---

## Phase 9: README + Cleanup
*Goal: anyone can clone and run this*

- [ ] README.md with full setup steps
- [ ] Document ffmpeg requirement prominently
- [ ] Document how to get a Replicate API key
- [ ] Add .gitignore (exclude /tmp, .env, __pycache__, venv)
- [ ] Clean up any debug logging
- [ ] Final end-to-end test: record → generate → download
- [ ] Git commit: `docs: readme and final cleanup`

---

## Estimated Phases to First Working Demo
Phases 1-7 = working but ugly. Phase 8 = looks good. Phase 9 = shareable.
Focus on 1-7 first. Don't touch UI until the pipeline works.
