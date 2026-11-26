"""AwaazAI Urdu TTS engine — Piper (CPU-only, laptop-safe).

Two real ur_PK voices, tested on this VM 2026-11-26 (piper-tts 1.8.0,
sentence "یہ آواز اے آئی ہے، اردو میں بول رہی ہے۔"):

- Aegis (female): mahwizzzz/piper-voice-ur-aegis-female,
  ur_PK-aegis_female-medium.onnx, 63,515,589 bytes, 22,050 Hz,
  3.04 s sample (134,188 bytes).
- Fasih (male): IhorShevchuk/piper-voice-ur-fasih,
  ur_PK-fasih-medium-model.onnx, 64,832,023 bytes, 22,050 Hz,
  2.14 s sample (94,252 bytes).

Qwen3-TTS does NOT speak Urdu (ur -> 422), so Piper is the Urdu
engine; Kokoro stays the English engine. Model files are NOT in the
repo — the in-app downloader (backend/models_downloader.py, group
"piper") fetches the .onnx + .onnx.json files into models/piper/.

Integration method + licence — read this before redistributing:
- Piper is used through the ``piper-tts`` pip package (``PiperVoice``
  Python API, bundled espeak-ng data, no separate binary needed).
  The version pinned in requirements.txt (1.8.0) ships under
  GPL-3.0: it is the maintained OHF-Voice/piper1-gpl fork, not the
  old MIT rhasspy/piper. AwaazAI calls it as a dependency; the Piper
  component itself stays GPL-3.0, and shipping the combined app
  commercially may carry GPL obligations — get advice before paid /
  commercial distribution. This file does not relicence anything.
- Voice-model provenance (honest caveat, also in README):
  both Hugging Face listings say "MIT", but Aegis was distilled
  from an OmniVoice teacher and warm-started from the Fasih
  checkpoint, which itself came from a Hindi checkpoint. Check that
  lineage before paid/commercial use; test/personal use is fine.
"""
from __future__ import annotations

import threading
from pathlib import Path

import numpy as np

BASE_DIR = Path(__file__).resolve().parent.parent
PIPER_DIR = BASE_DIR / "models" / "piper"

# voice_id -> (model file, config file, display name, gender, HF repo)
VOICES: dict[str, dict] = {
    "ur_aegis": {
        "model": "ur_PK-aegis_female-medium.onnx",
        "config": "ur_PK-aegis_female-medium.onnx.json",
        "name": "Aegis — warm female (Urdu)",
        "gender": "female",
        "hf_repo": "mahwizzzz/piper-voice-ur-aegis-female",
    },
    "ur_fasih": {
        "model": "ur_PK-fasih-medium-model.onnx",
        "config": "ur_PK-fasih-medium-model.onnx.json",
        "name": "Fasih — clear male (Urdu)",
        "gender": "male",
        "hf_repo": "IhorShevchuk/piper-voice-ur-fasih",
    },
}

SAMPLE_RATE = 22050

_lock = threading.Lock()
_loaded: dict[str, object] = {}


def is_piper_voice(voice_id: str) -> bool:
    return voice_id in VOICES


def model_files_present(voice_id: str | None = None) -> bool:
    """True if the .onnx + .json for one voice (or all voices) exist."""
    ids = [voice_id] if voice_id else list(VOICES)
    for vid in ids:
        info = VOICES.get(vid)
        if info is None:
            return False
        if not (PIPER_DIR / info["model"]).exists():
            return False
        if not (PIPER_DIR / info["config"]).exists():
            return False
    return True


def list_voices() -> list[dict]:
    """Urdu voice metadata (always listed, even if models are missing —
    the caller shows the download prompt then; `model_present` says so)."""
    return [
        {
            "id": vid,
            "name": info["name"],
            "gender": info["gender"],
            "language": "ur",
            "language_name": "Urdu",
            "engine": "piper",
            "cloning": False,
            "model_present": model_files_present(vid),
        }
        for vid, info in VOICES.items()
    ]


def status() -> dict:
    return {
        "state": "ready" if model_files_present() else "missing-models",
        "engine": "piper-tts 1.8.0 (GPL-3.0 fork)",
        "voices": [v["id"] for v in list_voices()],
        "model_files_present": model_files_present(),
        "sample_rate": SAMPLE_RATE,
    }


def _load(voice_id: str):
    if voice_id in _loaded:
        return _loaded[voice_id]
    info = VOICES[voice_id]
    model_path = PIPER_DIR / info["model"]
    config_path = PIPER_DIR / info["config"]
    if not model_path.exists() or not config_path.exists():
        raise RuntimeError(
            f"Piper Urdu model files missing for {voice_id} "
            f"({info['model']}). Download them from the in-app Models card "
            f"(Account → Models) or place them in models/piper/ (see README)."
        )
    from piper import PiperVoice

    voice = PiperVoice.load(str(model_path), config_path=str(config_path))
    _loaded[voice_id] = voice
    return voice


def synthesize_samples(text: str, voice: str = "ur_aegis",
                       speed: float = 1.0) -> tuple:
    """Urdu text -> (samples float32, 22050). Raises ValueError / RuntimeError."""
    text = (text or "").strip()
    if not text:
        raise ValueError("Text is empty.")
    if len(text) > 1000:
        raise ValueError("Text is too long for this demo (max 1000 characters).")
    if not 0.5 <= speed <= 2.0:
        raise ValueError("Speed must be between 0.5 and 2.0.")
    if voice not in VOICES:
        raise ValueError(f"Unknown Urdu voice: {voice}")
    from piper import SynthesisConfig

    # Piper length_scale is inverse speed: faster speech = smaller scale.
    config = SynthesisConfig(length_scale=max(0.5, min(2.0, 1.0 / speed)))
    piper_voice = _load(voice)
    with _lock:  # one synthesis at a time per process
        chunks = list(piper_voice.synthesize(text, config))
    if not chunks:
        raise RuntimeError("Piper produced no audio for this text.")
    samples = np.concatenate(
        [np.asarray(c.audio_float_array, dtype=np.float32) for c in chunks]
    )
    if samples.size == 0:
        raise RuntimeError("Piper produced empty audio for this text.")
    return samples, SAMPLE_RATE


def synthesize(text: str, voice: str = "ur_aegis",
               speed: float = 1.0) -> tuple[bytes, int]:
    """Urdu text -> (wav_bytes, 22050)."""
    import io

    import soundfile as sf

    samples, sample_rate = synthesize_samples(text, voice, speed)
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV")
    return buf.getvalue(), sample_rate


def engine_loaded() -> bool:
    return bool(_loaded)
