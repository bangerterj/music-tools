"""Audio processing pipeline — grows phase by phase (3-6)."""

from pathlib import Path

import numpy as np
import soundfile as sf
import torch


def separate_stems(input_path: Path, output_dir: Path) -> dict[str, Path]:
    """Run Demucs on input_path and return paths to the four separated stems.

    Uses the htdemucs model (best quality / speed trade-off for CPU).
    Loads/saves audio with soundfile so we don't depend on torchaudio.save,
    which requires torchcodec on newer builds.

    Returns dict with keys: drums, bass, other, vocals.
    Raises RuntimeError on any failure.
    """
    # Import here so startup is fast when demucs isn't needed yet
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Load audio with soundfile → float32 tensor (channels, samples) ────────
    try:
        audio_np, sample_rate = sf.read(str(input_path), dtype="float32", always_2d=True)
    except Exception as exc:
        raise RuntimeError(f"Could not read input audio: {exc}") from exc

    # soundfile gives (samples, channels); demucs wants (channels, samples)
    audio_np = audio_np.T

    # Demucs expects stereo — duplicate mono to stereo if needed
    if audio_np.shape[0] == 1:
        audio_np = np.concatenate([audio_np, audio_np], axis=0)
    elif audio_np.shape[0] > 2:
        audio_np = audio_np[:2]  # keep first two channels

    # Add batch dimension → (1, 2, samples)
    wav = torch.from_numpy(audio_np).unsqueeze(0)

    # ── Load model and run separation ─────────────────────────────────────────
    try:
        model = get_model("htdemucs")
        model.eval()
    except Exception as exc:
        raise RuntimeError(f"Could not load Demucs model: {exc}") from exc

    # Resample if the file's sample rate differs from what the model expects
    if sample_rate != model.samplerate:
        import torchaudio.functional as F_audio
        wav = F_audio.resample(wav, sample_rate, model.samplerate)
        sample_rate = model.samplerate

    try:
        with torch.no_grad():
            sources = apply_model(model, wav, device="cpu", progress=False)
    except Exception as exc:
        raise RuntimeError(f"Demucs inference failed: {exc}") from exc

    # sources: (batch=1, n_sources, channels=2, samples)
    # model.sources: ['drums', 'bass', 'other', 'vocals']

    # ── Save each stem with soundfile ─────────────────────────────────────────
    stems: dict[str, Path] = {}
    for i, stem_name in enumerate(model.sources):
        stem_audio = sources[0, i].cpu().numpy()  # (2, samples)
        stem_audio = stem_audio.T                 # (samples, 2) for soundfile

        stem_path = output_dir / f"{stem_name}.wav"
        try:
            sf.write(str(stem_path), stem_audio, samplerate=sample_rate)
        except Exception as exc:
            raise RuntimeError(f"Could not write stem {stem_name}: {exc}") from exc

        stems[stem_name] = stem_path

    return stems


def extract_midi(input_path: Path, output_dir: Path) -> dict:
    """Run Basic Pitch on input_path and extract musical context.

    Returns dict with keys: tempo (float), key (str), midi_path (Path).
    Raises RuntimeError if basic-pitch fails.
    """
    raise NotImplementedError("Phase 4")


def generate_stems(style_prompt: str, bpm: int, musical_context: dict) -> Path:
    """Call Replicate / MusicGen and return path to downloaded generated audio.

    Polls until complete or times out at 120 seconds.
    Raises RuntimeError on API error or timeout.
    """
    raise NotImplementedError("Phase 5")


def mix_audio(original_path: Path, generated_path: Path, output_path: Path) -> Path:
    """Blend original recording with generated audio and write WAV to output_path.

    Returns output_path on success.
    Raises RuntimeError if mixing fails.
    """
    raise NotImplementedError("Phase 6")
