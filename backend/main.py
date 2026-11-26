"""AwaazAI backend — FastAPI + Kokoro-82M TTS (CPU, laptop-safe) + Qwen3-TTS cloning
+ local accounts (SQLite): signup/login, history, credits, saved voices.

Run from the project root:
    .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
Then open http://127.0.0.1:8000

Accounts (local-first, no external service, no real payment):
    POST /api/auth/signup  — username + password -> user + token (100 free credits)
    POST /api/auth/login   — username + password -> user + token
    POST /api/auth/logout  — invalidate this token
    GET  /api/auth/me      — current user + credits (Bearer token)
    GET  /api/credits      — balance
    GET  /api/history      — own history (TTS + Clone), newest first
    GET  /api/history/{id}/audio — own generated audio
    DELETE /api/history/{id}
    POST /api/voices/save  — save a cloned voice by name (multipart reference)
    GET  /api/voices/saved — own saved voices
    DELETE /api/voices/saved/{id}

Pricing: TTS 1 credit per 100 characters (rounded up), Clone 10 credits
per generation. Logged-out users can still try TTS as a demo (frontend
shows 5 generations per browser session); cloning needs login + consent.
Insufficient credits -> 402 with a clear message. "Get more credits" is
honestly Coming Soon — no real payment is wired up.
"""
from __future__ import annotations

import io
import secrets
import shutil
import tempfile
import wave
from pathlib import Path

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend import accounts, clone_engine, tts_engine

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
VERSION = "0.3.0"

app = FastAPI(title="AwaazAI", version="0.3.0")


def _wav_duration(wav_bytes: bytes) -> float | None:
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as w:
            return w.getnframes() / w.getframerate() if w.getframerate() else None
    except Exception:
        return None


def _save_generated(user_id: int, kind: str, wav_bytes: bytes) -> str:
    """Save generated audio under data/history/<user>/ and return its path."""
    folder = DATA_DIR / "history" / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{kind}-{secrets.token_hex(8)}.wav"
    path.write_bytes(wav_bytes)
    return str(path)


def _current_user(authorization: str | None) -> dict | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return accounts.authenticate(authorization[7:].strip())


def _require_user(authorization: str | None) -> dict:
    user = _current_user(authorization)
    if user is None:
        raise HTTPException(status_code=401, detail="Login zaroori hai — pehle sign up ya login karein.")
    return user


class TTSRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=1000)
    voice: str = "af_heart"
    speed: float = Field(1.0, ge=0.5, le=2.0)


class AuthRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=30)
    password: str = Field(..., min_length=6, max_length=100)


class SaveVoiceRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    language: str = "en"


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
        "accounts": "ready",
        "dubbing": "not-implemented",
    }


@app.get("/api/voices")
def voices():
    try:
        return {"engine": "kokoro-82m", "count": 54, "voices": tts_engine.list_voices()}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))


# ---- Auth ----
@app.post("/api/auth/signup")
def signup(req: AuthRequest):
    try:
        user = accounts.create_user(req.username, req.password)
    except accounts.AuthError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    _, token = accounts.login(req.username, req.password)
    return {"user": user, "token": token}


@app.post("/api/auth/login")
def login(req: AuthRequest):
    try:
        user, token = accounts.login(req.username, req.password)
    except accounts.AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc))
    return {"user": user, "token": token}


@app.post("/api/auth/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        accounts.logout(authorization[7:].strip())
    return {"status": "ok"}


@app.get("/api/auth/me")
def me(authorization: str | None = Header(default=None)):
    user = _require_user(authorization)
    return {"user": user, "credits": accounts.get_credits(user["id"])}


@app.get("/api/credits")
def credits(authorization: str | None = Header(default=None)):
    user = _require_user(authorization)
    return {"credits": accounts.get_credits(user["id"])}


# ---- TTS (logged-in: charged + saved to history; logged-out: demo) ----
@app.post("/api/tts")
def tts(req: TTSRequest, authorization: str | None = Header(default=None)):
    user = _current_user(authorization)
    cost = 0
    if user is not None:
        cost = accounts.tts_cost(req.text)
        try:
            balance = accounts.deduct_credits(user["id"], cost)
        except accounts.AuthError as exc:
            raise HTTPException(status_code=402, detail=str(exc))
    else:
        balance = None
    try:
        wav_bytes, sample_rate = tts_engine.synthesize(req.text, req.voice, req.speed)
    except ValueError as exc:
        if user is not None:
            accounts.refund_credits(user["id"], cost)
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        if user is not None:
            accounts.refund_credits(user["id"], cost)
        raise HTTPException(status_code=503, detail=str(exc))
    headers = {
        "Content-Disposition": 'attachment; filename="awaazai.wav"',
        "X-Sample-Rate": str(sample_rate),
        "X-Engine": "kokoro-82m",
    }
    if user is not None:
        file_path = _save_generated(user["id"], "tts", wav_bytes)
        accounts.add_history(user["id"], "tts", req.text, req.voice, "en",
                             cost, _wav_duration(wav_bytes), file_path)
        headers["X-Credits-Remaining"] = str(balance)
    return Response(content=wav_bytes, media_type="audio/wav", headers=headers)


@app.get("/api/clone/status")
def clone_status():
    return clone_engine.status()


# ---- Clone (login required, 10 credits) ----
@app.post("/api/clone")
async def clone(
    authorization: str | None = Header(default=None),
    reference: UploadFile | None = File(default=None),
    saved_voice_id: int | None = Form(default=None),
    text: str = Form(...),
    language: str = Form("en"),
    consent: bool = Form(False),
):
    """Voice cloning. Login required. Either upload `reference` audio
    (WAV/MP3, 3-30 s) or pass `saved_voice_id` to reuse a saved voice
    without re-uploading. Consent is mandatory in both cases."""
    user = _require_user(authorization)
    if not consent:
        raise HTTPException(
            status_code=400,
            detail="Consent is required. Voice cloning is only allowed for your own "
            "voice or a voice you have explicit permission to clone.",
        )
    # Resolve the reference audio: saved voice wins, else the upload.
    saved_voice = None
    ref_path: Path | None = None
    ref_suffix = ".wav"
    ref_bytes: bytes | None = None
    if saved_voice_id is not None:
        saved_voice = accounts.get_saved_voice(user["id"], saved_voice_id)
        if saved_voice is None:
            raise HTTPException(status_code=404, detail="Saved voice nahi mili.")
        ref_path = Path(saved_voice["file_path"])
        if not ref_path.exists():
            raise HTTPException(status_code=410, detail="Saved voice ki audio file nahi mili.")
        language = saved_voice["language"]
    else:
        if reference is None or not reference.filename:
            raise HTTPException(status_code=400, detail="Reference audio file is missing — upload karein ya saved voice chunein.")
        ref_suffix = Path(reference.filename).suffix.lower()
        if ref_suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported reference audio format: {ref_suffix or '(none)'} — use WAV or MP3.",
            )
        ref_bytes = await reference.read()
        if not ref_bytes:
            raise HTTPException(status_code=400, detail="Reference audio file is empty.")
        if len(ref_bytes) > 20 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Reference audio is too large (max 20 MB).")

    try:
        balance = accounts.deduct_credits(user["id"], accounts.CLONE_COST)
    except accounts.AuthError as exc:
        raise HTTPException(status_code=402, detail=str(exc))

    with tempfile.TemporaryDirectory(prefix="awaazai-clone-upload-") as td:
        if ref_path is None:
            tmp_ref = Path(td) / f"reference{ref_suffix}"
            tmp_ref.write_bytes(ref_bytes)
            ref_path = tmp_ref
        try:
            wav_bytes, sample_rate = clone_engine.clone(ref_path, text, language, consent)
        except clone_engine.CloneValidationError as exc:
            accounts.refund_credits(user["id"], accounts.CLONE_COST)
            msg = str(exc)
            code = 422 if msg.startswith(("Urdu is not supported", "Unsupported language")) else 400
            raise HTTPException(status_code=code, detail=msg)
        except clone_engine.CloneUnavailable as exc:
            accounts.refund_credits(user["id"], accounts.CLONE_COST)
            raise HTTPException(status_code=503, detail=str(exc))
        except RuntimeError as exc:
            accounts.refund_credits(user["id"], accounts.CLONE_COST)
            raise HTTPException(status_code=502, detail=str(exc))
    voice_label = saved_voice["name"] if saved_voice else "reference upload"
    file_path = _save_generated(user["id"], "clone", wav_bytes)
    accounts.add_history(user["id"], "clone", text, voice_label, language,
                         accounts.CLONE_COST, _wav_duration(wav_bytes), file_path)
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'attachment; filename="awaazai-clone.wav"',
            "X-Sample-Rate": str(sample_rate),
            "X-Engine": "qwen3-tts-0.6b-base",
            "X-Cloned-Voice": voice_label,
            "X-Credits-Remaining": str(balance),
        },
    )


# ---- History ----
@app.get("/api/history")
def history(authorization: str | None = Header(default=None)):
    user = _require_user(authorization)
    return {"history": accounts.list_history(user["id"])}


@app.get("/api/history/{history_id}/audio")
def history_audio(history_id: int, authorization: str | None = Header(default=None)):
    user = _require_user(authorization)
    rows = accounts.list_history(user["id"], limit=500)
    row = next((r for r in rows if r["id"] == history_id), None)
    if row is None or not row.get("file_path"):
        raise HTTPException(status_code=404, detail="History item nahi mila.")
    path = Path(row["file_path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio file nahi mili.")
    return FileResponse(path, media_type="audio/wav")


@app.delete("/api/history/{history_id}")
def delete_history(history_id: int, authorization: str | None = Header(default=None)):
    user = _require_user(authorization)
    file_path = accounts.delete_history(user["id"], history_id)
    if file_path is None:
        raise HTTPException(status_code=404, detail="History item nahi mila.")
    if file_path:
        try:
            Path(file_path).unlink(missing_ok=True)
        except OSError:
            pass
    return {"status": "deleted"}


# ---- Saved voices ----
@app.post("/api/voices/save")
async def save_voice(
    authorization: str | None = Header(default=None),
    name: str = Form(...),
    language: str = Form("en"),
    reference: UploadFile = File(...),
):
    """Save a cloned voice by name so it can be reused without re-uploading.
    Stores the reference audio under data/voices/<user>/ (gitignored)."""
    user = _require_user(authorization)
    if not reference.filename:
        raise HTTPException(status_code=400, detail="Reference audio file is missing.")
    suffix = Path(reference.filename).suffix.lower()
    if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}:
        raise HTTPException(status_code=400, detail="Unsupported audio format — use WAV or MP3.")
    data = await reference.read()
    if not data:
        raise HTTPException(status_code=400, detail="Reference audio file is empty.")
    if len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Reference audio is too large (max 20 MB).")
    folder = DATA_DIR / "voices" / str(user["id"])
    folder.mkdir(parents=True, exist_ok=True)
    filename = f"voice-{secrets.token_hex(8)}{suffix}"
    path = folder / filename
    path.write_bytes(data)
    try:
        saved = accounts.save_voice(user["id"], name, language, str(path))
    except accounts.AuthError as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=str(exc))
    return {"voice": saved}


@app.get("/api/voices/saved")
def saved_voices(authorization: str | None = Header(default=None)):
    user = _require_user(authorization)
    return {"voices": accounts.list_saved_voices(user["id"])}


@app.delete("/api/voices/saved/{voice_id}")
def delete_saved_voice(voice_id: int, authorization: str | None = Header(default=None)):
    user = _require_user(authorization)
    file_path = accounts.delete_saved_voice(user["id"], voice_id)
    if file_path is None:
        raise HTTPException(status_code=404, detail="Saved voice nahi mili.")
    try:
        Path(file_path).unlink(missing_ok=True)
    except OSError:
        pass
    return {"status": "deleted"}


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
