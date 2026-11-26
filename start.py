#!/usr/bin/env python3
"""AwaazAI start script — server start kare aur browser mein page khol de.

Usage:
    python3 start.py            # server http://127.0.0.1:8000 + browser khole
    python3 start.py --port 8001
    python3 start.py --no-browser

Kaam:
  1. Port 8000 busy ho to saaf error de (crash nahi, traceback nahi).
  2. uvicorn subprocess start kare (backend.main:app).
  3. /api/health poll karke server ready hone ka wait kare (max 60 s).
  4. Browser mein http://127.0.0.1:8000 khole. Headless machine par
     browser kholna fail ho to server band nahi hota — sirf URL print
     karke server chalata rehta hai.
  5. Ctrl+C par server cleanly band kare.

Sirf Python standard library use hoti hai — koi extra dependency nahi.
"""

from __future__ import annotations

import argparse
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
HEALTH_TIMEOUT_SECONDS = 60


def _find_windows_python() -> str | None:
    """Windows par asal Python dhoondho (Store stub ke baghair).

    `sys.executable` kabhi Microsoft Store alias
    (%LOCALAPPDATA%\\Microsoft\\WindowsApps\\python.exe) hota hai — wo
    asal Python nahi, Store kholta hai. Aisi soorat mein common install
    locations mein asal python.exe dhoondho. Non-Windows par None.
    v0.4.1: start.bat wala hi fallback, taake `python start.py` direct
    chalane par bhi Store stub se na phansein.
    """
    if os.name != "nt":
        return None
    import glob

    bases = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Python"),
        os.path.join(os.environ.get("USERPROFILE", ""), "AppData", "Local", "Programs", "Python"),
        os.environ.get("ProgramFiles", r"C:\Program Files"),
        r"C:\Python312",
        r"C:\Python311",
        r"C:\Python313",
        r"C:\Python314",
    ]
    candidates: list[str] = []
    for base in bases:
        if not base:
            continue
        candidates.extend(sorted(glob.glob(os.path.join(base, "Python3*", "python.exe"))))
        direct = os.path.join(base, "python.exe")
        if os.path.isfile(direct):
            candidates.append(direct)
    for cand in candidates:
        # Store stub 0-byte hota hai; asal python.exe ~100 KB hota hai.
        try:
            if os.path.isfile(cand) and os.path.getsize(cand) > 1000:
                return cand
        except OSError:
            continue
    return None


def pick_python() -> str:
    """Venv wala python prefer karo, warna jis python se ye script chali.

    Windows par agar sys.executable Store stub hai to common locations
    mein asal Python dhoondho (v0.4.1 fix — start.bat bhi yehi karta hai).
    """
    if os.name == "nt":
        venv_python = BASE_DIR / ".venv" / "Scripts" / "python.exe"
    else:
        venv_python = BASE_DIR / ".venv" / "bin" / "python"
    if venv_python.is_file():
        return str(venv_python)
    if os.name == "nt" and "WindowsApps" in sys.executable:
        found = _find_windows_python()
        if found:
            return found
    return sys.executable


def port_in_use(host: str, port: int) -> bool:
    """Port par kuch sun raha hai ya nahi — bind karke check karo."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind((host, port))
        except OSError:
            return True
    return False


def already_responding(url: str) -> bool:
    """Kya is port par AwaazAI pehle se chal raha hai?"""
    try:
        with urllib.request.urlopen(url, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def how_to_free_port(port: int) -> str:
    if os.name == "nt":
        return (
            f"  netstat -ano | findstr :{port}\n"
            "  Phir us PID ko Task Manager se band karein, ya:\n"
            f"  taskkill /PID <PID> /F\n"
            f"  Ya AwaazAI ko doosre port par chalaye: python start.py --port {port + 1}"
        )
    return (
        f"  lsof -i :{port}        # kaunsa process hai, ye dekhein\n"
        f"  fuser -k {port}/tcp     # us process ko band karein\n"
        f"  Ya AwaazAI ko doosre port par chalaye: python3 start.py --port {port + 1}"
    )


def wait_for_health(health_url: str, timeout: int = HEALTH_TIMEOUT_SECONDS) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(health_url, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="AwaazAI server start karo aur browser kholo.")
    parser.add_argument("--host", default=DEFAULT_HOST, help="Host (default: 127.0.0.1)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Port (default: 8000)")
    parser.add_argument("--no-browser", action="store_true", help="Browser mat kholo, sirf server chalao")
    args = parser.parse_args()

    os.chdir(BASE_DIR)
    url = f"http://{args.host}:{args.port}"
    health_url = f"{url}/api/health"

    print("AwaazAI start ho raha hai...", flush=True)

    # Pehli dafa models ka note — server phir bhi chalega, TTS tab kaam
    # karega jab models/ mein kokoro files hon (README > Quick start).
    kokoro_model = BASE_DIR / "models" / "kokoro-v1.0.onnx"
    if not kokoro_model.is_file():
        print("Note: models/kokoro-v1.0.onnx nahi mila — pehli dafa README ke", flush=True)
        print("Quick start se model files (~310 MB) models/ mein rakhein.", flush=True)
        print("Server phir bhi chalega; TTS model aane par kaam karega.", flush=True)

    # Port busy?
    if port_in_use(args.host, args.port):
        if already_responding(health_url):
            print(f"AwaazAI pehle se chal raha hai: {url}", flush=True)
            if not args.no_browser:
                try:
                    webbrowser.open(url)
                except Exception:
                    print(f"Browser khud kholein: {url}", flush=True)
            return 0
        print(f"Error: port {args.port} pehle se busy hai, aur wahan AwaazAI nahi chal raha.", flush=True)
        print("Port khaali karne ke liye:", flush=True)
        print(how_to_free_port(args.port), flush=True)
        return 1

    python = pick_python()
    cmd = [
        python, "-m", "uvicorn", "backend.main:app",
        "--host", args.host, "--port", str(args.port),
    ]
    try:
        proc = subprocess.Popen(cmd, cwd=str(BASE_DIR))
    except FileNotFoundError:
        print("Error: uvicorn nahi mila. Pehle dependencies install karein:")
        print("  python3 -m venv .venv")
        print("  .venv/bin/pip install -r requirements.txt   (Linux/mac)")
        print("  .venv\\Scripts\\pip install -r requirements.txt   (Windows)")
        return 1

    try:
        if not wait_for_health(health_url):
            print("Error: server 60 second mein ready nahi hua.", flush=True)
            print("Server band kar rahi hoon. Uvicorn ka output upar dekhein.", flush=True)
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
            return 1

        print()
        print(f"AwaazAI chal raha hai: {url}", flush=True)
        print("Band karne ke liye Ctrl+C dabayein.", flush=True)
        print()
        if not args.no_browser:
            try:
                opened = webbrowser.open(url)
            except Exception:
                opened = False
            if not opened:
                # Headless machine (koi browser nahi) — fail nahi hona,
                # server chalata rehna hai; user URL khud khol le.
                print(f"Browser khud kholein (headless machine par auto-open nahi hua): {url}", flush=True)

        proc.wait()
        return proc.returncode or 0
    except KeyboardInterrupt:
        print()
        print("Band kar rahi hoon... (Ctrl+C)", flush=True)
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()
        print("AwaazAI band ho gaya.", flush=True)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
