"""AwaazAI speech-to-text — faster-whisper (tiny model, CPU).

Design (honest, no fake transcripts):
- Engine: faster-whisper 1.2.1, model "tiny" (~75 MB, downloads once
  from Hugging Face into the normal HF cache on first use, then works
  offline). CPU-only, int8 compute — laptop-safe, no GPU needed.
  Tiny is the fast/CPU trade-off: on clean English speech it is good;
  on noisy or heavily accented speech it will make mistakes, and the
  transcript it returns is what the model actually heard — never
  invented or filled in.
- If faster-whisper is not installed, transcribe() raises
  STTUnavailable (HTTP 503) with setup instructions. It never returns
  an empty or guessed transcript.
- Audio is normalised to 16 kHz mono WAV with ffmpeg first (ffmpeg is
  already a project dependency for cloning), so WAV/MP3/FLAC/OGG/M4A
  all work. Max input ~5 minutes / 25 MB.
- The WAV is loaded with soundfile into a float32 numpy array and the
  ARRAY is passed to faster-whisper — deliberately NOT a file path.
  Reason (2026-11-26, real bug): faster-whisper 1.2.1 calls
  av.open(..., metadata_errors="ignore") when given a path, but the
  PyAV 19.x it pulls no longer accepts that keyword, so every STT
  call crashed with TypeError. Passing an array skips faster-whisper's
  PyAV decode path entirely, so the installed PyAV version does not
  matter.
"""
from __future__ import annotations

import subprocess
import threading
from pathlib import Path

import soundfile as sf

MODEL_NAME = "tiny"  # ~75 MB; "base" (~145 MB) is the slower, more accurate option
MODEL_SIZE_MB = "~75 MB"
ENGINE = "faster-whisper tiny (CPU, int8)"

MAX_AUDIO_MB = 25
MAX_AUDIO_SECONDS = 300.0  # 5 minutes

_lock = threading.Lock()
_model = None


class STTUnavailable(RuntimeError):
    """faster-whisper is not installed on this machine."""


class STTValidationError(ValueError):
    """Bad request: unreadable / too long / too large audio."""


def engine_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except ImportError:
        return False


def status() -> dict:
    return {
        "engine": ENGINE,
        "model": MODEL_NAME,
        "model_size": MODEL_SIZE_MB,
        "state": "ready" if engine_available() else "not-installed",
        "setup": (
            "Engine ready."
            if engine_available()
            else "pip install faster-whisper — the tiny model (~75 MB) "
            "downloads once from Hugging Face on first use."
        ),
    }


def _load():
    global _model
    if _model is None:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise STTUnavailable(
                "Speech-to-text engine is not installed on this server. "
                "pip install faster-whisper (see backend/stt_engine.py)."
            ) from exc
        _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8")
    return _model


def _normalise_to_wav(src: Path, workdir: Path) -> Path:
    """Convert any supported audio to 16 kHz mono WAV for Whisper."""
    out = workdir / "stt-16k.wav"
    proc = subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(src),
         "-ac", "1", "-ar", "16000", str(out)],
        capture_output=True, text=True, timeout=300,
    )
    if proc.returncode != 0 or not out.exists():
        raise STTValidationError(
            "Audio file could not be read/converted. Use WAV or MP3. "
            f"(ffmpeg: {(proc.stderr or '').strip()[:200]})"
        )
    return out


def transcribe(audio_path: Path, workdir: Path) -> dict:
    """Transcribe `audio_path`. Returns transcript + language + segments.

    Raises STTValidationError (400) or STTUnavailable (503).
    """
    wav_path = _normalise_to_wav(audio_path, workdir)
    try:
        info = sf.info(str(wav_path))
    except Exception as exc:
        raise STTValidationError(f"Audio file could not be read: {exc}") from exc
    duration = info.frames / info.samplerate if info.samplerate else 0.0
    if duration <= 0:
        raise STTValidationError("Audio file is empty.")
    if duration > MAX_AUDIO_SECONDS:
        raise STTValidationError(
            f"Audio is too long ({duration:.0f}s). Max {MAX_AUDIO_SECONDS:.0f}s (5 minutes)."
        )
    model = _load()
    # Load the normalised WAV as a float32 array and pass the ARRAY
    # (see module docstring — passing a path crashes on PyAV 19.x).
    try:
        audio_array, sr = sf.read(str(wav_path), dtype="float32", always_2d=False)
    except Exception as exc:
        raise STTValidationError(f"Audio file could not be read: {exc}") from exc
    if sr != 16000:
        raise STTValidationError(f"Internal error: normalised audio is {sr} Hz, expected 16000.")
    with _lock:  # one transcription at a time on CPU
        try:
            segments_iter, info = model.transcribe(
                audio_array, beam_size=5, vad_filter=True,
            )
            segments = []
            text_parts = []
            for seg in segments_iter:
                segments.append({
                    "start": round(seg.start, 2),
                    "end": round(seg.end, 2),
                    "text": seg.text.strip(),
                })
                text_parts.append(seg.text.strip())
        except Exception as exc:
            raise RuntimeError(f"Speech-to-text engine failed: {exc}") from exc
    text = " ".join(p for p in text_parts if p).strip()
    return {
        "text": text,
        "language": info.language,
        "language_probability": round(info.language_probability, 3),
        "duration_seconds": round(duration, 2),
        "segments": segments,
        "model": MODEL_NAME,
        "engine": ENGINE,
    }
