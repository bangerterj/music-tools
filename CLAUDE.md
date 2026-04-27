# Music Augmentation Tool — Project Context

## Product
A local web app that lets musicians record a rough idea (up to 15 seconds),
describe a style, and get back a fully augmented version with AI-generated
stems mixed around their original performance.

The core promise: your performance stays. AI fills in everything else.

Target user: musicians and producers who have rough ideas but lack
production skills or time to fully produce them.

## Product Goals
- Make it feel like a musician's tool, not a tech demo
- Keep the user's original recording at the center of the output
- Fast enough to iterate on (generation under 60 seconds)
- Dead simple UI — record, describe, generate, download

## Tech Stack
- **Frontend**: Vanilla HTML/CSS/JS, single index.html, Web Audio API for
  recording and waveform visualization. No framework.
- **Backend**: Python 3.11+, FastAPI, uvicorn
- **Stem separation**: Demucs (Meta, open source)
- **Audio to MIDI**: Basic Pitch (Spotify, open source)
- **AI generation**: Replicate API → MusicGen (meta/musicgen)
- **Audio mixing**: pydub + librosa
- **File storage**: local /tmp during development
- **Environment**: .env file with REPLICATE_API_TOKEN

## Project Structure
```
music-tool/
  backend/
    main.py          # FastAPI app, routes, CORS
    pipeline.py      # Full audio processing chain
    requirements.txt
  frontend/
    index.html       # Entire UI in one file
  conductor/         # Project management artifacts
  .env               # REPLICATE_API_TOKEN=your_token_here
  README.md
```

## Workflow Preferences
- Write a plan and get approval before implementing any feature
- Build backend first, verify it works via curl, then build frontend
- Test each pipeline stage independently before chaining them
- Use git commits at the end of each working phase
- Never break a working state — if something works, commit before continuing
- Prefer simple and working over clever and broken

## Code Style
- Python: clear variable names, docstrings on functions, type hints
- JS: vanilla only, no build step, no npm, no frameworks
- Keep functions small and single-purpose
- Comments explain *why*, not *what*
- Error messages should be human-readable, not stack traces

## Known Constraints
- Demucs and Basic Pitch are slow — always show progress to the user
- Replicate API calls are async — must poll for completion
- MusicGen output is 15-30 seconds max — matches our recording limit
- ffmpeg must be installed locally for pydub to work
- Generation takes 20-60 seconds — design UX around this wait

## Environment Setup (for new contributors)
```bash
brew install ffmpeg          # Mac
pip install -r backend/requirements.txt
cp .env.example .env         # then add your Replicate token
cd backend && uvicorn main:app --reload
# open frontend/index.html in browser
```
