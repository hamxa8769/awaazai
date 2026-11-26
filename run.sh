#!/bin/bash
# AwaazAI dev server — http://127.0.0.1:8000
# Uses .venv if present, otherwise system python.
set -e
cd "$(dirname "$0")"
if [ -x .venv/bin/uvicorn ]; then
  exec .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
else
  exec python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
fi
