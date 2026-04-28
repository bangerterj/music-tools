"""Stem separation using Demucs (htdemucs model).

Adapted from the working implementation in music-tools/backend/pipeline.py.
Key decisions preserved:
  - soundfile for audio I/O (avoids torchaudio.save dependency on newer builds)
  - mono → stereo duplication before Demucs (requires 2-channel input)
  - resampling via torchaudio.functional if file SR differs from model SR
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf
import torch


def separate_stems(
    input_path: Path,
    output_dir: Path,
    progress_cb=None,
) -> dict[str, Path]:
    """Run htdemucs on input_path and return paths to the separated stems.

    progress_cb(step: str, pct: float) is called during processing if provided.
    Returns dict with keys: drums, bass, other, vocals.
    Raises RuntimeError on failure.
    """
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    output_dir.mkdir(parents=True, exist_ok=True)

    if progress_cb:
        progress_cb("Loading audio…", 0.05)

    try:
        audio_np, sample_rate = sf.read(str(input_path), dtype="float32", always_2d=True)
    except Exception as exc:
        raise RuntimeError(f"Could not read input audio: {exc}") from exc

    # soundfile gives (samples, channels); demucs wants (channels, samples)
    audio_np = audio_np.T

    # Demucs requires stereo input
    if audio_np.shape[0] == 1:
        audio_np = np.concatenate([audio_np, audio_np], axis=0)
    elif audio_np.shape[0] > 2:
        audio_np = audio_np[:2]

    wav = torch.from_numpy(audio_np).unsqueeze(0)  # (1, 2, samples)

    if progress_cb:
        progress_cb("Loading Demucs model…", 0.10)

    try:
        model = get_model("htdemucs")
        model.eval()
    except Exception as exc:
        raise RuntimeError(f"Could not load Demucs model: {exc}") from exc

    if sample_rate != model.samplerate:
        import torchaudio.functional as F_audio
        wav = F_audio.resample(wav, sample_rate, model.samplerate)
        sample_rate = model.samplerate

    if progress_cb:
        progress_cb("Separating stems (this takes a moment)…", 0.20)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    try:
        with torch.no_grad():
            sources = apply_model(model, wav, device=device, progress=False)
    except Exception as exc:
        raise RuntimeError(f"Demucs inference failed: {exc}") from exc

    # sources: (batch=1, n_sources, 2, samples)
    stems: dict[str, Path] = {}
    for i, stem_name in enumerate(model.sources):
        if progress_cb:
            progress_cb(f"Saving {stem_name} stem…", 0.75 + i * 0.05)

        stem_audio = sources[0, i].cpu().numpy()  # (2, samples)
        stem_audio = stem_audio.T                  # (samples, 2) for soundfile

        stem_path = output_dir / f"{stem_name}.wav"
        try:
            sf.write(str(stem_path), stem_audio, samplerate=sample_rate)
        except Exception as exc:
            raise RuntimeError(f"Could not write stem {stem_name}: {exc}") from exc

        stems[stem_name] = stem_path

    if progress_cb:
        progress_cb("Stems separated.", 1.0)

    return stems
