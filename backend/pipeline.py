"""Audio processing pipeline — stubs for Phase 1, filled in across Phases 3-6."""

from pathlib import Path


def separate_stems(input_path: Path, output_dir: Path) -> dict[str, Path]:
    """Run Demucs on input_path and return paths to separated stems.

    Returns dict with keys: drums, bass, other, vocals.
    Raises RuntimeError if demucs fails.
    """
    raise NotImplementedError("Phase 3")


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
