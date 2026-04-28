"""Studio DAW — FastAPI backend.

Routes
------
GET  /                                              → serve index.html
GET  /health                                        → status + GPU info
WS   /ws                                            → progress events (broadcast)

POST /project/new                                   → create project
GET  /project/{id}                                  → load project
POST /project/{id}/save                             → save project
GET  /project/{id}/tracks/{tid}/clip/{cid}/audio   → serve clip audio

POST /record/stop                                   → save recorded blob, return clip info
POST /import                                        → import audio file as new track

POST /separate/{project_id}                         → Demucs stem separation
POST /generate/{project_id}                         → MusicGen generation
POST /render/{project_id}                           → MIDI → audio render
POST /export/{project_id}                           → full mixdown + mastering

POST /effects/{project_id}/{track_id}               → apply effects chain, return audio
"""

from __future__ import annotations

import asyncio
import os
import shutil
import uuid
from pathlib import Path
from typing import Any

import soundfile as sf
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import project as proj_module
from models import Clip, EffectsChain, Project, Track, STEM_PRESETS, TRACK_COLORS
from pipeline import musicgen as mg_pipeline
from pipeline import stems as stems_pipeline

MAX_RECORD_SECONDS = int(os.environ.get("MAX_RECORD_SECONDS", 60))
TMP_ROOT = Path.home() / ".studio-daw" / "tmp"
TMP_ROOT.mkdir(parents=True, exist_ok=True)

SOUNDFONT_PATH = Path(__file__).parent.parent / "soundfonts" / "grand-piano.sf2"

app = FastAPI(title="Studio DAW")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── WebSocket broadcast ───────────────────────────────────────────────────────

_ws_clients: set[WebSocket] = set()


async def _broadcast(msg: dict) -> None:
    dead = set()
    for ws in _ws_clients:
        try:
            await ws.send_json(msg)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)


def _emit(job_id: str, step: str, progress: float) -> None:
    """Fire-and-forget progress event from a sync background thread."""
    msg = {"type": "progress", "job_id": job_id, "step": step, "progress": progress}
    try:
        loop = asyncio.get_event_loop()
        loop.call_soon_threadsafe(asyncio.ensure_future, _broadcast(msg))
    except RuntimeError:
        pass  # No running loop (tests / CLI)


def _emit_complete(job_id: str, result: dict) -> None:
    msg = {"type": "complete", "job_id": job_id, "result": result}
    try:
        loop = asyncio.get_event_loop()
        loop.call_soon_threadsafe(asyncio.ensure_future, _broadcast(msg))
    except RuntimeError:
        pass


def _emit_error(job_id: str, message: str) -> None:
    msg = {"type": "error", "job_id": job_id, "message": message}
    try:
        loop = asyncio.get_event_loop()
        loop.call_soon_threadsafe(asyncio.ensure_future, _broadcast(msg))
    except RuntimeError:
        pass


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    _ws_clients.add(ws)
    try:
        while True:
            await ws.receive_text()  # keep connection alive; ignore client msgs
    except WebSocketDisconnect:
        _ws_clients.discard(ws)


# ── Frontend static files ─────────────────────────────────────────────────────

_FRONTEND = Path(__file__).parent.parent / "frontend"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(str(_FRONTEND / "index.html"))


if _FRONTEND.exists():
    app.mount("/static", StaticFiles(directory=str(_FRONTEND)), name="static")


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    info = mg_pipeline.gpu_info()
    return {"status": "ok", "gpu": info["gpu"], "model": info["model"]}


# ── Project management ────────────────────────────────────────────────────────

@app.post("/project/new")
def new_project(name: str = Query(default="Untitled Project")) -> dict:
    project = proj_module.create_project(name)
    return project.model_dump()


@app.get("/project/{project_id}")
def get_project(project_id: str) -> dict:
    project = proj_module.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project.model_dump()


@app.post("/project/{project_id}/save")
def save_project(project_id: str, body: Project) -> dict:
    if body.id != project_id:
        raise HTTPException(status_code=400, detail="Project ID mismatch")
    proj_module.save_project(body)
    return {"ok": True}


@app.get("/project/{project_id}/tracks/{track_id}/clip/{clip_id}/audio")
def serve_clip_audio(project_id: str, track_id: str, clip_id: str) -> FileResponse:
    path = proj_module.audio_path(project_id, track_id, clip_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(str(path), media_type="audio/wav")


# ── Recording ─────────────────────────────────────────────────────────────────

@app.post("/record/stop")
async def record_stop(
    project_id: str = Form(...),
    audio: UploadFile = File(...),
) -> dict:
    """Receive a recorded audio blob, save it, add it to the project as a new track."""
    project = proj_module.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    pdir = proj_module.get_project_dir(project_id)
    if pdir is None:
        raise HTTPException(status_code=500, detail="Project directory not found")

    raw_suffix = Path(audio.filename or "").suffix or ".webm"
    raw_path = pdir / f"recording{raw_suffix}"

    with open(raw_path, "wb") as f:
        f.write(await audio.read())

    # Convert to WAV if needed
    wav_path = pdir / "recording.wav"
    if raw_suffix.lower() != ".wav":
        try:
            from pydub import AudioSegment
            AudioSegment.from_file(str(raw_path)).export(str(wav_path), format="wav")
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Audio conversion failed: {exc}")
    else:
        wav_path = raw_path

    # Determine duration
    try:
        info = sf.info(str(wav_path))
        duration = info.frames / info.samplerate
    except Exception:
        duration = 0.0

    clip_id = str(uuid.uuid4())
    clip = Clip(
        id=clip_id,
        file="recording.wav",
        start=0.0,
        duration=duration,
        color=TRACK_COLORS[len(project.tracks) % len(TRACK_COLORS)],
    )

    track = proj_module.add_track(project, "Recording", stem_type="other")
    track.clips.append(clip)
    proj_module.save_project(project)

    return {
        "track_id": track.id,
        "clip_id": clip_id,
        "duration": duration,
        "project": project.model_dump(),
    }


# ── Import ────────────────────────────────────────────────────────────────────

@app.post("/import")
async def import_audio(
    project_id: str = Form(...),
    audio: UploadFile = File(...),
    track_name: str = Form(default="Imported"),
) -> dict:
    project = proj_module.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    pdir = proj_module.get_project_dir(project_id)
    if pdir is None:
        raise HTTPException(status_code=500, detail="Project directory not found")

    orig_name = Path(audio.filename or "imported.wav").name
    dest_path = pdir / orig_name
    # Avoid overwriting existing files
    if dest_path.exists():
        dest_path = pdir / f"{uuid.uuid4().hex[:8]}_{orig_name}"

    with open(dest_path, "wb") as f:
        f.write(await audio.read())

    # Convert to WAV if needed
    if dest_path.suffix.lower() != ".wav":
        try:
            from pydub import AudioSegment
            wav_path = dest_path.with_suffix(".wav")
            AudioSegment.from_file(str(dest_path)).export(str(wav_path), format="wav")
            dest_path = wav_path
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Audio conversion failed: {exc}")

    try:
        info = sf.info(str(dest_path))
        duration = info.frames / info.samplerate
    except Exception:
        duration = 0.0

    clip_id = str(uuid.uuid4())
    rel_file = dest_path.relative_to(pdir).as_posix()
    clip = Clip(
        id=clip_id,
        file=rel_file,
        start=_next_clip_start(project),
        duration=duration,
        color=TRACK_COLORS[len(project.tracks) % len(TRACK_COLORS)],
    )

    track = proj_module.add_track(project, track_name, stem_type="other")
    track.clips.append(clip)
    proj_module.save_project(project)

    return {
        "track_id": track.id,
        "clip_id": clip_id,
        "duration": duration,
        "project": project.model_dump(),
    }


def _next_clip_start(project: Project) -> float:
    """Find the end of the last clip across all tracks."""
    end = 0.0
    for track in project.tracks:
        for clip in track.clips:
            end = max(end, clip.start + clip.duration)
    return end


# ── Stem separation ───────────────────────────────────────────────────────────

@app.post("/separate/{project_id}")
async def separate(
    project_id: str,
    background_tasks: BackgroundTasks,
    track_id: str = Form(...),
    clip_id: str = Form(...),
) -> dict:
    """Kick off Demucs separation on a clip. Returns job_id immediately."""
    audio_file = proj_module.audio_path(project_id, track_id, clip_id)
    if audio_file is None:
        raise HTTPException(status_code=404, detail="Clip audio not found")

    job_id = str(uuid.uuid4())
    background_tasks.add_task(
        _run_separate, job_id, project_id, audio_file
    )
    return {"job_id": job_id}


def _run_separate(job_id: str, project_id: str, audio_file: Path) -> None:
    try:
        project = proj_module.load_project(project_id)
        if project is None:
            _emit_error(job_id, "Project not found")
            return

        pdir = proj_module.get_project_dir(project_id)
        stems_dir = pdir / "stems" / job_id[:8]

        def cb(step, pct):
            _emit(job_id, step, pct)

        stems = stems_pipeline.separate_stems(audio_file, stems_dir, progress_cb=cb)

        # Reload project (may have changed)
        project = proj_module.load_project(project_id)

        STEM_ORDER = ["drums", "bass", "other", "vocals"]
        new_tracks = []
        for stem_name in STEM_ORDER:
            if stem_name not in stems:
                continue
            stem_path = stems[stem_name]
            try:
                info = sf.info(str(stem_path))
                duration = info.frames / info.samplerate
            except Exception:
                duration = 0.0

            rel = stem_path.relative_to(pdir).as_posix()
            clip = Clip(
                id=str(uuid.uuid4()),
                file=rel,
                start=0.0,
                duration=duration,
                color=TRACK_COLORS[len(project.tracks) % len(TRACK_COLORS)],
            )
            track = proj_module.add_track(project, stem_name.title(), stem_type=stem_name)
            track.clips.append(clip)
            new_tracks.append(track.model_dump())

        proj_module.save_project(project)
        _emit_complete(job_id, {
            "tracks": new_tracks,
            "project": project.model_dump(),
        })

    except Exception as exc:
        _emit_error(job_id, str(exc))


# ── MusicGen generation ───────────────────────────────────────────────────────

@app.post("/generate/{project_id}")
async def generate(
    project_id: str,
    background_tasks: BackgroundTasks,
    style_prompt: str = Form(...),
    duration: float = Form(default=30.0),
    bpm: float = Form(default=120.0),
    key: str = Form(default=""),
) -> dict:
    project = proj_module.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    job_id = str(uuid.uuid4())
    background_tasks.add_task(
        _run_generate, job_id, project_id, style_prompt, duration, bpm, key
    )
    return {"job_id": job_id}


def _run_generate(
    job_id: str,
    project_id: str,
    style_prompt: str,
    duration: float,
    bpm: float,
    key: str,
) -> None:
    try:
        pdir = proj_module.get_project_dir(project_id)
        if pdir is None:
            _emit_error(job_id, "Project not found")
            return

        gen_dir = pdir / "generated" / job_id[:8]
        gen_dir.mkdir(parents=True, exist_ok=True)

        def cb(step, pct):
            _emit(job_id, step, pct)

        output_path = mg_pipeline.generate(
            style_prompt=style_prompt,
            duration_seconds=duration,
            bpm=bpm,
            key=key,
            output_dir=gen_dir,
            progress_cb=cb,
        )

        project = proj_module.load_project(project_id)
        if project is None:
            _emit_error(job_id, "Project not found after generation")
            return

        try:
            info = sf.info(str(output_path))
            actual_duration = info.frames / info.samplerate
        except Exception:
            actual_duration = duration

        rel = output_path.relative_to(pdir).as_posix()
        start = _next_clip_start(project)
        clip = Clip(
            id=str(uuid.uuid4()),
            file=rel,
            start=start,
            duration=actual_duration,
            color=TRACK_COLORS[len(project.tracks) % len(TRACK_COLORS)],
        )
        track = proj_module.add_track(project, f"AI: {style_prompt[:30]}", stem_type="other")
        track.clips.append(clip)
        proj_module.save_project(project)

        _emit_complete(job_id, {
            "track": track.model_dump(),
            "project": project.model_dump(),
        })

    except Exception as exc:
        _emit_error(job_id, str(exc))


# ── MIDI render ───────────────────────────────────────────────────────────────

@app.post("/render/{project_id}")
async def render_midi(
    project_id: str,
    background_tasks: BackgroundTasks,
    key: str = Form(default="C major"),
    bpm: float = Form(default=120.0),
    duration: float = Form(default=30.0),
) -> dict:
    project = proj_module.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    job_id = str(uuid.uuid4())
    background_tasks.add_task(_run_render_midi, job_id, project_id, key, bpm, duration)
    return {"job_id": job_id}


def _run_render_midi(
    job_id: str, project_id: str, key: str, bpm: float, duration: float
) -> None:
    from pipeline import midi_gen

    try:
        pdir = proj_module.get_project_dir(project_id)
        if pdir is None:
            _emit_error(job_id, "Project not found")
            return

        midi_dir = pdir / "midi" / job_id[:8]
        midi_dir.mkdir(parents=True, exist_ok=True)

        def cb(step, pct):
            _emit(job_id, step, pct)

        cb("Generating MIDI…", 0.10)
        midi_path = midi_gen.generate_midi(
            key=key, bpm=bpm, duration_seconds=duration, output_dir=midi_dir
        )

        if not SOUNDFONT_PATH.exists():
            _emit_error(
                job_id,
                f"Soundfont not found at {SOUNDFONT_PATH}. "
                "Download the Salamander Grand Piano SF2 and place it in studio/soundfonts/grand-piano.sf2",
            )
            return

        wav_path = midi_dir / "rendered.wav"
        midi_gen.render_midi(midi_path, SOUNDFONT_PATH, wav_path, progress_cb=cb)

        project = proj_module.load_project(project_id)
        if project is None:
            _emit_error(job_id, "Project not found")
            return

        try:
            info = sf.info(str(wav_path))
            actual_duration = info.frames / info.samplerate
        except Exception:
            actual_duration = duration

        rel = wav_path.relative_to(pdir).as_posix()
        clip = Clip(
            id=str(uuid.uuid4()),
            file=rel,
            start=_next_clip_start(project),
            duration=actual_duration,
            color=TRACK_COLORS[len(project.tracks) % len(TRACK_COLORS)],
        )
        track = proj_module.add_track(project, f"MIDI Piano ({key})", stem_type="piano")
        track.clips.append(clip)
        proj_module.save_project(project)

        _emit_complete(job_id, {"track": track.model_dump(), "project": project.model_dump()})

    except Exception as exc:
        _emit_error(job_id, str(exc))


# ── Effects ───────────────────────────────────────────────────────────────────

@app.post("/effects/{project_id}/{track_id}")
async def apply_effects(
    project_id: str,
    track_id: str,
    effects: EffectsChain,
    clip_id: str = Query(default=None),
) -> FileResponse:
    """Apply effects chain to a clip and return the processed WAV."""
    from pipeline.effects import apply_effects as _apply

    project = proj_module.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    track = next((t for t in project.tracks if t.id == track_id), None)
    if track is None:
        raise HTTPException(status_code=404, detail="Track not found")

    # Use first clip if clip_id not specified
    if clip_id:
        clip = next((c for c in track.clips if c.id == clip_id), None)
    else:
        clip = track.clips[0] if track.clips else None

    if clip is None:
        raise HTTPException(status_code=404, detail="Clip not found")

    src = proj_module.audio_path(project_id, track_id, clip.id)
    if src is None:
        raise HTTPException(status_code=404, detail="Audio file not found")

    pdir = proj_module.get_project_dir(project_id)
    fx_path = pdir / "fx" / f"{track_id[:8]}_{clip.id[:8]}_fx.wav"

    try:
        _apply(src, fx_path, effects)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    # Update the track's effects model and save
    track.effects = effects
    proj_module.save_project(project)

    return FileResponse(str(fx_path), media_type="audio/wav")


# ── Export / mixdown ──────────────────────────────────────────────────────────

@app.post("/export/{project_id}")
async def export(
    project_id: str,
    background_tasks: BackgroundTasks,
    format: str = Form(default="wav"),       # "wav" | "mp3" | "flac"
    mastering_style: str = Form(default="neutral"),
    include_stems: bool = Form(default=False),
) -> dict:
    project = proj_module.load_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")

    job_id = str(uuid.uuid4())
    background_tasks.add_task(
        _run_export, job_id, project_id, format, mastering_style, include_stems
    )
    return {"job_id": job_id}


def _run_export(
    job_id: str,
    project_id: str,
    fmt: str,
    mastering_style: str,
    include_stems: bool,
) -> None:
    from pipeline.effects import apply_effects as _apply_fx
    from pipeline.mastering import master as _master
    import numpy as np

    try:
        project = proj_module.load_project(project_id)
        pdir = proj_module.get_project_dir(project_id)
        if project is None or pdir is None:
            _emit_error(job_id, "Project not found")
            return

        _emit(job_id, "Starting export…", 0.02)

        # ── Collect all clips and find total duration ───────────────────────
        total_duration = 0.0
        for track in project.tracks:
            for clip in track.clips:
                total_duration = max(total_duration, clip.start + clip.duration)

        if total_duration <= 0:
            _emit_error(job_id, "No audio content to export")
            return

        SR = project.sample_rate
        n_samples = int(total_duration * SR) + SR  # +1s headroom
        mix_buf = np.zeros((n_samples, 2), dtype="float32")

        active_tracks = [t for t in project.tracks if not t.muted]
        soloed = [t for t in active_tracks if t.solo]
        render_tracks = soloed if soloed else active_tracks

        for ti, track in enumerate(render_tracks):
            prog = 0.05 + 0.60 * (ti / max(len(render_tracks), 1))
            _emit(job_id, f"Rendering track: {track.name}…", prog)

            for clip in track.clips:
                src = proj_module.audio_path(project_id, track.id, clip.id)
                if src is None or not src.exists():
                    continue

                # Apply effects chain
                fx_tmp = TMP_ROOT / f"{job_id}_{track.id[:8]}_{clip.id[:8]}.wav"
                try:
                    _apply_fx(src, fx_tmp, track.effects)
                    audio, sr = sf.read(str(fx_tmp), dtype="float32", always_2d=True)
                except Exception:
                    try:
                        audio, sr = sf.read(str(src), dtype="float32", always_2d=True)
                    except Exception:
                        continue

                if sr != SR:
                    import librosa
                    audio_mono = librosa.resample(audio.T, orig_sr=sr, target_sr=SR).T
                    audio = audio_mono

                # Ensure stereo
                if audio.ndim == 1:
                    audio = np.stack([audio, audio], axis=1)
                elif audio.shape[1] == 1:
                    audio = np.concatenate([audio, audio], axis=1)

                # Apply offset/trim
                if clip.offset > 0:
                    skip = int(clip.offset * SR)
                    audio = audio[skip:]

                # Trim to clip duration
                clip_samples = int(clip.duration * SR)
                audio = audio[:clip_samples]

                # Apply volume and pan
                gain = track.volume
                pan = max(-1.0, min(1.0, track.pan))
                left_gain = gain * (1.0 - max(0.0, pan))
                right_gain = gain * (1.0 + min(0.0, pan))
                audio[:, 0] *= left_gain
                audio[:, 1] *= right_gain

                # Write into mix buffer
                start_sample = int(clip.start * SR)
                end_sample = start_sample + len(audio)
                end_sample = min(end_sample, n_samples)
                actual_len = end_sample - start_sample
                mix_buf[start_sample:end_sample] += audio[:actual_len]

        _emit(job_id, "Mixing down…", 0.70)

        # Peak-normalize pre-master
        peak = np.abs(mix_buf).max()
        if peak > 1.0:
            mix_buf = mix_buf / peak * 0.95

        # Write raw mix
        mix_path = TMP_ROOT / f"{job_id}_mix.wav"
        sf.write(str(mix_path), mix_buf, samplerate=SR)

        _emit(job_id, "Mastering…", 0.80)

        # Export dir
        export_dir = Path.home() / "Music" / "Studio Exports"
        export_dir.mkdir(parents=True, exist_ok=True)
        safe_name = "".join(c for c in project.name if c.isalnum() or c in " _-")
        master_wav = export_dir / f"{safe_name}_{job_id[:8]}_master.wav"

        _master(mix_path, master_wav, style=mastering_style)

        _emit(job_id, "Encoding output…", 0.90)

        final_path = master_wav
        if fmt == "mp3":
            from pydub import AudioSegment
            mp3_path = master_wav.with_suffix(".mp3")
            AudioSegment.from_wav(str(master_wav)).export(str(mp3_path), format="mp3", bitrate="320k")
            final_path = mp3_path
        elif fmt == "flac":
            flac_path = master_wav.with_suffix(".flac")
            sf.write(str(flac_path), *sf.read(str(master_wav), dtype="float32", always_2d=True), subtype="PCM_24")
            final_path = flac_path

        _emit(job_id, "Export complete.", 1.0)
        _emit_complete(job_id, {
            "download_url": f"/export/{project_id}/download/{job_id}",
            "filename": final_path.name,
        })

        # Store path for download
        _export_cache[job_id] = final_path

    except Exception as exc:
        _emit_error(job_id, str(exc))


_export_cache: dict[str, Path] = {}


@app.get("/export/{project_id}/download/{job_id}")
def download_export(project_id: str, job_id: str) -> FileResponse:
    path = _export_cache.get(job_id)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Export not found or expired")
    suffix = path.suffix.lstrip(".")
    media_types = {"wav": "audio/wav", "mp3": "audio/mpeg", "flac": "audio/flac"}
    return FileResponse(str(path), media_type=media_types.get(suffix, "audio/wav"), filename=path.name)


# ── Startup cleanup ───────────────────────────────────────────────────────────

@app.on_event("startup")
def startup() -> None:
    """Clean temp files from previous runs."""
    if TMP_ROOT.exists():
        for f in TMP_ROOT.iterdir():
            try:
                if f.is_file():
                    f.unlink()
            except Exception:
                pass
