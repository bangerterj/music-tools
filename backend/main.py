"""FastAPI app — music augmentation tool."""

import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

import pipeline

load_dotenv()

app = FastAPI(title="Music Augmentation Tool")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # localhost-only dev tool, open is fine
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory job store: job_id → {"status": str, "step": str, "output_path": str|None}
jobs: dict[str, dict] = {}

TMP = Path("/tmp/music-tool")
TMP.mkdir(parents=True, exist_ok=True)


# ── Pipeline runner (called in background) ────────────────────────────────────

def run_pipeline(job_id: str, input_path: Path, bpm: int, style_prompt: str) -> None:
    """Run the full processing chain for a job, updating job state as we go.

    Each phase updates jobs[job_id] so the frontend can poll /status and show
    the current step. Any unhandled exception marks the job as failed.
    """
    job_dir = input_path.parent

    def update(step: str) -> None:
        jobs[job_id]["step"] = step

    def fail(reason: str) -> None:
        jobs[job_id]["status"] = "error"
        jobs[job_id]["step"] = reason

    try:
        jobs[job_id]["status"] = "processing"

        # ── Phase 3: Stem separation ──────────────────────────────────────────
        update("Separating stems…")
        stems = pipeline.separate_stems(input_path, job_dir / "stems")

        # ── Phase 4: MIDI extraction (stub) ───────────────────────────────────
        update("Analysing pitch and tempo…")
        musical_context = pipeline.extract_midi(stems["other"], job_dir / "midi")

        # ── Phase 5: MusicGen generation (stub) ───────────────────────────────
        update("Generating AI stems…")
        generated_path = pipeline.generate_stems(style_prompt, bpm, musical_context)

        # ── Phase 6: Mix down (stub) ───────────────────────────────────────────
        update("Mixing…")
        output_path = pipeline.mix_audio(
            input_path, generated_path, job_dir / "output.wav"
        )

        jobs[job_id]["status"] = "complete"
        jobs[job_id]["step"] = "Done"
        jobs[job_id]["output_path"] = str(output_path)

    except NotImplementedError:
        # Expected during development — pipeline is partially implemented.
        # Record how far we got so tests can verify completed phases.
        update(f"{jobs[job_id]['step'].rstrip('…')} complete (pipeline continues in a later phase)")
        # Leave status as "processing" so the frontend keeps polling.

    except Exception as exc:
        fail(str(exc))


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Confirm the server is running."""
    return {"status": "ok"}


@app.post("/generate")
async def generate(
    background_tasks: BackgroundTasks,
    audio: UploadFile = File(...),
    bpm: int = Form(...),
    style_prompt: str = Form(...),
):
    """Accept an audio recording, save it, and kick off the pipeline in the background."""
    job_id = str(uuid.uuid4())
    job_dir = TMP / job_id
    job_dir.mkdir(parents=True)

    # Save uploaded file
    suffix = Path(audio.filename).suffix or ".wav"
    input_path = job_dir / f"input{suffix}"
    with open(input_path, "wb") as f:
        f.write(await audio.read())

    jobs[job_id] = {"status": "pending", "step": "Queued", "output_path": None}

    # Run pipeline without blocking the response
    background_tasks.add_task(run_pipeline, job_id, input_path, bpm, style_prompt)

    return {"job_id": job_id}


@app.get("/status/{job_id}")
def status(job_id: str):
    """Return the current state of a generation job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]


@app.get("/download/{job_id}")
def download(job_id: str):
    """Serve the final mixed WAV for a completed job."""
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    job = jobs[job_id]
    if job["status"] != "complete" or not job["output_path"]:
        raise HTTPException(status_code=409, detail="Job not complete yet")
    output_path = Path(job["output_path"])
    if not output_path.exists():
        raise HTTPException(status_code=404, detail="Output file missing")
    return FileResponse(output_path, media_type="audio/wav", filename="augmented.wav")
