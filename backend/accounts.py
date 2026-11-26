"""AwaazAI accounts — local-first, no external auth service, no payment.

SQLite database (stdlib only):
- users: username (unique), salted pbkdf2 password hash, credits.
  Passwords are NEVER stored in plain text and never logged.
- sessions: random bearer tokens (stored as sha256 hash), 30-day expiry.
- history: one row per successful TTS / Clone generation, owner-only.
- saved_voices: named cloned voices, reference audio on disk, owner-only.

DB location: data/awaazai.db by default (gitignored). Override with the
AWAAZAI_DB_PATH env var (tests use a temp file so they never touch the
real user database).
"""
from __future__ import annotations

import hashlib
import os
import secrets
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BASE_DIR / "data" / "awaazai.db"

INITIAL_CREDITS = 100
CLONE_COST = 10
DUB_COST = 20
SESSION_DAYS = 30

_lock = threading.Lock()


def db_path() -> Path:
    override = os.environ.get("AWAAZAI_DB_PATH")
    return Path(override) if override else DEFAULT_DB_PATH


def _connect() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with _lock, _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                salt TEXT NOT NULL,
                pw_hash TEXT NOT NULL,
                credits INTEGER NOT NULL DEFAULT 100,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                text_snippet TEXT NOT NULL,
                voice TEXT NOT NULL,
                language TEXT NOT NULL DEFAULT 'en',
                credits_cost INTEGER NOT NULL,
                duration_seconds REAL,
                file_path TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS saved_voices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                language TEXT NOT NULL DEFAULT 'en',
                file_path TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_password(password: str, salt: bytes) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000).hex()


def _valid_username(username: str) -> bool:
    if not (3 <= len(username) <= 30):
        return False
    return all(c.isalnum() or c in "_-" for c in username)


class AuthError(ValueError):
    """Signup / login failure (message is safe to show to the user)."""


def create_user(username: str, password: str) -> dict:
    username = (username or "").strip()
    if not _valid_username(username):
        raise AuthError("Username 3-30 characters ka ho, sirf letters, numbers, _ ya -.")
    if len(password or "") < 6:
        raise AuthError("Password kam se kam 6 characters ka ho.")
    salt = secrets.token_bytes(16)
    pw_hash = _hash_password(password, salt)
    init_db()
    with _lock, _connect() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO users (username, salt, pw_hash, credits, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (username, salt.hex(), pw_hash, INITIAL_CREDITS, _now()),
            )
            user_id = cur.lastrowid
        except sqlite3.IntegrityError:
            raise AuthError("Ye username pehle se liya hua hai — koi aur username chunein.")
    return get_user_by_id(user_id)


def get_user_by_id(user_id: int) -> dict | None:
    init_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, username, credits, created_at FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return dict(row) if row else None


def _issue_token(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires = (datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)).isoformat()
    with _lock, _connect() as conn:
        conn.execute(
            "INSERT INTO sessions (token_hash, user_id, created_at, expires_at)"
            " VALUES (?, ?, ?, ?)",
            (token_hash, user_id, _now(), expires),
        )
    return token


def login(username: str, password: str) -> tuple[dict, str]:
    username = (username or "").strip()
    init_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, username, salt, pw_hash, credits, created_at FROM users"
            " WHERE username = ?",
            (username,),
        ).fetchone()
    # Same error for unknown user / wrong password (no user enumeration).
    if row is None:
        raise AuthError("Username ya password ghalat hai.")
    if _hash_password(password, bytes.fromhex(row["salt"])) != row["pw_hash"]:
        raise AuthError("Username ya password ghalat hai.")
    user = {k: row[k] for k in ("id", "username", "credits", "created_at")}
    return user, _issue_token(row["id"])


def change_password(user_id: int, current_password: str, new_password: str) -> None:
    """Verify the current password (pbkdf2), then store a new salt+hash.
    Wrong current password raises AuthError with the same generic message
    as login (no user enumeration / no hint which part was wrong).
    New password must be at least 6 characters."""
    if len(new_password or "") < 6:
        raise AuthError("Password kam se kam 6 characters ka ho.")
    init_db()
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT salt, pw_hash FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        if row is None:
            raise AuthError("Username ya password ghalat hai.")
        if _hash_password(current_password or "", bytes.fromhex(row["salt"])) != row["pw_hash"]:
            raise AuthError("Username ya password ghalat hai.")
        salt = secrets.token_bytes(16)
        pw_hash = _hash_password(new_password, salt)
        conn.execute(
            "UPDATE users SET salt = ?, pw_hash = ? WHERE id = ?",
            (salt.hex(), pw_hash, user_id),
        )


def authenticate(token: str | None) -> dict | None:
    """Bearer token -> user dict, or None. Expired tokens are removed."""
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    init_db()
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?",
            (token_hash,),
        ).fetchone()
        if row is None:
            return None
        if row["expires_at"] < _now():
            conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            return None
    return get_user_by_id(row["user_id"])


def logout(token: str | None) -> None:
    if not token:
        return
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    init_db()
    with _lock, _connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))


def get_credits(user_id: int) -> int:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT credits FROM users WHERE id = ?", (user_id,)).fetchone()
    return row["credits"] if row else 0


def deduct_credits(user_id: int, amount: int) -> int:
    """Deduct if balance covers it; returns new balance. Raises AuthError
    (402 in the API) when the balance is too low. Atomic via one UPDATE."""
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute(
            "UPDATE users SET credits = credits - ? WHERE id = ? AND credits >= ?",
            (amount, user_id, amount),
        )
        if cur.rowcount == 0:
            raise AuthError(
                f"Credits kam hain — is generation ke liye {amount} credits chahiye."
            )
        row = conn.execute("SELECT credits FROM users WHERE id = ?", (user_id,)).fetchone()
    return row["credits"]


def refund_credits(user_id: int, amount: int) -> int:
    init_db()
    with _lock, _connect() as conn:
        conn.execute(
            "UPDATE users SET credits = credits + ? WHERE id = ?", (amount, user_id)
        )
        row = conn.execute("SELECT credits FROM users WHERE id = ?", (user_id,)).fetchone()
    return row["credits"]


def tts_cost(text: str) -> int:
    """1 credit per 100 characters, rounded up (min 1)."""
    import math

    return max(1, math.ceil(len(text or "") / 100))


def add_history(user_id: int, gen_type: str, text: str, voice: str, language: str,
                credits_cost: int, duration: float | None, file_path: str | None) -> int:
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute(
            "INSERT INTO history (user_id, type, text_snippet, voice, language,"
            " credits_cost, duration_seconds, file_path, created_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, gen_type, (text or "")[:200], voice, language,
             credits_cost, duration, file_path, _now()),
        )
        return cur.lastrowid


def list_history(user_id: int, limit: int = 50) -> list[dict]:
    init_db()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, type, text_snippet, voice, language, credits_cost,"
            " duration_seconds, file_path, created_at FROM history"
            " WHERE user_id = ? ORDER BY id DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["has_audio"] = bool(d["file_path"]) and Path(d["file_path"]).exists()
        out.append(d)
    return out


def delete_history(user_id: int, history_id: int) -> str | None:
    """Delete own history row; returns its file path (or None)."""
    init_db()
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT file_path FROM history WHERE id = ? AND user_id = ?",
            (history_id, user_id),
        ).fetchone()
        if row is None:
            return None
        conn.execute("DELETE FROM history WHERE id = ?", (history_id,))
    return row["file_path"]


def save_voice(user_id: int, name: str, language: str, file_path: str) -> dict:
    name = (name or "").strip()
    if not (1 <= len(name) <= 50):
        raise AuthError("Voice ka naam 1-50 characters ka ho.")
    init_db()
    with _lock, _connect() as conn:
        cur = conn.execute(
            "INSERT INTO saved_voices (user_id, name, language, file_path, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (user_id, name, language, file_path, _now()),
        )
        vid = cur.lastrowid
    return {"id": vid, "name": name, "language": language, "created_at": _now()}


def list_saved_voices(user_id: int) -> list[dict]:
    init_db()
    with _connect() as conn:
        rows = conn.execute(
            "SELECT id, name, language, created_at FROM saved_voices"
            " WHERE user_id = ? ORDER BY id DESC",
            (user_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def get_saved_voice(user_id: int, voice_id: int) -> dict | None:
    init_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT id, user_id, name, language, file_path, created_at"
            " FROM saved_voices WHERE id = ? AND user_id = ?",
            (voice_id, user_id),
        ).fetchone()
    return dict(row) if row else None


def delete_saved_voice(user_id: int, voice_id: int) -> str | None:
    init_db()
    with _lock, _connect() as conn:
        row = conn.execute(
            "SELECT file_path FROM saved_voices WHERE id = ? AND user_id = ?",
            (voice_id, user_id),
        ).fetchone()
        if row is None:
            return None
        conn.execute("DELETE FROM saved_voices WHERE id = ?", (voice_id,))
    return row["file_path"]
