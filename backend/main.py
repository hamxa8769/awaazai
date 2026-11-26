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

    POST /api/stt      — speech-to-text (faster-whisper tiny, CPU)
    POST /api/dub       — dubbing: STT -> translate -> re-voice (login, 20 credits)
    POST /api/studio    — long-form TTS, chunked with chapters (login, TTS rate)

Pricing: TTS 1 credit per 100 characters (rounded up), Clone 10 credits
per generation, Dub 20 credits per dub, Studio at the TTS rate.
shows 5 generations per browser session); cloning needs login + consent.
Insufficient credits -> 402 with a clear message. "Get more credits" is
honestly Coming Soon — no real payment is wired up.
"""
from __future__ import annotations

import io
import json
import secrets
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request
import wave
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend import accounts, clone_engine, models_downloader, stt_engine, studio, translate, tts_engine

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
VERSION = "0.6.0"

app = FastAPI(title="AwaazAI", version=VERSION)


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


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(...)
    new_password: str = Field(...)


class StudioRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
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
        "accounts": "ready",
        "stt": stt_engine.status()["state"],
        "stt_engine": stt_engine.ENGINE,
        "dubbing": "ready",
        "dubbing_translation": "argos-translate not installed — same-language dubs only",
        "studio": "ready",
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


@app.post("/api/auth/change-password")
def change_password(req: ChangePasswordRequest, authorization: str | None = Header(default=None)):
    """Logged-in password change. Wrong current password -> 401 with the
    same generic message as login; too-short new password -> 400."""
    user = _require_user(authorization)
    try:
        accounts.change_password(user["id"], req.current_password, req.new_password)
    except accounts.AuthError as exc:
        msg = str(exc)
        if msg == "Username ya password ghalat hai.":
            raise HTTPException(status_code=401, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
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


# ---- Kokoro model files (v0.6.0) ----
@app.get("/api/models/status")
def models_status():
    """Public: Kokoro model download state + whether the files are present.
    No auth — the frontend engine pill reads this on load."""
    return {
        **models_downloader.status(),
        "model_files_present": tts_engine.model_files_present(),
    }


@app.post("/api/models/download")
def models_download(request: Request):
    """Local-only (127.0.0.1 / ::1, like /api/update/apply): start the
    background Kokoro model download. Idempotent — already downloading
    or already complete returns started=False with the current status."""
    host = request.client.host if request.client else None
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Model download sirf is machine se (127.0.0.1) allowed hai.")
    started = models_downloader.start_download()
    return {"started": started, "status": models_downloader.status()}


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


# ---- Speech-to-text (free; history only when logged in) ----
@app.post("/api/stt")
async def stt(
    authorization: str | None = Header(default=None),
    audio: UploadFile = File(...),
):
    """Transcribe uploaded audio with faster-whisper (tiny, CPU).
    Returns transcript + detected language + timestamped segments.
    No credits charged. Logged-in users get the result saved to history."""
    user = _current_user(authorization)
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio file is missing.")
    suffix = Path(audio.filename).suffix.lower()
    if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}:
        raise HTTPException(status_code=400, detail="Unsupported audio format — use WAV or MP3.")
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Audio file is empty.")
    if len(data) > stt_engine.MAX_AUDIO_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"Audio is too large (max {stt_engine.MAX_AUDIO_MB} MB).")
    with tempfile.TemporaryDirectory(prefix="awaazai-stt-") as td:
        workdir = Path(td)
        src = workdir / f"input{suffix}"
        src.write_bytes(data)
        try:
            result = stt_engine.transcribe(src, workdir)
        except stt_engine.STTValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except stt_engine.STTUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=f"Speech-to-text failed: {exc}")
    if user is not None and result["text"]:
        accounts.add_history(user["id"], "stt", result["text"], "faster-whisper-tiny",
                             result["language"], 0, result["duration_seconds"], None)
    return result


# ---- Dubbing (login required, 20 credits) ----
@app.post("/api/dub")
async def dub(
    authorization: str | None = Header(default=None),
    audio: UploadFile = File(...),
    target_language: str = Form("en"),
    voice: str = Form("af_heart"),
    saved_voice_id: int | None = Form(default=None),
    consent: bool = Form(False),
):
    """Dubbing pipeline: STT transcribe -> translate -> re-voice.
    Same source/target language = no translation, re-voiced as-is.
    Cross-language translation needs argos-translate + the pair
    installed; if not, returns 501 WITH the transcript (no credits
    charged, nothing faked). Re-voicing: Kokoro voice, or a saved
    cloned voice (consent required, Qwen, English-style languages)."""
    user = _require_user(authorization)
    target_language = (target_language or "en").strip().lower()
    if not audio.filename:
        raise HTTPException(status_code=400, detail="Audio file is missing.")
    suffix = Path(audio.filename).suffix.lower()
    if suffix not in {".wav", ".mp3", ".flac", ".ogg", ".m4a"}:
        raise HTTPException(status_code=400, detail="Unsupported audio format — use WAV or MP3.")
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Audio file is empty.")
    if len(data) > stt_engine.MAX_AUDIO_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail=f"Audio is too large (max {stt_engine.MAX_AUDIO_MB} MB).")
    saved_voice = None
    if saved_voice_id is not None:
        if not consent:
            raise HTTPException(status_code=400, detail="Consent is required to re-voice with a saved cloned voice.")
        saved_voice = accounts.get_saved_voice(user["id"], saved_voice_id)
        if saved_voice is None:
            raise HTTPException(status_code=404, detail="Saved voice nahi mili.")

    with tempfile.TemporaryDirectory(prefix="awaazai-dub-") as td:
        workdir = Path(td)
        src = workdir / f"input{suffix}"
        src.write_bytes(data)
        try:
            result = stt_engine.transcribe(src, workdir)
        except stt_engine.STTValidationError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
        except stt_engine.STTUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc))
        except RuntimeError as exc:
            raise HTTPException(status_code=502, detail=f"Speech-to-text failed: {exc}")
        transcript = result["text"]
        source_lang = result["language"]
        if not transcript:
            raise HTTPException(
                status_code=400,
                detail="No speech was detected in the audio — transcript khaali hai, dubbing nahi ho sakti.",
            )
        # Translation step — before any credits are charged.
        try:
            translated, method = translate.translate(transcript, source_lang, target_language)
        except translate.TranslationUnavailable as exc:
            return JSONResponse(
                status_code=501,
                content={
                    "detail": str(exc),
                    "transcript": transcript,
                    "detected_language": source_lang,
                    "target_language": target_language,
                    "translation_available": False,
                    "credits_charged": 0,
                },
            )
        # Re-voice step — credits charged here, refunded on failure.
        try:
            balance = accounts.deduct_credits(user["id"], accounts.DUB_COST)
        except accounts.AuthError as exc:
            raise HTTPException(status_code=402, detail=str(exc))
        try:
            if saved_voice is not None:
                if len(translated) > clone_engine.MAX_TEXT_CHARS:
                    raise ValueError(
                        f"Dubbed text is too long for a cloned voice "
                        f"({len(translated)} chars, max {clone_engine.MAX_TEXT_CHARS}). "
                        "Use a Kokoro voice for long dubs."
                    )
                ref_path = Path(saved_voice["file_path"])
                if not ref_path.exists():
                    raise ValueError("Saved voice ki audio file nahi mili.")
                wav_bytes, sample_rate = clone_engine.clone(
                    ref_path, translated, target_language, consent)
                voice_label = saved_voice["name"]
                engine_label = "qwen3-tts-0.6b-base"
            else:
                wav_bytes, sample_rate, _chapters = studio.synthesize_long(
                    translated, voice, 1.0)
                voice_label = voice
                engine_label = "kokoro-82m"
        except clone_engine.CloneValidationError as exc:
            accounts.refund_credits(user["id"], accounts.DUB_COST)
            msg = str(exc)
            code = 422 if msg.startswith(("Urdu is not supported", "Unsupported language")) else 400
            raise HTTPException(status_code=code, detail=msg)
        except clone_engine.CloneUnavailable as exc:
            accounts.refund_credits(user["id"], accounts.DUB_COST)
            raise HTTPException(status_code=503, detail=str(exc))
        except (ValueError, RuntimeError) as exc:
            accounts.refund_credits(user["id"], accounts.DUB_COST)
            raise HTTPException(status_code=400 if isinstance(exc, ValueError) else 502,
                                detail=str(exc))
    file_path = _save_generated(user["id"], "dub", wav_bytes)
    accounts.add_history(user["id"], "dub", translated, voice_label, target_language,
                         accounts.DUB_COST, _wav_duration(wav_bytes), file_path)
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'attachment; filename="awaazai-dub.wav"',
            "X-Sample-Rate": str(sample_rate),
            "X-Engine": engine_label,
            "X-Transcript": quote(transcript, safe=""),
            "X-Translation": quote(translated, safe=""),
            "X-Detected-Language": source_lang,
            "X-Translation-Method": method,
            "X-Credits-Remaining": str(balance),
        },
    )


# ---- Studio (login required, TTS rate) ----
@app.post("/api/studio")
def studio_generate(req: StudioRequest, authorization: str | None = Header(default=None)):
    """Long-form TTS: up to 5000 chars, chunked at sentence boundaries,
    one concatenated WAV + chapter markers (chunk start times)."""
    user = _require_user(authorization)
    cost = accounts.tts_cost(req.text)
    try:
        balance = accounts.deduct_credits(user["id"], cost)
    except accounts.AuthError as exc:
        raise HTTPException(status_code=402, detail=str(exc))
    try:
        wav_bytes, sample_rate, chapters = studio.synthesize_long(req.text, req.voice, req.speed)
    except ValueError as exc:
        accounts.refund_credits(user["id"], cost)
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        accounts.refund_credits(user["id"], cost)
        raise HTTPException(status_code=503, detail=str(exc))
    file_path = _save_generated(user["id"], "studio", wav_bytes)
    accounts.add_history(user["id"], "studio", req.text, req.voice, "en",
                         cost, _wav_duration(wav_bytes), file_path)
    return Response(
        content=wav_bytes,
        media_type="audio/wav",
        headers={
            "Content-Disposition": 'attachment; filename="awaazai-studio.wav"',
            "X-Sample-Rate": str(sample_rate),
            "X-Engine": "kokoro-82m",
            "X-Chapters": quote(json.dumps(chapters), safe=""),
            "X-Chunks": str(len(chapters)),
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


# ---- In-app update (v0.5.0) ----
# Honest flow: check + git pull + prompt restart. The running uvicorn
# process cannot safely restart itself from inside, so after a successful
# pull the user restarts the server (Ctrl+C, phir start.bat) — the button
# never claims an auto-restart it did not do.
# Safety: `git pull` only touches tracked files. data/ (SQLite + history
# audio), models/ and .venv/ are gitignored, so a pull NEVER deletes them.
def _parse_version(s: str) -> tuple:
    try:
        return tuple(int(x) for x in str(s).lstrip("v").split(".")[:3])
    except Exception:
        return (0, 0, 0)


@app.get("/api/update/check")
def update_check():
    """Latest GitHub release vs current version. Offline/API fail -> 200
    with an error field, never a crash."""
    try:
        req = urllib.request.Request(
            "https://api.github.com/repos/hamxa8769/awaazai/releases/latest",
            headers={"User-Agent": "AwaazAI-Updater", "Accept": "application/vnd.github+json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        latest = str(data.get("tag_name", "")).lstrip("v") or None
        return {
            "current": VERSION,
            "latest": latest,
            "update_available": bool(latest) and _parse_version(latest) > _parse_version(VERSION),
        }
    except Exception as exc:  # offline, DNS, rate limit, bad JSON — all honest 200
        return {"current": VERSION, "latest": None, "update_available": False, "error": str(exc)}


@app.post("/api/update/apply")
def update_apply(request: Request):
    """Local-only: only 127.0.0.1 / ::1 may pull. Runs `git pull origin main`
    (timeout 120s). Returns needs_restart=True — the user restarts the
    server; this endpoint never restarts the process itself."""
    host = request.client.host if request.client else None
    if host not in ("127.0.0.1", "::1", "localhost"):
        raise HTTPException(status_code=403, detail="Update sirf is machine se (127.0.0.1) allowed hai.")
    if not (BASE_DIR / ".git").exists():
        return JSONResponse(
            status_code=501,
            content={
                "updated": False,
                "needs_restart": False,
                "detail": "Ye folder git repo nahi hai (zip download). Manual update: git clone https://github.com/hamxa8769/awaazai.git karein, ya naya zip download karke models/ aur data/ copy karein.",
            },
        )
    try:
        proc = subprocess.run(
            ["git", "pull", "origin", "main"],
            cwd=str(BASE_DIR), capture_output=True, text=True, timeout=120,
        )
        output = ((proc.stdout or "") + (proc.stderr or "")).strip()[:2000]
        return {
            "updated": proc.returncode == 0,
            "needs_restart": True,
            "output": output,
            "detail": "Update ho gaya — server restart karein (Ctrl+C, phir start.bat), phir page refresh karein."
            if proc.returncode == 0
            else "git pull fail hua — output neeche dekhein, server waisa hi chal raha hai.",
        }
    except subprocess.TimeoutExpired:
        return {"updated": False, "needs_restart": False, "output": "", "detail": "git pull 120 second mein mukammal nahi hua (timeout). Server waisa hi chal raha hai."}
    except Exception as exc:
        return {"updated": False, "needs_restart": False, "output": "", "detail": f"Update fail: {exc}"}


# Frontend (landing page + demo) and logo, served from the same server.
app.mount("/assets", StaticFiles(directory=BASE_DIR / "assets"), name="assets")
app.mount("/samples", StaticFiles(directory=BASE_DIR / "samples"), name="samples")
app.mount("/", StaticFiles(directory=BASE_DIR / "frontend", html=True), name="frontend")
