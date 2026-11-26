# Changelog — AwaazAI

Version rule (Muuk jaisa): har release mein **VERSION bump + git tag + is
CHANGELOG mein entry**. Bina tag ke koi release nahi.

## [0.2.0] — 2026-11-26

Voice Cloning (code + UI + API) aur Phase 0 Urdu tests.

### Added
- `POST /api/clone` (multipart) — reference audio (WAV/MP3, 3–30 s) +
  text (max 500 chars) + language + consent → WAV in the cloned voice.
  Engine: Qwen3-TTS 0.6B CustomVoice via qwentts.cpp (GGUF Q8_0, CPU).
  Consent mandatory hai — bina ijazat kisi aur ki awaz clone karna block.
- `GET /api/clone/status` — engine state (binary/weights), supported
  languages, Urdu note.
- Frontend Clone section — upload, text, language picker (Urdu option
  par saaf warning), consent checkbox, Generate, play/download.
- `backend/clone_engine.py` — engine layer (validation, ffmpeg
  normalisation to 24 kHz mono, 503 when engine not installed, 422 for
  Urdu / unsupported language, 400 for missing audio/text/consent).
- `docs/phase0-urdu-tests.md` — Phase 0 verdict, honestly recorded.
- `samples/v0.2.0/ref-en-af_heart.wav` — real Kokoro reference audio
  (4.78 s) for the future clone test.
- `python-multipart` dependency (UploadFile), `.gitignore` mein `tools/`
  aur `samples/**/*.wav` allowance.

### Phase 0 verdict (docs/phase0-urdu-tests.md mein tafseel)
- **Qwen3-TTS Urdu: FAIL by design** — Qwen ki 10 languages mein Urdu
  nahi hai. `/api/clone` par `language=ur` 422 deta hai.
- **English clone: NOT RUN on this VM** — code complete aur validation
  tested hai, lekin qwentts.cpp ka build ek execution-risk check par
  ruka hai; user ki explicit approval chahiye. Koi cloned wav nahi
  banaya gaya, koi fake audio nahi.
- **Fish Speech S2: Urdu candidate (docs check)** — 80+ languages,
  Urdu listed, Tier 3 (quality varies). ~4B params, GPU chahiye,
  licence research / non-commercial — product mein nahi, Phase 2 mein
  GPU par test hoga.

### Tested (v0.2.0 server, this VM)
- `GET /api/health` → 200, cloning "not-installed"; `GET /api/voices` → 54;
  `POST /api/tts` → 200, real Kokoro WAV (2.01 s, 24 kHz) — TTS regression pass.
- Clone validation: no consent → 400; `language=ur` → 422;
  engine not installed → 503; missing file field → 422; landing `/` → 200.

### Not yet
- Cloning engine install (approval ke baad) + real English clone sample.
- Urdu cloning (Fish Speech GPU test, Phase 2), login/history, credits,
  dubbing/Studio.

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
