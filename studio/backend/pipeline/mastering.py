"""AI mastering via Matchering.

Matchering matches the loudness, spectrum, and stereo image of a mix
to a provided reference track. We bundle a few reference tracks with
the app — the user picks one style or skips mastering entirely.
"""

from __future__ import annotations

from pathlib import Path


REFERENCE_STYLES = {
    "neutral":   "references/neutral.wav",
    "warm":      "references/warm.wav",
    "modern_pop":"references/modern_pop.wav",
    "cinematic": "references/cinematic.wav",
}

# Resolved relative to this file's location
_REF_DIR = Path(__file__).parent.parent.parent / "references"


def master(
    mix_path: Path,
    output_path: Path,
    style: str = "neutral",
    progress_cb=None,
) -> Path:
    """Run Matchering on mix_path and write the mastered output.

    Falls back to a simple loudness normalization if Matchering or the
    reference track is unavailable, so the export always succeeds.

    Returns output_path.
    """
    if progress_cb:
        progress_cb("Preparing mastering…", 0.05)

    ref_rel = REFERENCE_STYLES.get(style, REFERENCE_STYLES["neutral"])
    ref_path = _REF_DIR / Path(ref_rel).name

    if not ref_path.exists():
        # No reference available — fall through to normalize-only path
        return _normalize_only(mix_path, output_path, progress_cb)

    try:
        import matchering as mg

        if progress_cb:
            progress_cb("Running AI mastering…", 0.20)

        output_path.parent.mkdir(parents=True, exist_ok=True)
        mg.process(
            target=str(mix_path),
            reference=str(ref_path),
            results=[mg.pcm24(str(output_path))],
        )

        if progress_cb:
            progress_cb("Mastering complete.", 1.0)

        return output_path

    except Exception:
        # Matchering failed (library not installed, mismatch, etc.) — normalize
        return _normalize_only(mix_path, output_path, progress_cb)


def _normalize_only(mix_path: Path, output_path: Path, progress_cb=None) -> Path:
    """Peak-normalize and write to output_path without Matchering."""
    import numpy as np
    import soundfile as sf

    if progress_cb:
        progress_cb("Normalizing (no reference available)…", 0.50)

    audio, sr = sf.read(str(mix_path), dtype="float32", always_2d=True)
    peak = np.abs(audio).max()
    if peak > 0:
        audio = audio / peak * 0.95  # leave −0.4 dBFS headroom

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), audio, samplerate=sr, subtype="PCM_24")

    if progress_cb:
        progress_cb("Normalization complete.", 1.0)

    return output_path
