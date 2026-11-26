"""AwaazAI backend — FastAPI + Kokoro-82M TTS (CPU, laptop-safe) + Qwen3-TTS cloning.

Run from the project root:
    .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
Then open http://127.0.0.1:8000

Endpoints:
    GET  /api/health         — status + engine state (does NOT load models)
    GET  /api/voices         — the 54 Kokoro voices
    POST /api/tts            — text -> WAV audio (Kokoro-82M, real synthesis)
    GET  /api/clone/status   — cloning engine state (binary/weights/languages)
    POST /api/clone          — multipart: reference audio + text + language
                               + consent -> WAV in the cloned voice
                               (Qwen3-TTS 0.6B Base via qwentts.cpp;
                               503 when the engine is not installed on this
                               server, 422 for Urdu / unsupported language,
                               400 for missing audio/text/consent)
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend import clone_engine, tts_engine

BASE_DIR = Path(__file__).resolve().parent.parent
VERSION = "0.2.2"

app = FastAPI(title="AwaazAI", version="0.2.2")


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)
    voice: str = "af_heart"
    speed: float = Field(1.0, ge=0.5, le=2.0)


@app.get("/api/health")
def health():
    clone_status = clone_engine.status()
    return {
        "status": "ok",
        "service": "AwaazAI",
        "version": VERSION,
        "engine": "kokoro-82m",
        "engine_loaded": tts_engine.engine_loaded(),
        "model_files_present": tts_engine.model_files_present(),
        "cloning": clone_status["state"],
        "cloning_engine": clone_status["engine"],
        "dubbing": "not-implemented",
    }


@app.get("/api/voices")
def voices():
    try:
        return {"engine": "kokoro-82m", "count": 54, "voices": tts_engine.list_voices()}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


@app.post("/api/tts")
def tts(req: TTSRequest):
    try:
        wav_bytes, sample_rate = tts_engine.synthesize(req.text, req.voice, req.speed)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'attachment; filename="awaazai.wav"',
            "X-Sample-Rate": str(sample_rate),
            "X-Engine": "kokoro-82m",
        },
    )


@app.get("/api/clone/status")
def clone_status():
    return clone_engine.status()


@app.post("/api/clone")
async def clone(
    reference: UploadFile = File(...),
    text: str = Form(...),
    language: str = Form("en"),
    consent: bool = Form(False),
):
    """Voice cloning. Multipart form: reference (wav/mp3, 3-30 s),
    text (max 500 chars), language (en/zh/ja/ko/de/fr/ru/pt/es/it),
    consent (must be true — own voice or explicit permission)."""
    if not reference.filename:
        raise HTTPException(status_code=400, detail="Reference audio file is missing.")
    suffix = Path(reference.filename).suffix.lower()
    if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported reference audio format: {suffix or '(none)'} — use WAV or MP3.",
        )
    data = await reference.read()
    if not data:
        raise HTTPException(status_code=400, detail="Reference audio file is empty.")
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Reference audio is too large (max 20 MB).")
    with tempfile.TemporaryDirectory(prefix="awaazai-clone-upload-") as td:
        ref_path = Path(td) / f"reference{suffix}"
        ref_path.write_bytes(data)
        try:
            wav_bytes, sample_rate = clone_engine.clone(ref_path, text, language, consent)
        except clone_engine.CloneValidationError as exc:
            # 422 for unsupported language, 400 for the rest.
            msg = str(exc)
            code = 422 if msg.startswith(("Urdu is not supported", "Unsupported language")) else 400
            raise HTTPException(status_code=code, detail=msg)
        except clone_engine.CloneUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=str(exc))
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'attachment; filename="awaazai-clone.wav"',
            "X-Sample-Rate": str(sample_rate),
            "X-Engine": "qwen3-tts-0.6b-base",
            "X-Cloned-Voice": "reference-audio",
        },
    )


@app.get("/sample.wav")
def sample_wav():
    path = BASE_DIR / "sample.wav"
    if not path.exists():
        raise HTTPException(status_code=404, detail="sample.wav not generated yet")
    return FileResponse(path, media_type="audio/wav")


# Frontend (landing page + demo) and logo, served from the same server.
app.mount("/assets", StaticFiles(directory=BASE_DIR / "assets"), name="assets")
app.mount("/samples", StaticFiles(directory=BASE_DIR / "samples"), name="samples")
app.mount("/", StaticFiles(directory=BASE_DIR / "frontend", html=True), name="frontend")
