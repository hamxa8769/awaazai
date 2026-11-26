"""AwaazAI TTS engine — Kokoro-82M via kokoro-onnx (CPU-friendly) for
English (+ 8 more Kokoro languages) and Piper via piper-tts for Urdu.

Laptop-safe by design: 82M parameters, ~310 MB ONNX model, runs on CPU
with no GPU required. Urdu voices (ur_aegis / ur_fasih) route to
backend/piper_engine.py (Piper, 22,050 Hz, ~63 MB per voice).
No voice cloning here — Kokoro ships fixed voices only. Cloning
(Qwen3-TTS 0.6B) is a separate engine (backend/clone_engine.py).
"""
from __future__ import annotations

import io
import threading
from pathlib import Path

import soundfile as sf

BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_PATH = BASE_DIR / "models" / "kokoro-v1.0.onnx"
VOICES_PATH = BASE_DIR / "models" / "voices-v1.0.bin"

# Language code per Kokoro voice prefix (first letter of the voice id).
_LANG_BY_PREFIX = {
    "a": ("en-us", "English (US)"),
    "b": ("en-gb", "English (UK)"),
    "e": ("es", "Spanish"),
    "f": ("fr", "French"),
    "h": ("hi", "Hindi"),
    "i": ("it", "Italian"),
    "j": ("ja", "Japanese"),
    "p": ("pt-br", "Portuguese (BR)"),
    "z": ("zh", "Mandarin"),
}

# Friendly display names for the most-used voices; others fall back to the id.
_DISPLAY_NAMES = {
    "af_heart": "Heart — warm female",
    "af_bella": "Bella — bright female",
    "af_sarah": "Sarah — calm female",
    "af_nova": "Nova — clear female",
    "af_sky": "Sky — soft female",
    "af_nicole": "Nicole — friendly female",
    "af_alloy": "Alloy — neutral female",
    "af_aoede": "Aoede — gentle female",
    "af_jessica": "Jessica — warm female",
    "af_kore": "Kore — clear female",
    "af_river": "River — smooth female",
    "am_adam": "Adam — deep male",
    "am_michael": "Michael — steady male",
    "am_liam": "Liam — young male",
    "am_onyx": "Onyx — deep male",
    "am_echo": "Echo — clear male",
    "am_eric": "Eric — calm male",
    "am_fenrir": "Fenrir — strong male",
    "am_puck": "Puck — lively male",
    "am_santa": "Santa — warm male",
    "bf_alice": "Alice — British female",
    "bf_emma": "Emma — British female",
    "bf_lily": "Lily — British female",
    "bm_daniel": "Daniel — British male",
    "bm_george": "George — British male",
    "hf_alpha": "Alpha — Hindi female",
    "hf_beta": "Beta — Hindi female",
    "hm_omega": "Omega — Hindi male",
    "hm_psi": "Psi — Hindi male",
}

_lock = threading.Lock()
_kokoro = None


def model_files_present() -> bool:
    return MODEL_PATH.exists() and VOICES_PATH.exists()


def _load():
    global _kokoro
    if _kokoro is None:
        if not model_files_present():
            raise RuntimeError(
                "Kokoro model files missing. Download kokoro-v1.0.onnx and "
                "voices-v1.0.bin from the kokoro-onnx model-files-v1.0 release "
                "into the models/ folder (see README.md)."
            )
        from kokoro_onnx import Kokoro

        _kokoro = Kokoro(str(MODEL_PATH), str(VOICES_PATH))
    return _kokoro


def list_voices() -> list[dict]:
    """All voices: 54 Kokoro voices (when Kokoro models are present)
    plus the 2 Piper Urdu voices (always listed, with `model_present`
    saying whether their files are downloaded). Raises RuntimeError
    only when no voice at all is available."""
    voices = []
    try:
        kokoro = _load()
        for voice_id in kokoro.get_voices():
            lang_code, lang_name = _LANG_BY_PREFIX.get(voice_id[0], ("en-us", "English (US)"))
            gender = "female" if len(voice_id) > 1 and voice_id[1] == "f" else "male"
            voices.append(
                {
                    "id": voice_id,
                    "name": _DISPLAY_NAMES.get(voice_id, voice_id),
                    "gender": gender,
                    "language": lang_code,
                    "language_name": lang_name,
                    "engine": "kokoro",
                    "cloning": False,  # Kokoro voices are fixed, not cloned
                }
            )
    except RuntimeError:
        pass  # Kokoro missing — Piper voices below may still be available
    from backend import piper_engine

    voices.extend(piper_engine.list_voices())
    if not voices:
        raise RuntimeError(
            "No TTS voices available. Download the Kokoro model files "
            "(models/) or the Piper Urdu voices (models/piper/) — see README.md."
        )
    return voices


def voice_lang(voice_id: str) -> str:
    if voice_id.startswith("ur_"):
        return "ur"
    return _LANG_BY_PREFIX.get(voice_id[0], ("en-us",))[0]


def synthesize_samples(text: str, voice: str = "af_heart", speed: float = 1.0) -> tuple:
    """Text -> (samples, sample_rate). Shared by /api/tts and Studio.
    Urdu voices (ur_aegis / ur_fasih) route to Piper (22,050 Hz);
    everything else routes to Kokoro (24,000 Hz)."""
    # Piper Urdu voices — validated inside piper_engine.
    if voice.startswith("ur_"):
        from backend import piper_engine

        return piper_engine.synthesize_samples(text, voice, speed)
    text = (text or "").strip()
    if not text:
        raise ValueError("Text is empty.")
    if len(text) > 1000:
        raise ValueError("Text is too long for this MVP demo (max 1000 characters).")
    if not 0.5 <= speed <= 2.0:
        raise ValueError("Speed must be between 0.5 and 2.0.")
    kokoro = _load()
    if voice not in kokoro.get_voices():
        raise ValueError(f"Unknown voice: {voice}")
    with _lock:  # ONNX session is not guaranteed thread-safe
        samples, sample_rate = kokoro.create(
            text, voice=voice, speed=speed, lang=voice_lang(voice)
        )
    return samples, sample_rate


def synthesize(text: str, voice: str = "af_heart", speed: float = 1.0) -> tuple[bytes, int]:
    """Text -> (wav_bytes, sample_rate). Raises ValueError on bad input."""
    samples, sample_rate = synthesize_samples(text, voice, speed)
    buf = io.BytesIO()
    sf.write(buf, samples, sample_rate, format="WAV")
    return buf.getvalue(), sample_rate


def engine_loaded() -> bool:
    return _kokoro is not None
