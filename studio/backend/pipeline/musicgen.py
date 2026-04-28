"""AI music generation via self-hosted MusicGen (audiocraft / HuggingFace).

GPU selection logic:
  - CUDA + VRAM >= 8 GB  →  facebook/musicgen-stereo-medium
  - CUDA + VRAM <  8 GB  →  facebook/musicgen-stereo-small
  - CPU only             →  facebook/musicgen-small  (warns about wait time)

Model weights are cached once in ~/.cache/huggingface and reused on every run.
The module-level cache (_processor, _model) means the model is loaded once per
server process.

Adapted from the working implementation in music-tools/backend/pipeline.py.
"""

from __future__ import annotations

import os
from pathlib import Path

import soundfile as sf
import torch

_processor = None
_model = None
_loaded_model_id: str | None = None


def _select_model() -> tuple[str, bool]:
    """Return (model_id, cpu_only) based on available hardware."""
    if torch.cuda.is_available():
        try:
            vram_bytes = torch.cuda.get_device_properties(0).total_memory
            vram_gb = vram_bytes / (1024 ** 3)
        except Exception:
            vram_gb = 0.0

        if vram_gb >= 8.0:
            return "facebook/musicgen-stereo-medium", False
        else:
            return "facebook/musicgen-stereo-small", False
    return "facebook/musicgen-small", True


def gpu_info() -> dict:
    """Return GPU availability and selected model ID."""
    model_id, cpu_only = _select_model()
    return {
        "gpu": torch.cuda.is_available(),
        "model": model_id,
        "cpu_only": cpu_only,
    }


def generate(
    style_prompt: str,
    duration_seconds: float,
    bpm: float = 120.0,
    key: str = "",
    output_path: Path | None = None,
    output_dir: Path | None = None,
    progress_cb=None,
) -> Path:
    """Generate audio from a text prompt and return the path to the WAV file.

    duration_seconds: target length (MusicGen's token budget is adjusted accordingly).
    Raises RuntimeError on any failure.
    """
    global _processor, _model, _loaded_model_id

    from transformers import AutoProcessor, MusicgenForConditionalGeneration

    model_id, cpu_only = _select_model()

    if cpu_only:
        # Surface a warning but continue — generation just takes longer
        import warnings
        warnings.warn(
            "No GPU detected. MusicGen will run on CPU — expect 10–20 minutes for 30s of audio.",
            RuntimeWarning,
            stacklevel=2,
        )

    if output_path is None:
        if output_dir is None:
            raise ValueError("Provide either output_path or output_dir")
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "generated.wav"

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Enrich the prompt with detected tempo/key
    parts = [style_prompt, f"{round(bpm)} bpm"]
    if key:
        parts.append(key)
    enriched = ", ".join(parts)

    if progress_cb:
        progress_cb(f"Loading MusicGen ({model_id})…", 0.05)

    if _model is None or _loaded_model_id != model_id:
        try:
            _processor = AutoProcessor.from_pretrained(model_id)
            _model = MusicgenForConditionalGeneration.from_pretrained(model_id)
            device = "cuda" if torch.cuda.is_available() else "cpu"
            _model.to(device)
            _model.eval()
            _loaded_model_id = model_id
        except Exception as exc:
            raise RuntimeError(f"Could not load MusicGen model ({model_id}): {exc}") from exc

    device = next(_model.parameters()).device
    inputs = _processor(text=[enriched], padding=True, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    # ~50 tokens/sec at 32 kHz; 15s ≈ 750, 30s ≈ 1500, 60s ≈ 3000
    max_new_tokens = max(256, int(duration_seconds * 50))

    if progress_cb:
        progress_cb("Generating music (this may take a while)…", 0.15)

    try:
        with torch.no_grad():
            audio_values = _model.generate(**inputs, max_new_tokens=max_new_tokens)
    except Exception as exc:
        raise RuntimeError(f"MusicGen inference failed: {exc}") from exc

    sample_rate = _model.config.audio_encoder.sampling_rate
    # audio_values: (batch, channels, samples)
    audio_np = audio_values[0].cpu().numpy().astype("float32")
    audio_np = audio_np.T  # (samples, channels) for soundfile

    if progress_cb:
        progress_cb("Saving generated audio…", 0.95)

    try:
        sf.write(str(output_path), audio_np, samplerate=sample_rate)
    except Exception as exc:
        raise RuntimeError(f"Could not write generated audio: {exc}") from exc

    if progress_cb:
        progress_cb("Generation complete.", 1.0)

    return output_path
