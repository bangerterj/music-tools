"""Per-track effects chain using Pedalboard (Spotify).

Applies EQ → Compression → Reverb → Delay in that order,
respecting the enabled flags on the EffectsChain model.
"""

from __future__ import annotations

from pathlib import Path

import soundfile as sf


def apply_effects(
    input_path: Path,
    output_path: Path,
    effects_chain,  # models.EffectsChain
) -> Path:
    """Apply the effects chain to input_path and write to output_path.

    Returns output_path. Raises RuntimeError on failure.
    """
    try:
        import pedalboard
        from pedalboard import (
            Pedalboard,
            HighpassFilter,
            LowpassFilter,
            PeakFilter,
            LowShelfFilter,
            HighShelfFilter,
            Compressor,
            Reverb,
            Delay,
        )
    except ImportError as exc:
        raise RuntimeError("pedalboard not installed — run: pip install pedalboard") from exc

    try:
        audio, sr = sf.read(str(input_path), dtype="float32", always_2d=True)
    except Exception as exc:
        raise RuntimeError(f"Could not read audio: {exc}") from exc

    # audio is (samples, channels) — pedalboard expects (channels, samples)
    audio_cb = audio.T

    plugins = []

    if effects_chain.eq_enabled and effects_chain.eq.bands:
        for band in effects_chain.eq.bands:
            btype = band.type
            if btype == "highpass":
                plugins.append(HighpassFilter(cutoff_frequency_hz=band.freq))
            elif btype == "lowpass":
                plugins.append(LowpassFilter(cutoff_frequency_hz=band.freq))
            elif btype == "lowshelf":
                plugins.append(LowShelfFilter(cutoff_frequency_hz=band.freq, gain_db=band.gain))
            elif btype == "highshelf":
                plugins.append(HighShelfFilter(cutoff_frequency_hz=band.freq, gain_db=band.gain))
            else:  # peak
                plugins.append(PeakFilter(cutoff_frequency_hz=band.freq, gain_db=band.gain, q=band.q))

    if effects_chain.compression_enabled:
        c = effects_chain.compression
        plugins.append(Compressor(
            threshold_db=c.threshold,
            ratio=c.ratio,
            attack_ms=c.attack_ms,
            release_ms=c.release_ms,
        ))
        if c.makeup_gain != 0.0:
            from pedalboard import Gain
            plugins.append(Gain(gain_db=c.makeup_gain))

    if effects_chain.reverb_enabled:
        r = effects_chain.reverb
        plugins.append(Reverb(
            room_size=r.room_size,
            wet_level=r.wet_dry,
            dry_level=1.0 - r.wet_dry,
            damping=r.damping,
        ))

    if effects_chain.delay_enabled:
        d = effects_chain.delay
        plugins.append(Delay(
            delay_seconds=d.time_ms / 1000.0,
            feedback=d.feedback,
            mix=d.wet_dry,
        ))

    if not plugins:
        # Nothing to apply — just copy
        output_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(output_path), audio, samplerate=sr)
        return output_path

    board = Pedalboard(plugins)
    try:
        processed = board(audio_cb, sr)  # (channels, samples)
    except Exception as exc:
        raise RuntimeError(f"Pedalboard processing failed: {exc}") from exc

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), processed.T, samplerate=sr)
    return output_path
