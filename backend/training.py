"""AwaazAI own-voice training — intake + validation + queue (honest).

Training a voice on YOUR recordings is the most natural path, but
training itself is a heavy GPU job — it does NOT run instantly on a
laptop CPU, and this module never claims it does. What it DOES do:

1. Intake: logged-in users upload clean recordings (WAV/MP3/FLAC/OGG/M4A).
2. Validation (real, per file): duration, sample rate, channels, RMS
   loudness and silence ratio — mostly-silent or too-short files are
   rejected / warned about with exact numbers.
3. Storage: files live under data/training/<user_id>/ (gitignored),
   with a manifest.json per user (recordings + totals + queue state).
4. Queue: once recordings pass validation, the user can press
   "Request training" — the job is marked queued with an honest note
   (GPU server + time needed). No fake "training running" state.

Guide (shown in the UI): 30+ minutes of clean audio, one speaker,
no background noise/music, normal speed, quiet room. The 30-minute
goal is tracked live (total recorded minutes vs goal).
"""
from __future__ import annotations

import json
import secrets
from pathlib import Path

import soundfile as sf

BASE_DIR = Path(__file__).resolve().parent.parent
TRAINING_DIR = BASE_DIR / "data" / "training"

ALLOWED_SUFFIXES = {".wav", ".mp3", ".flac", ".ogg", ".m4a"}
MAX_FILE_MB = 100
GOAL_SECONDS = 30 * 60  # 30 minutes of clean audio
MIN_CLIP_SECONDS = 3.0
MIN_SAMPLE_RATE = 8000


def _user_dir(user_id: int) -> Path:
    folder = TRAINING_DIR / str(user_id)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _manifest_path(user_id: int) -> Path:
    return _user_dir(user_id) / "manifest.json"


def load_manifest(user_id: int) -> dict:
    path = _manifest_path(user_id)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("recordings"), list):
                return data
        except Exception:
            pass
    return {"recordings": [], "training_queued": False, "goal_seconds": GOAL_SECONDS}


def _save_manifest(user_id: int, manifest: dict) -> None:
    _manifest_path(user_id).write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")


def validate_audio(path: Path) -> dict:
    """Real checks on one audio file. Returns metrics + warnings.
    Raises ValueError on a hard failure (unreadable / too short / bad rate)."""
    try:
        info = sf.info(str(path))
    except Exception as exc:
        raise ValueError(f"Audio read nahi ho saki: {exc}")
    if info.duration < MIN_CLIP_SECONDS:
        raise ValueError(
            f"Recording bohat chhoti hai ({info.duration:.1f}s) — kam az kam "
            f"{MIN_CLIP_SECONDS:.0f} second ki clip chahiye.")
    if info.samplerate < MIN_SAMPLE_RATE:
        raise ValueError(
            f"Sample rate bohat kam hai ({info.samplerate} Hz) — kam az kam "
            f"{MIN_SAMPLE_RATE} Hz chahiye.")
    warnings: list[str] = []
    rms_db = None
    silence_ratio = None
    try:
        data, sr = sf.read(str(path), always_2d=True)
        import numpy as np

        mono = data[:, 0].astype("float64")
        rms = float(np.sqrt(np.mean(mono ** 2))) if mono.size else 0.0
        import math

        rms_db = round(20 * math.log10(rms), 1) if rms > 0 else -120.0
        # Silence = frames quieter than -40 dBFS, measured in 50 ms windows.
        frame = max(1, int(sr * 0.05))
        n = max(1, len(mono) // frame)
        quiet = 0
        for i in range(n):
            seg = mono[i * frame:(i + 1) * frame]
            seg_rms = float(np.sqrt(np.mean(seg ** 2))) if seg.size else 0.0
            if seg_rms < 0.01:
                quiet += 1
        silence_ratio = round(quiet / n, 2)
        if silence_ratio > 0.7:
            warnings.append(
                f"Recording ka {int(silence_ratio * 100)}% hissa khamosh hai — "
                "bolte waqt record karein, khaali hissa training mein madad nahi karega.")
        if rms_db < -30:
            warnings.append(
                f"Awaz bohat halki hai (RMS {rms_db} dB) — mic ke qareeb aur "
                "zor se bolein.")
    except ValueError:
        raise
    except Exception:
        pass  # metrics are best-effort; duration/rate already validated
    return {
        "duration_seconds": round(info.duration, 2),
        "sample_rate": info.samplerate,
        "channels": info.channels,
        "format": info.format,
        "rms_db": rms_db,
        "silence_ratio": silence_ratio,
        "warnings": warnings,
    }


def add_recording(user_id: int, original_name: str, data: bytes,
                  suffix: str) -> dict:
    """Validate + store one recording. Returns the manifest entry."""
    folder = _user_dir(user_id)
    stored_name = f"rec-{secrets.token_hex(8)}{suffix}"
    path = folder / stored_name
    path.write_bytes(data)
    try:
        metrics = validate_audio(path)
    except ValueError:
        path.unlink(missing_ok=True)
        raise
    manifest = load_manifest(user_id)
    entry = {
        "name": stored_name,
        "original_name": original_name,
        "size_bytes": len(data),
        "status": "received",
        **metrics,
    }
    manifest["recordings"].append(entry)
    _save_manifest(user_id, manifest)
    return entry


def list_recordings(user_id: int) -> list[dict]:
    return load_manifest(user_id)["recordings"]


def delete_recording(user_id: int, name: str) -> bool:
    """Delete one recording by stored name (basename only — no traversal)."""
    safe = Path(name).name
    if safe != name or not safe.startswith("rec-"):
        return False
    manifest = load_manifest(user_id)
    kept = [r for r in manifest["recordings"] if r["name"] != safe]
    if len(kept) == len(manifest["recordings"]):
        return False
    manifest["recordings"] = kept
    if not kept:
        manifest["training_queued"] = False
    _save_manifest(user_id, manifest)
    try:
        (_user_dir(user_id) / safe).unlink(missing_ok=True)
    except OSError:
        pass
    return True


def status(user_id: int) -> dict:
    manifest = load_manifest(user_id)
    recordings = manifest["recordings"]
    total = round(sum(r.get("duration_seconds", 0) for r in recordings), 1)
    goal = manifest.get("goal_seconds", GOAL_SECONDS)
    return {
        "recordings": recordings,
        "count": len(recordings),
        "total_seconds": total,
        "total_minutes": round(total / 60, 1),
        "goal_seconds": goal,
        "goal_minutes": round(goal / 60, 1),
        "goal_reached": total >= goal,
        "training_queued": bool(manifest.get("training_queued")),
        "training_note": (
            "Training GPU ka kaam hai — laptop CPU par instant nahi hota. "
            "Recordings queue mein jayengi; training GPU server par hogi aur "
            "waqt lagega. Queue karne ke baad status yahin dikhega."
            if manifest.get("training_queued") else
            "Training abhi shuru nahi hui — pehle recordings upload karein."
        ),
    }


def request_training(user_id: int) -> dict:
    """Mark the job queued. Requires at least 60 s of validated audio —
    below that the request is refused honestly (too little data)."""
    manifest = load_manifest(user_id)
    total = sum(r.get("duration_seconds", 0) for r in manifest["recordings"])
    if total < 60:
        raise ValueError(
            f"Training ke liye kam az kam 60 second audio chahiye — abhi "
            f"sirf {total:.0f} second hai. Pehle aur recordings upload karein.")
    manifest["training_queued"] = True
    _save_manifest(user_id, manifest)
    return status(user_id)
