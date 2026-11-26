"""AwaazAI Kokoro model downloader — stdlib only (urllib).

Downloads kokoro-v1.0.onnx + voices-v1.0.bin from the kokoro-onnx
model-files-v1.0 GitHub release into models/ (BASE_DIR/models).

- Background thread, one at a time (start_download is idempotent).
- Downloads to <name>.part, then an atomic rename on completion.
- Resume: an existing .part is continued with a Range request when
  the server honours it (206); otherwise the file restarts from 0.
- On error the .part is kept (so a later run can resume) and the
  error is reported honestly in status(); a good complete file is
  never deleted or overwritten.
- Verify after download: file exists and size > 1 MB.

State is in-memory only; status() also reconciles with disk, so a
file that is already complete on disk is reported done even if this
process never downloaded it.
"""
from __future__ import annotations

import os
import threading
import urllib.error
import urllib.request
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MODELS_DIR = BASE_DIR / "models"

RELEASE_BASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"

FILE_NAMES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")

MIN_COMPLETE_SIZE = 1 * 1024 * 1024  # 1 MB — a real model file is far larger
CHUNK_SIZE = 1024 * 1024  # 1 MB chunks

_lock = threading.RLock()  # RLock: start_download() calls status() while holding it
_thread: threading.Thread | None = None

# Per-file state: {name, url, size_bytes, downloaded_bytes, status, error}
# status: missing | downloading | done | error
_state: dict[str, dict] = {}


def _default_files() -> list[dict]:
    return [
        {"name": name, "url": f"{RELEASE_BASE}/{name}"}
        for name in FILE_NAMES
    ]


def _file_state(name: str, url: str, models_dir: Path) -> dict:
    """Reconcile one file's in-memory state with what is on disk."""
    target = models_dir / name
    part = models_dir / f"{name}.part"
    prev = _state.get(name, {})
    if target.exists() and target.stat().st_size > MIN_COMPLETE_SIZE:
        size = target.stat().st_size
        return {
            "name": name,
            "url": url,
            "size_bytes": size,
            "downloaded_bytes": size,
            "status": "done",
            "error": None,
        }
    if prev.get("status") == "downloading":
        return prev
    if prev.get("status") == "error":
        downloaded = part.stat().st_size if part.exists() else 0
        return {**prev, "downloaded_bytes": downloaded}
    if part.exists():
        return {
            "name": name,
            "url": url,
            "size_bytes": prev.get("size_bytes"),
            "downloaded_bytes": part.stat().st_size,
            "status": "missing",
            "error": None,
        }
    return {
        "name": name,
        "url": url,
        "size_bytes": None,
        "downloaded_bytes": 0,
        "status": "missing",
        "error": None,
    }


def status(models_dir: Path | None = None, files: list[dict] | None = None) -> dict:
    """Current download state. `models_dir`/`files` are test hooks only;
    production callers use status() with no arguments."""
    models_dir = Path(models_dir) if models_dir is not None else MODELS_DIR
    file_defs = files if files is not None else _default_files()
    with _lock:
        infos = []
        for f in file_defs:
            info = _file_state(f["name"], f["url"], models_dir)
            _state[f["name"]] = info
            infos.append(dict(info))
    total = sum(i["size_bytes"] or i["downloaded_bytes"] for i in infos)
    downloaded = sum(i["downloaded_bytes"] for i in infos)
    return {
        "files": infos,
        "total_bytes": total,
        "downloaded_bytes": downloaded,
        "complete": all(i["status"] == "done" for i in infos),
        "downloading": any(i["status"] == "downloading" for i in infos),
        "engine_ready": all(i["status"] == "done" for i in infos),
    }


def _download_one(name: str, url: str, models_dir: Path) -> None:
    """Download one file (called on the worker thread). Raises on failure."""
    target = models_dir / name
    part = models_dir / f"{name}.part"
    models_dir.mkdir(parents=True, exist_ok=True)

    if target.exists() and target.stat().st_size > MIN_COMPLETE_SIZE:
        with _lock:
            _state[name] = _file_state(name, url, models_dir)
        return

    resume_from = part.stat().st_size if part.exists() else 0
    req = urllib.request.Request(url, headers={"User-Agent": "AwaazAI-ModelDownloader"})
    if resume_from > 0:
        req.add_header("Range", f"bytes={resume_from}-")
    try:
        resp = urllib.request.urlopen(req, timeout=60)
    except Exception as exc:
        raise RuntimeError(f"Download start failed for {name}: {exc}") from exc

    with resp:
        # 206 = server honoured Range (resume); 200 = full file, restart.
        if resp.status == 206 and resume_from > 0:
            mode = "ab"
            content_len = resp.headers.get("Content-Length")
            total = resume_from + int(content_len) if content_len else None
        else:
            mode = "wb"
            resume_from = 0
            content_len = resp.headers.get("Content-Length")
            total = int(content_len) if content_len else None
        with _lock:
            _state[name] = {
                "name": name, "url": url, "size_bytes": total,
                "downloaded_bytes": resume_from, "status": "downloading",
                "error": None,
            }
        downloaded = resume_from
        try:
            with open(part, mode) as fh:
                while True:
                    chunk = resp.read(CHUNK_SIZE)
                    if not chunk:
                        break
                    fh.write(chunk)
                    downloaded += len(chunk)
                    with _lock:
                        _state[name]["downloaded_bytes"] = downloaded
                        if total is not None:
                            _state[name]["size_bytes"] = total
        except Exception as exc:
            raise RuntimeError(f"Download interrupted for {name}: {exc}") from exc

    # Verify, then atomic rename (.part -> final, same filesystem).
    if not part.exists() or part.stat().st_size <= MIN_COMPLETE_SIZE:
        size = part.stat().st_size if part.exists() else 0
        raise RuntimeError(
            f"Downloaded {name} failed verification: {size} bytes (need > 1 MB)."
        )
    os.replace(part, target)
    with _lock:
        _state[name] = _file_state(name, url, models_dir)


def _worker(models_dir: Path, file_defs: list[dict]) -> None:
    for f in file_defs:
        name, url = f["name"], f["url"]
        with _lock:
            cur = _state.get(name, {})
            if cur.get("status") == "done":
                continue
            _state[name] = {
                "name": name, "url": url,
                "size_bytes": cur.get("size_bytes"),
                "downloaded_bytes": cur.get("downloaded_bytes", 0),
                "status": "downloading", "error": None,
            }
        try:
            _download_one(name, url, models_dir)
        except Exception as exc:
            # Keep .part for resume; report the error honestly.
            with _lock:
                part = models_dir / f"{name}.part"
                _state[name] = {
                    "name": name, "url": url,
                    "size_bytes": _state[name].get("size_bytes"),
                    "downloaded_bytes": part.stat().st_size if part.exists() else 0,
                    "status": "error", "error": str(exc),
                }
            # Do not abort the other file because one failed.
            continue


def start_download(models_dir: Path | None = None,
                   files: list[dict] | None = None) -> bool:
    """Start the background download thread once. Returns True only if
    a thread was actually started; False if already downloading or
    everything is already complete. `models_dir`/`files` are test hooks."""
    global _thread
    models_dir = Path(models_dir) if models_dir is not None else MODELS_DIR
    file_defs = files if files is not None else _default_files()
    with _lock:
        if _thread is not None and _thread.is_alive():
            return False
        current = status(models_dir=models_dir, files=file_defs)
        if current["complete"]:
            return False
        _thread = threading.Thread(
            target=_worker, args=(models_dir, file_defs),
            name="awaazai-model-download", daemon=True,
        )
        _thread.start()
        return True


def is_downloading() -> bool:
    return _thread is not None and _thread.is_alive()
