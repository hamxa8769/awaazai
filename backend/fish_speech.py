"""AwaazAI Fish Speech S2 — natural-Urdu path (NOT installed yet).

Fish Speech S2 lists Urdu (`ur`) among 80+ languages and sounds more
natural than Piper, but it is a ~4B-parameter model: it needs a GPU
(12 GB+ VRAM recommended), ~10 GB disk for weights, and the
``fish-speech`` package. Its licence is research / non-commercial —
do NOT use it in a paid product without a licence check.

This module does NOT install or run Fish Speech. It only runs the
REAL readiness check this machine can answer honestly:

- GPU present? (nvidia-smi, torch.cuda, /dev/nvidia*)
- fish-speech package installed?
- weights downloaded? (models/fish-speech/)
- RAM / disk free?

``GET /api/fish-speech/status`` returns that check. The frontend
"Test" button just re-runs this check — it never fakes a generation.
A Fish Speech voice is added to TTS only if a real generation test
passes on a GPU machine; until then the UI shows "GPU test pending".
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
WEIGHTS_DIR = BASE_DIR / "models" / "fish-speech"

# Fish Speech S2, rough published requirements (honest, from its docs):
# ~4B parameters, GPU with 12 GB+ VRAM recommended, ~10 GB disk.
REQUIRED_VRAM_GB = 12
REQUIRED_DISK_GB = 10


def _gpu_info() -> dict:
    """Detect an NVIDIA GPU honestly. Returns {present, name, vram_gb}."""
    # 1. nvidia-smi (most reliable when present)
    smi = shutil.which("nvidia-smi")
    if smi:
        try:
            out = subprocess.run(
                [smi, "--query-gpu=name,memory.total", "--format=csv,noheader"],
                capture_output=True, text=True, timeout=10,
            ).stdout.strip()
            if out:
                name, _, mem = out.split(",", 2)
                mem_mb = int("".join(c for c in mem if c.isdigit()))
                return {"present": True, "name": name.strip(),
                        "vram_gb": round(mem_mb / 1024, 1), "via": "nvidia-smi"}
        except Exception:
            pass
    # 2. torch.cuda (if torch happens to be installed)
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            props = torch.cuda.get_device_properties(0)
            return {"present": True, "name": props.name,
                    "vram_gb": round(props.total_memory / (1024 ** 3), 1),
                    "via": "torch.cuda"}
    except Exception:
        pass
    # 3. /dev/nvidia* device nodes
    if list(Path("/dev").glob("nvidia*")):
        return {"present": True, "name": "NVIDIA GPU (device node only)",
                "vram_gb": None, "via": "/dev/nvidia*"}
    return {"present": False, "name": None, "vram_gb": None, "via": None}


def _ram_gb() -> float | None:
    try:
        with open("/proc/meminfo") as fh:
            for line in fh:
                if line.startswith("MemTotal:"):
                    return round(int(line.split()[1]) / 1024 / 1024, 1)
    except Exception:
        return None
    return None


def _disk_free_gb(path: Path) -> float | None:
    try:
        usage = shutil.disk_usage(path)
        return round(usage.free / (1024 ** 3), 1)
    except Exception:
        return None


def status() -> dict:
    """Real readiness check — no generation, no install, no fake data."""
    gpu = _gpu_info()
    package_installed = importlib.util.find_spec("fish_speech") is not None
    weights = sorted(p.name for p in WEIGHTS_DIR.iterdir()) if WEIGHTS_DIR.exists() else []
    ram = _ram_gb()
    disk = _disk_free_gb(BASE_DIR)
    ready = bool(
        gpu["present"]
        and (gpu.get("vram_gb") or 0) >= REQUIRED_VRAM_GB
        and package_installed
        and weights
    )
    if not gpu["present"]:
        verdict = ("GPU test pending — is machine par koi GPU nahi hai. "
                   "Fish Speech S2 (~4B parameters) GPU ke baghair nahi chalega.")
    elif (gpu.get("vram_gb") or 0) < REQUIRED_VRAM_GB:
        verdict = (f"GPU mil gaya ({gpu['name']}, {gpu.get('vram_gb')} GB VRAM) "
                   f"lekin {REQUIRED_VRAM_GB} GB VRAM chahiye — kam VRAM par "
                   "Fish Speech reliable nahi chalega.")
    elif not package_installed:
        verdict = "GPU ready hai, lekin fish-speech package install nahi hai."
    elif not weights:
        verdict = "GPU + package ready hain, lekin Fish Speech weights download nahi hain."
    else:
        verdict = "Ready — GPU, package aur weights sab maujood hain."
    return {
        "engine": "fish-speech S2",
        "state": "ready" if ready else "not-ready",
        "verdict": verdict,
        "gpu": gpu,
        "package_installed": package_installed,
        "weights_dir": str(WEIGHTS_DIR),
        "weights": weights,
        "ram_gb": ram,
        "disk_free_gb": disk,
        "requirements": {
            "vram_gb": REQUIRED_VRAM_GB,
            "disk_gb": REQUIRED_DISK_GB,
            "ram_note": "CPU-only machine par 4B model RAM mein nahi samayega — GPU zaroori hai.",
        },
        "licence": ("Research / non-commercial — paid product mein use se "
                    "pehle licence check zaroori hai."),
        "urdu_support": "Urdu (ur) listed among 80+ languages, quality Tier 3 (varies by language).",
        "generation_tested": False,
        "note": ("Ye endpoint sirf readiness check karta hai — koi audio "
                 "generate nahi karta. Voice option tab hi milega jab GPU "
                 "machine par asal generation test pass ho."),
    }
