"""AwaazAI voice-cloning engine — Qwen3-TTS 0.6B CustomVoice via qwentts.cpp.

Design (honest, no fake audio):
- The product engine is Qwen3-TTS 0.6B CustomVoice (Apache 2.0,
  commercial-safe). It is run through qwentts.cpp, the MIT-licensed
  C++/GGML port, as a subprocess — no torch/CUDA needed on the server.
  qwentts.cpp runs on CPU (GGML_BACKEND=CPU), CUDA, Metal and Vulkan.
- Zero-shot cloning: a 3-10 s clean reference clip (+ its transcript
  when using the Base talker; CustomVoice uses an x-vector speaker
  encoder and does not need a transcript). No fine-tuning here.
- Urdu is NOT in Qwen3-TTS's 10 supported languages
  (Chinese, English, Japanese, Korean, German, French, Russian,
  Portuguese, Spanish, Italian — see the Qwen model card). A request
  for `ur` is rejected with 422 and a pointer to the Fish Speech
  candidate (Phase 0, docs/phase0-urdu-tests.md). We do NOT pretend
  Qwen speaks Urdu.
- If the qwentts.cpp binary or the GGUF weights are not installed,
  clone() raises CloneUnavailable (HTTP 503) with setup instructions.
  It never returns Kokoro audio or a copy of the reference and calls
  it a clone.

Install (once, on a machine with a GPU or a patient CPU):
    git clone --recurse-submodules https://github.com/ServeurpersoCom/qwentts.cpp.git tools/qwentts.cpp
    cd tools/qwentts.cpp && ./buildcpu.sh        # CPU only; ./buildcuda.sh for NVIDIA
    huggingface-cli download Serveurperso/Qwen3-TTS-GGUF \
        qwen-talker-0.6b-customvoice-Q8_0.gguf qwen-tokenizer-12hz-Q8_0.gguf \
        --local-dir ../../models/qwen
  Binary: tools/qwentts.cpp/build/qwen-tts
  Weights: models/qwen/qwen-talker-0.6b-customvoice-Q8_0.gguf
           models/qwen/qwen-tokenizer-12hz-Q8_0.gguf
  Both are gitignored (models/, tools/); users download them once.
"""
from __future__ import annotations

import subprocess
import tempfile
import threading
from pathlib import Path

import soundfile as sf

BASE_DIR = Path(__file__).resolve().parent.parent
QWEN_BIN = BASE_DIR / "tools" / "qwentts.cpp" / "build" / "qwen-tts"
QWEN_MODELS_DIR = BASE_DIR / "models" / "qwen"
TALKER = QWEN_MODELS_DIR / "qwen-talker-0.6b-customvoice-Q8_0.gguf"
TOKENIZER = QWEN_MODELS_DIR / "qwen-tokenizer-12hz-Q8_0.gguf"

ENGINE = "qwen3-tts-0.6b-customvoice (via qwentts.cpp, GGUF Q8_0)"

# Qwen3-TTS supported languages (model card, 10 languages). Urdu is NOT
# in this list — see docs/phase0-urdu-tests.md for the Phase 0 verdict.
SUPPORTED_LANGUAGES = {
    "en": "English",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "de": "German",
    "fr": "French",
    "ru": "Russian",
    "pt": "Portuguese",
    "es": "Spanish",
    "it": "Italian",
}
# qwentts.cpp --lang names (checked against its README examples).
_LANG_FLAG = {
    "en": "English", "zh": "Chinese", "ja": "Japanese", "ko": "Korean",
    "de": "German", "fr": "French", "ru": "Russian", "pt": "Portuguese",
    "es": "Spanish", "it": "Italian",
}

MAX_REF_SECONDS = 30.0
MIN_REF_SECONDS = 3.0
MAX_TEXT_CHARS = 500

_lock = threading.Lock()


class CloneUnavailable(RuntimeError):
    """Engine binary or weights not installed on this machine."""


class CloneValidationError(ValueError):
    """Bad request: missing/invalid audio, text, language or consent."""


def binary_present() -> bool:
    return QWEN_BIN.exists()


def models_present() -> bool:
    return TALKER.exists() and TOKENIZER.exists()


def engine_available() -> bool:
    return binary_present() and models_present()


def status() -> dict:
    """Honest engine status for /api/health and /api/clone/status."""
    if engine_available():
        state = "ready"
    elif binary_present():
        state = "weights-missing"
    elif models_present():
        state = "binary-missing"
    else:
        state = "not-installed"
    return {
        "engine": ENGINE,
        "state": state,
        "binary_present": binary_present(),
        "models_present": models_present(),
        "binary_path": str(QWEN_BIN),
        "models_dir": str(QWEN_MODELS_DIR),
        "supported_languages": sorted(SUPPORTED_LANGUAGES),
        "urdu_supported": False,
        "urdu_note": (
            "Urdu is not in Qwen3-TTS's 10 supported languages. "
            "Urdu cloning candidate: Fish Speech S2 (80+ languages, "
            "Urdu listed, Tier 3) — see docs/phase0-urdu-tests.md. "
            "Fish Speech is research-licensed, not yet in the product."
        ),
        "setup": (
            "See backend/clone_engine.py docstring: build qwentts.cpp "
            "(./buildcpu.sh) and download the 0.6B CustomVoice Q8_0 "
            "talker + 12Hz tokenizer GGUFs into models/qwen/."
            if state != "ready" else "Engine ready."
        ),
    }


def _validate_reference(ref_path: Path) -> float:
    """Check the reference clip: readable audio, 3-30 s, one speaker implied.

    Returns duration in seconds. Raises CloneValidationError.
    """
    try:
        info = sf.info(str(ref_path))
    except Exception as exc:  # unreadable / not audio at all
        raise CloneValidationError(f"Reference audio could not be read: {exc}")
    if info.samplerate < 8000:
        raise CloneValidationError("Reference audio sample rate is too low (need 8 kHz+).")
    duration = info.frames / info.samplerate if info.samplerate else 0.0
    if duration < MIN_REF_SECONDS:
        raise CloneValidationError(
            f"Reference clip is too short ({duration:.1f}s). Need at least "
            f"{MIN_REF_SECONDS:.0f} seconds of clean speech."
        )
    if duration > MAX_REF_SECONDS:
        raise CloneValidationError(
            f"Reference clip is too long ({duration:.1f}s). Max {MAX_REF_SECONDS:.0f}s — "
            "trim it to one clean 3-10 second clip."
        )
    return duration


def _normalise_reference(ref_path: Path, workdir: Path) -> Path:
    """Convert the reference to 24 kHz mono WAV (qwentts.cpp's input).

    Uses ffmpeg if available; if the file is already a 24 kHz mono WAV it
    is used as-is. Returns the path to use.
    """
    try:
        info = sf.info(str(ref_path))
    except Exception as exc:
        raise CloneValidationError(f"Reference audio could not be read: {exc}")
    if ref_path.suffix.lower() == ".wav" and info.samplerate == 24000 and info.channels == 1:
        return ref_path
    out = workdir / "ref-24k.wav"
    proc = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(ref_path),
         "-ac", "1", "-ar", "24000", str(out)],
        capture_output=True, text=True, timeout=120,
    )
    if proc.returncode != 0 or not out.exists():
        raise CloneValidationError(
            "Reference audio could not be converted to 24 kHz mono WAV. "
            "Please upload a WAV or MP3 file. "
            f"(ffmpeg: {(proc.stderr or '').strip()[:200]})"
        )
    return out


def clone(ref_path: Path, text: str, language: str, consent: bool) -> tuple[bytes, int]:
    """Clone `text` in the voice of `ref_path`. Returns (wav_bytes, sample_rate).

    Raises CloneValidationError (400), CloneUnavailable (503) or
    RuntimeError (engine failed — the exact stderr is included).
    Consent is mandatory: cloning only your own voice or a voice you have
    explicit permission to clone. No consent -> no clone, no exceptions.
    """
    if not consent:
        raise CloneValidationError(
            "Consent is required. Voice cloning is only allowed for your own "
            "voice or a voice you have explicit permission to clone. "
            "Please tick the consent checkbox."
        )
    text = (text or "").strip()
    if not text:
        raise CloneValidationError("Text is empty.")
    if len(text) > MAX_TEXT_CHARS:
        raise CloneValidationError(f"Text is too long (max {MAX_TEXT_CHARS} characters).")
    language = (language or "").strip().lower()
    if language not in SUPPORTED_LANGUAGES:
        if language == "ur":
            raise CloneValidationError(
                "Urdu is not supported by Qwen3-TTS (its 10 languages are "
                "Chinese, English, Japanese, Korean, German, French, Russian, "
                "Portuguese, Spanish, Italian). Urdu cloning is a Phase 0 "
                "open item — candidate: Fish Speech S2. See "
                "docs/phase0-urdu-tests.md."
            )
        raise CloneValidationError(
            f"Unsupported language: {language!r}. Supported: "
            f"{', '.join(sorted(SUPPORTED_LANGUAGES))}."
        )
    if not ref_path.exists():
        raise CloneValidationError("Reference audio file is missing.")
    _validate_reference(ref_path)
    if not engine_available():
        raise CloneUnavailable(
            "Voice cloning engine is not installed on this server. "
            f"State: {status()['state']}. {status()['setup']} "
            "Until then, use /api/tts with one of the 54 fixed Kokoro voices."
        )

    with _lock:  # one clone at a time on CPU; the GGML session is not shared
        with tempfile.TemporaryDirectory(prefix="awaazai-clone-") as td:
            workdir = Path(td)
            ref_wav = _normalise_reference(ref_path, workdir)
            out_wav = workdir / "clone.wav"
            prompt_file = workdir / "prompt.txt"
            prompt_file.write_text(text, encoding="utf-8")
            # qwentts.cpp customvoice: x-vector speaker encoder, no
            # transcript needed. --ref-wav carries the voice.
            cmd = [
                str(QWEN_BIN),
                "--model", str(TALKER),
                "--codec", str(TOKENIZER),
                "--ref-wav", str(ref_wav),
                "--lang", _LANG_FLAG[language],
                "-o", str(out_wav),
            ]
            proc = subprocess.run(
                cmd,
                stdin=prompt_file.open("rb"),
                capture_output=True, text=True, timeout=900,
                env={"GGML_BACKEND": "CPU", "PATH": "/usr/bin:/bin"},
            )
            if proc.returncode != 0 or not out_wav.exists():
                raise RuntimeError(
                    "Cloning engine failed. "
                    f"(exit {proc.returncode}; stderr: "
                    f"{(proc.stderr or proc.stdout or '').strip()[-500:]})"
                )
            return out_wav.read_bytes(), 24000
