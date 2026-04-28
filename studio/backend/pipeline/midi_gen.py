"""MIDI generation and audio rendering.

Workflow:
  1. extract_midi()  — Basic Pitch: audio → MIDI, returns tempo/key metadata
  2. generate_midi() — pretty_midi: algorithmic MIDI from key/tempo/style
  3. render_midi()   — FluidSynth: MIDI + soundfont → WAV

Adapted from music-tools/backend/pipeline.py (extract_midi, _estimate_key).
"""

from __future__ import annotations

import warnings
from pathlib import Path

import numpy as np


# ── Step 1: Audio → MIDI via Basic Pitch ─────────────────────────────────────

def extract_midi(input_path: Path, output_dir: Path) -> dict:
    """Run Basic Pitch on input_path and extract musical context.

    Returns dict: tempo (float), key (str), midi_path (Path), note_count (int).
    Raises RuntimeError on failure.
    """
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict

    output_dir.mkdir(parents=True, exist_ok=True)

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            _model_output, midi_data, _note_events = predict(
                str(input_path),
                ICASSP_2022_MODEL_PATH,
            )
    except Exception as exc:
        raise RuntimeError(f"Basic Pitch inference failed: {exc}") from exc

    midi_path = output_dir / "notes.mid"
    try:
        midi_data.write(str(midi_path))
    except Exception as exc:
        raise RuntimeError(f"Could not write MIDI file: {exc}") from exc

    try:
        tempo = float(midi_data.estimate_tempo())
    except Exception:
        tempo = 120.0

    try:
        key = _estimate_key(midi_data)
    except Exception:
        key = "C major"

    note_count = sum(len(inst.notes) for inst in midi_data.instruments)

    return {
        "tempo": round(tempo, 1),
        "key": key,
        "midi_path": midi_path,
        "note_count": note_count,
    }


def _estimate_key(midi_data) -> str:
    """Krumhansl-Schmuckler key estimation from a PrettyMIDI object."""
    histogram = np.zeros(12)
    for instrument in midi_data.instruments:
        if instrument.is_drum:
            continue
        for note in instrument.notes:
            histogram[note.pitch % 12] += note.end - note.start

    if histogram.sum() == 0:
        return "C major"

    histogram = histogram / histogram.sum()

    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                               2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                               2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
    note_names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

    best_score, best_key = -1.0, "C major"
    for root in range(12):
        rotated = np.roll(histogram, -root)
        major_score = float(np.corrcoef(rotated, major_profile)[0, 1])
        minor_score = float(np.corrcoef(rotated, minor_profile)[0, 1])
        if major_score > best_score:
            best_score, best_key = major_score, f"{note_names[root]} major"
        if minor_score > best_score:
            best_score, best_key = minor_score, f"{note_names[root]} minor"

    return best_key


# ── Step 2: Algorithmic MIDI generation ──────────────────────────────────────

_KEY_SCALES = {
    "major": [0, 2, 4, 5, 7, 9, 11],
    "minor": [0, 2, 3, 5, 7, 8, 10],
}

_NOTE_NAMES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5,
               "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def generate_midi(
    key: str,
    bpm: float,
    duration_seconds: float,
    instrument_program: int = 0,  # 0 = Grand Piano
    output_path: Path | None = None,
    output_dir: Path | None = None,
) -> Path:
    """Generate a simple algorithmic MIDI file and return its path.

    Produces a chord progression in the given key using basic voice leading.
    """
    import pretty_midi

    if output_path is None:
        if output_dir is None:
            raise ValueError("Provide either output_path or output_dir")
        Path(output_dir).mkdir(parents=True, exist_ok=True)
        output_path = Path(output_dir) / "generated.mid"

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Parse key string, e.g. "A minor" or "C major"
    parts = key.lower().split()
    root_name = parts[0].title() if parts else "C"
    mode = "minor" if len(parts) > 1 and "minor" in parts[1] else "major"
    root_pc = _NOTE_NAMES.get(root_name, 0)
    scale = [root_pc + interval for interval in _KEY_SCALES[mode]]

    pm = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    inst = pretty_midi.Instrument(program=instrument_program, name="Piano")

    beat_duration = 60.0 / bpm
    bars = max(4, int(duration_seconds / (beat_duration * 4)))

    # Simple I–V–vi–IV chord progression
    if mode == "major":
        progression_degrees = [0, 4, 5, 3]  # I V vi IV
        chord_types = ["major", "major", "minor", "major"]
    else:
        progression_degrees = [0, 3, 6, 4]  # i III VII v
        chord_types = ["minor", "major", "major", "minor"]

    CHORD_INTERVALS = {"major": [0, 4, 7], "minor": [0, 3, 7]}

    t = 0.0
    for bar in range(bars):
        degree_idx = bar % len(progression_degrees)
        root_note = scale[progression_degrees[degree_idx] % len(scale)] + 48
        intervals = CHORD_INTERVALS[chord_types[degree_idx]]

        chord_dur = beat_duration * 4  # one bar per chord
        for interval in intervals:
            note = pretty_midi.Note(
                velocity=70,
                pitch=root_note + interval,
                start=t,
                end=t + chord_dur - 0.05,
            )
            inst.notes.append(note)

        # Add a simple bass note
        bass_note = pretty_midi.Note(
            velocity=80,
            pitch=root_note - 12,
            start=t,
            end=t + beat_duration - 0.05,
        )
        inst.notes.append(bass_note)

        t += chord_dur

    pm.instruments.append(inst)
    pm.write(str(output_path))
    return output_path


# ── Step 3: MIDI → audio via FluidSynth ──────────────────────────────────────

def render_midi(
    midi_path: Path,
    soundfont_path: Path,
    output_path: Path,
    sample_rate: int = 44100,
    progress_cb=None,
) -> Path:
    """Render a MIDI file to WAV using FluidSynth.

    Raises RuntimeError if pyfluidsynth or the fluidsynth binary are missing.
    """
    import shutil

    if not shutil.which("fluidsynth"):
        raise RuntimeError(
            "fluidsynth binary not found. Install it with:\n"
            "  macOS: brew install fluid-synth\n"
            "  Ubuntu: sudo apt install fluidsynth\n"
        )

    try:
        import fluidsynth
    except ImportError as exc:
        raise RuntimeError("pyfluidsynth not installed — run: pip install pyfluidsynth") from exc

    if not soundfont_path.exists():
        raise RuntimeError(
            f"Soundfont not found at {soundfont_path}. "
            "Download the Salamander Grand Piano SF2 and place it in studio/soundfonts/."
        )

    if progress_cb:
        progress_cb("Rendering MIDI to audio…", 0.10)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        fs = fluidsynth.Synth(samplerate=float(sample_rate))
        sfid = fs.sfload(str(soundfont_path))
        fs.program_select(0, sfid, 0, 0)

        # Use midi_to_audio helper from pretty_midi — simpler than driving
        # FluidSynth manually
        import pretty_midi
        pm = pretty_midi.PrettyMIDI(str(midi_path))
        audio = pm.fluidsynth(fs=float(sample_rate), sf2_path=str(soundfont_path))

        import soundfile as sf
        sf.write(str(output_path), audio, samplerate=sample_rate)
    except Exception as exc:
        raise RuntimeError(f"FluidSynth rendering failed: {exc}") from exc

    if progress_cb:
        progress_cb("MIDI render complete.", 1.0)

    return output_path
