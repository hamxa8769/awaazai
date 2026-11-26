#!/bin/bash
# AwaazAI start script — Linux / macOS
# Server start kare, ready hone ka wait kare, browser mein page khole.
# Pehli dafa: .venv banaye + requirements install kare (sirf pehli dafa).
# Chalana:  ./start.sh
# Doosra port:  ./start.sh --port 8001
set -e
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 nahi mila. Pehle Python 3.11+ install karein."
  exit 1
fi

if [ ! -x .venv/bin/python ]; then
  echo "Pehli dafa setup ho raha hai: virtual environment bana rahi hoon..."
  python3 -m venv .venv
  echo "Dependencies install ho rahi hain (requirements.txt)..."
  .venv/bin/pip install -r requirements.txt
fi

exec .venv/bin/python -u start.py "$@"
