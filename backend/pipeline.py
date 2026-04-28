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

    Returns dict with keys: tempo (float), key (str), midi_path (Path),
    note_count (int).
    Raises RuntimeError if basic-pitch fails.
    """
    import warnings

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

    # Save the MIDI file for downstream use
    midi_path = output_dir / "notes.mid"
    try:
        midi_data.write(str(midi_path))
    except Exception as exc:
        raise RuntimeError(f"Could not write MIDI file: {exc}") from exc

    # Extract tempo — estimate_tempo() returns a single float (bpm)
    try:
        tempo = float(midi_data.estimate_tempo())
    except Exception:
        tempo = 120.0  # safe fallback

    # Derive a key label from the chroma of the first instrument's notes
    try:
        key = _estimate_key(midi_data)
    except Exception:
        key = "C major"  # safe fallback

    note_count = sum(len(inst.notes) for inst in midi_data.instruments)

    return {
        "tempo": round(tempo, 1),
        "key": key,
        "midi_path": midi_path,
        "note_count": note_count,
    }


def _estimate_key(midi_data) -> str:
    """Return a rough key label (e.g. 'A minor') from a PrettyMIDI object.

    Uses a simple pitch-class histogram compared to Krumhansl-Schmuckler
    key profiles — good enough to seed a MusicGen style prompt.
    """
    import numpy as np

    # Build a pitch-class histogram across all instruments
    histogram = np.zeros(12)
    for instrument in midi_data.instruments:
        if instrument.is_drum:
            continue
        for note in instrument.notes:
            histogram[note.pitch % 12] += note.end - note.start  # weight by duration

    if histogram.sum() == 0:
        return "C major"

    histogram = histogram / histogram.sum()

    # Krumhansl-Schmuckler profiles (major then minor)
    major_profile = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                               2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
    minor_profile = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                               2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

    note_names = ["C", "C#", "D", "D#", "E", "F",
                  "F#", "G", "G#", "A", "A#", "B"]

    best_score = -1.0
    best_key = "C major"
    for root in range(12):
        rotated = np.roll(histogram, -root)
        major_score = float(np.corrcoef(rotated, major_profile)[0, 1])
        minor_score = float(np.corrcoef(rotated, minor_profile)[0, 1])
        if major_score > best_score:
            best_score = major_score
            best_key = f"{note_names[root]} major"
        if minor_score > best_score:
            best_score = minor_score
            best_key = f"{note_names[root]} minor"

    return best_key


def generate_stems(
    style_prompt: str,
    bpm: int,
    musical_context: dict,
    output_dir: Path,
) -> Path:
    """Run MusicGen locally via HuggingFace transformers and return path to WAV.

    Uses facebook/musicgen-stereo-small — fast enough on CPU (~3-5 min for 15s).
    Model weights (~1 GB) are downloaded once and cached in ~/.cache/huggingface.
    Raises RuntimeError on any failure.
    """
    import torch
    from transformers import AutoProcessor, MusicgenForConditionalGeneration

    output_dir.mkdir(parents=True, exist_ok=True)

    # Build an enriched prompt from style + detected tempo + key
    detected_tempo = musical_context.get("tempo", bpm)
    key = musical_context.get("key", "")
    prompt_parts = [style_prompt, f"{round(detected_tempo)} bpm"]
    if key:
        prompt_parts.append(key)
    enriched_prompt = ", ".join(prompt_parts)

    # stereo-small is the best CPU trade-off: good quality, ~3-5 min for 15s.
    # Swap to "facebook/musicgen-stereo-medium" for better quality (much slower).
    MODEL_ID = "facebook/musicgen-stereo-small"

    try:
        processor = AutoProcessor.from_pretrained(MODEL_ID)
        model = MusicgenForConditionalGeneration.from_pretrained(MODEL_ID)
        model.eval()
    except Exception as exc:
        raise RuntimeError(f"Could not load MusicGen model: {exc}") from exc

    inputs = processor(text=[enriched_prompt], padding=True, return_tensors="pt")

    # 256 tokens ≈ 5s, 1500 ≈ 30s at MusicGen's 32kHz / 50 token-per-second rate.
    # Match roughly to the recording length (default 15s → 750 tokens).
    max_new_tokens = 750

    try:
        with torch.no_grad():
            audio_values = model.generate(**inputs, max_new_tokens=max_new_tokens)
    except Exception as exc:
        raise RuntimeError(f"MusicGen inference failed: {exc}") from exc

    # audio_values: (batch, channels, samples) at model.config.audio_encoder.sampling_rate
    sample_rate = model.config.audio_encoder.sampling_rate
    audio_np = audio_values[0].cpu().numpy().astype("float32")  # (channels, samples)
    audio_np = audio_np.T                                       # (samples, channels) for soundfile

    generated_path = output_dir / "generated.wav"
    try:
        sf.write(str(generated_path), audio_np, samplerate=sample_rate)
    except Exception as exc:
        raise RuntimeError(f"Could not write generated audio: {exc}") from exc

    return generated_path


def mix_audio(original_path: Path, generated_path: Path, output_path: Path) -> Path:
    """Blend the original recording on top of the AI-generated backing and write a WAV.

    Strategy:
      - Generated audio is the bed (full volume)
      - Original performance is laid on top at +3 dB relative to its own peak
        so it sits clearly above the backing without being harsh
      - Both tracks are peak-normalised before the blend so wildly different
        levels don't surprise us
      - Output is trimmed to the length of the shorter track

    Returns output_path.  Raises RuntimeError on any failure.
    """
    from pydub import AudioSegment
    from pydub.effects import normalize

    try:
        original = AudioSegment.from_file(str(original_path))
        generated = AudioSegment.from_file(str(generated_path))
    except Exception as exc:
        raise RuntimeError(f"Could not load audio for mixing: {exc}") from exc

    # Normalise both tracks to a consistent peak level
    original = normalize(original)
    generated = normalize(generated)

    # Make both mono-or-stereo consistent — upgrade original to stereo if needed
    if generated.channels == 2 and original.channels == 1:
        original = original.set_channels(2)

    # Match sample rates
    if original.frame_rate != generated.frame_rate:
        original = original.set_frame_rate(generated.frame_rate)

    # Trim both to the shorter duration so the overlay is clean
    min_len = min(len(original), len(generated))
    original = original[:min_len]
    generated = generated[:min_len]

    # Boost original +3 dB so the performance sits on top of the bed
    original = original + 3

    # Overlay: generated is the base, original is placed on top from t=0
    mixed = generated.overlay(original)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        mixed.export(str(output_path), format="wav")
    except Exception as exc:
        raise RuntimeError(f"Could not export mixed audio: {exc}") from exc

    return output_path
