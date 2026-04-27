"""FastAPI app — music augmentation tool."""

import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
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


@app.get("/health")
def health():
    """Confirm the server is running."""
    return {"status": "ok"}


@app.post("/generate")
async def generate(
    audio: UploadFile = File(...),
    bpm: int = Form(...),
    style_prompt: str = Form(...),
):
    """Accept an audio recording and kick off the generation pipeline."""
    job_id = str(uuid.uuid4())
    job_dir = TMP / job_id
    job_dir.mkdir(parents=True)

    # Save uploaded file
    suffix = Path(audio.filename).suffix or ".wav"
    input_path = job_dir / f"input{suffix}"
    with open(input_path, "wb") as f:
        f.write(await audio.read())

    jobs[job_id] = {"status": "pending", "step": "Queued", "output_path": None}

    # Pipeline will be wired in Phase 3+
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
