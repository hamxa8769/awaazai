"""AwaazAI backend — FastAPI + Kokoro-82M TTS (CPU, laptop-safe).

Run from the project root:
    .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
Then open http://127.0.0.1:8000

Endpoints:
    GET  /api/health   — status + engine state (does NOT load the model)
    GET  /api/voices   — the 54 Kokoro voices
    POST /api/tts      — text -> WAV audio (Kokoro-82M, real synthesis)
    POST /api/clone    — 501, honestly not implemented yet (Qwen3-TTS 0.6B)
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend import tts_engine

BASE_DIR = Path(__file__).resolve().parent.parent

app = FastAPI(title="AwaazAI", version="0.1.0-mvp")


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)
    voice: str = "af_heart"
    speed: float = Field(1.0, ge=0.5, le=2.0)


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "AwaazAI",
        "version": "0.1.0-mvp",
        "engine": "kokoro-82m",
        "engine_loaded": tts_engine.engine_loaded(),
        "model_files_present": tts_engine.model_files_present(),
        "cloning": "not-implemented",
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


@app.post("/api/clone")
def clone():
    # Honest placeholder: do NOT fake cloning. Qwen3-TTS 0.6B is the planned
    # engine (Apache 2.0, 3-second reference clip, needs 4-6 GB VRAM).
    # It is not wired in yet — see README.md "What is still missing".
    raise HTTPException(
        status_code=501,
        detail=(
            "Voice cloning is not implemented yet. Planned engine: "
            "Qwen3-TTS 0.6B (Apache 2.0). This endpoint will accept a "
            "3-10 second reference recording and return audio in that voice. "
            "Until then, use /api/tts with one of the 54 fixed Kokoro voices."
        ),
    )


@app.get("/sample.wav")
def sample_wav():
    path = BASE_DIR / "sample.wav"
    if not path.exists():
        raise HTTPException(status_code=404, detail="sample.wav not generated yet")
    return FileResponse(path, media_type="audio/wav")


# Frontend (landing page + demo) and logo, served from the same server.
app.mount("/assets", StaticFiles(directory=BASE_DIR / "assets"), name="assets")
app.mount("/", StaticFiles(directory=BASE_DIR / "frontend", html=True), name="frontend")
