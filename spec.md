# Track 001 — MVP Pipeline

## Status: Ready for Implementation

## What Are We Building
A working local web app where a user can:
1. Record up to 15 seconds of audio from their microphone
2. Set a BPM (type it in or tap a button)
3. Write a style prompt ("trap drums", "john bonham rock kit", "lo-fi jazz")
4. Hit Generate and wait ~30-60 seconds
5. Play back and download the augmented WAV file

## Why
This is the core proof of concept. If this works and sounds good,
the product idea is validated. Everything else is iteration.

## Success Criteria
- [ ] User can record audio in the browser
- [ ] Recording is sent to the backend with BPM + style prompt
- [ ] Backend runs demucs → basic-pitch → MusicGen → mix
- [ ] User receives a downloadable WAV file
- [ ] Errors are shown clearly (not silently failing)
- [ ] Works on localhost without any cloud services except Replicate

## Out of Scope (for this track)
- User accounts or authentication
- Saving/history of past generations
- Multiple output variations
- DAW plugin format
- Stem preview or individual stem controls
- Mobile optimization

## Risks
- Demucs install can conflict with torch versions — pin carefully
- Basic Pitch may be slow on CPU — acceptable for MVP
- Replicate API latency is variable — must handle timeouts gracefully
- ffmpeg must be installed by user — document clearly in README
