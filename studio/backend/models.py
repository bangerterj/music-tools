"""Pydantic data models for Studio DAW."""

from __future__ import annotations

from typing import List

from pydantic import BaseModel


class EQBand(BaseModel):
    freq: float = 1000.0      # Hz (20–20000)
    gain: float = 0.0         # dB (−18 to +18)
    q: float = 1.0            # Q factor (0.1–10)
    type: str = "peak"        # "lowshelf"|"highshelf"|"peak"|"lowpass"|"highpass"


class EQSettings(BaseModel):
    bands: List[EQBand] = []


class CompressionSettings(BaseModel):
    threshold: float = -24.0
    ratio: float = 4.0
    attack_ms: float = 10.0
    release_ms: float = 100.0
    makeup_gain: float = 0.0


class ReverbSettings(BaseModel):
    room_size: float = 0.3
    wet_dry: float = 0.2
    damping: float = 0.5


class DelaySettings(BaseModel):
    time_ms: float = 250.0
    feedback: float = 0.3
    wet_dry: float = 0.15


class EffectsChain(BaseModel):
    eq: EQSettings = EQSettings()
    compression: CompressionSettings = CompressionSettings()
    reverb: ReverbSettings = ReverbSettings()
    delay: DelaySettings = DelaySettings()
    eq_enabled: bool = True
    compression_enabled: bool = True
    reverb_enabled: bool = False
    delay_enabled: bool = False


class Clip(BaseModel):
    id: str
    file: str            # relative path to audio file within project dir
    start: float         # seconds on timeline
    duration: float      # seconds
    offset: float = 0.0  # trim start within the file (seconds)
    color: str = "#4CAF50"


class Track(BaseModel):
    id: str
    name: str
    type: str = "audio"   # "audio" | "midi"
    color: str = "#4CAF50"
    muted: bool = False
    solo: bool = False
    volume: float = 0.8   # 0–1
    pan: float = 0.0      # −1 to 1
    clips: List[Clip] = []
    effects: EffectsChain = EffectsChain()


class Project(BaseModel):
    id: str
    name: str
    bpm: float = 120.0
    sample_rate: int = 44100
    tracks: List[Track] = []
    created_at: str
    updated_at: str


# ── Preset effects per stem type ─────────────────────────────────────────────

def vocals_preset() -> EffectsChain:
    return EffectsChain(
        eq=EQSettings(bands=[
            EQBand(freq=80.0,   gain=0.0,  q=0.7,  type="highpass"),
            EQBand(freq=3000.0, gain=2.0,  q=1.2,  type="peak"),
            EQBand(freq=12000.0, gain=1.5, q=0.9,  type="highshelf"),
        ]),
        compression=CompressionSettings(threshold=-18.0, ratio=3.0, attack_ms=10.0, release_ms=80.0),
        reverb=ReverbSettings(room_size=0.25, wet_dry=0.18),
        eq_enabled=True, compression_enabled=True, reverb_enabled=True, delay_enabled=False,
    )


def piano_preset() -> EffectsChain:
    return EffectsChain(
        eq=EQSettings(bands=[
            EQBand(freq=40.0,   gain=0.0,  q=0.7, type="highpass"),
            EQBand(freq=200.0,  gain=1.5,  q=1.0, type="peak"),
            EQBand(freq=2000.0, gain=-1.0, q=1.0, type="peak"),
        ]),
        compression=CompressionSettings(threshold=-20.0, ratio=2.5, attack_ms=30.0, release_ms=200.0),
        eq_enabled=True, compression_enabled=True, reverb_enabled=False, delay_enabled=False,
    )


def drums_preset() -> EffectsChain:
    return EffectsChain(
        eq=EQSettings(bands=[
            EQBand(freq=30.0,   gain=0.0, q=0.7, type="highpass"),
            EQBand(freq=80.0,   gain=2.0, q=1.5, type="peak"),
            EQBand(freq=5000.0, gain=1.0, q=1.0, type="peak"),
        ]),
        compression=CompressionSettings(threshold=-12.0, ratio=6.0, attack_ms=5.0, release_ms=50.0),
        eq_enabled=True, compression_enabled=True, reverb_enabled=False, delay_enabled=False,
    )


def bass_preset() -> EffectsChain:
    return EffectsChain(
        eq=EQSettings(bands=[
            EQBand(freq=8000.0, gain=0.0,  q=0.7, type="lowpass"),
            EQBand(freq=60.0,   gain=2.0,  q=1.5, type="peak"),
            EQBand(freq=250.0,  gain=-2.0, q=1.0, type="peak"),
        ]),
        compression=CompressionSettings(threshold=-18.0, ratio=4.0, attack_ms=20.0, release_ms=150.0),
        eq_enabled=True, compression_enabled=True, reverb_enabled=False, delay_enabled=False,
    )


def pads_preset() -> EffectsChain:
    return EffectsChain(
        eq=EQSettings(bands=[
            EQBand(freq=120.0, gain=0.0, q=0.7, type="highpass"),
        ]),
        reverb=ReverbSettings(room_size=0.5, wet_dry=0.3),
        delay=DelaySettings(time_ms=375.0, feedback=0.25, wet_dry=0.12),
        eq_enabled=True, compression_enabled=False, reverb_enabled=True, delay_enabled=True,
    )


STEM_PRESETS = {
    "vocals": vocals_preset,
    "piano": piano_preset,
    "drums": drums_preset,
    "bass": bass_preset,
    "other": pads_preset,
}

TRACK_COLORS = [
    "#FF6B6B",  # coral/red
    "#4ECDC4",  # teal
    "#45B7D1",  # blue
    "#96CEB4",  # sage green
    "#FFEAA7",  # yellow
    "#DDA0DD",  # plum
    "#98D8C8",  # mint
    "#F7DC6F",  # gold
]
