# Changelog — AwaazAI

Version rule (Muuk jaisa): har release mein **VERSION bump + git tag + is
CHANGELOG mein entry**. Bina tag ke koi release nahi.

## [0.1.0] — 2026-11-26

Pehli release — MVP scaffold, local test pass, GitHub par public.

### Added
- FastAPI backend: `GET /api/health`, `GET /api/voices` (54 Kokoro voices),
  `POST /api/tts` (text → WAV, Kokoro-82M, CPU-only, laptop-safe).
- `POST /api/clone` — 501, honestly not implemented (Qwen3-TTS 0.6B planned).
- Landing page + TTS demo box (text, voice picker, speed, play/download),
  Voice Cloning / Dubbing / Studio as Coming Soon sections.
- AwaazAI logo (`assets/logo.png`, teal→violet sound-wave mic).
- `sample.wav` — real TTS sample, 4.33 s, 24 kHz, voice `af_heart`,
  is VM par generate hua aur `/api/tts` se dobara verify hua (same SHA-256).
- README (laptop setup, architecture, Phase 0 Urdu test plan), `run.sh`,
  `requirements.txt`, `.gitignore` (models/ aur .venv/ excluded).

### Not yet (aage ke versions mein)
- Voice cloning (Qwen3-TTS 0.6B), dubbing, Studio, login/history, credits.
- Phase 0 Urdu tests (Fish Speech / Qwen3-TTS / apni awaz ka Urdu clone).
