# AwaazAI — Apni Awaz, Apna Platform

ElevenLabs-style AI voice platform, apna brand, open-source engines.
**v0.2.1 — GitHub: https://github.com/hamxa8769/awaazai**

Version rule (Muuk jaisa): har release mein VERSION bump + git tag +
CHANGELOG entry — bina tag ke koi release nahi.

> **Honest status v0.2.1:** Text-to-Speech kaam karta hai (Kokoro-82M, 54 fixed
> voices, CPU par). Voice cloning bhi **chal raha hai** (Qwen3-TTS 0.6B Base
> via qwentts.cpp, CPU par) — user ki approval ke baad engine build hua aur
> English clone test pass hua (30 second mein 5.44 s audio, neeche dekhein).
> **Urdu Qwen mein supported nahi hai** (Phase 0 verdict:
> FAIL by design) — Urdu ka candidate Fish Speech S2 hai, Phase 2 mein.
> Dubbing, login, history aur credits abhi nahi bane.

## Kya ban gaya hai (MVP scaffold)

| Cheez | Status |
|---|---|
| Landing page + logo (AwaazAI) | ✅ Done — `frontend/index.html` |
| TTS demo box (text → play/download) | ✅ Done, real Kokoro audio |
| `GET /api/health` | ✅ Done |
| `GET /api/voices` (54 Kokoro voices) | ✅ Done |
| `POST /api/tts` (text → WAV) | ✅ Done, verified with real sample |
| `POST /api/clone` | ✅ Done — **engine runs, English clone tested** (Qwen3-TTS 0.6B Base, ~30 s per short clone on CPU) |
| `GET /api/clone/status` | ✅ Done — engine state, languages, Urdu note |
| Dubbing / Studio | ❌ Coming Soon (Phase 2) |
| Login / history / credits | ❌ Not in v0.2.1 |

## Quick start — laptop par (no GPU required)

**Minimum:** 8 GB RAM, 10 GB free disk, Python 3.11+ (3.12 par test hua hai).
GPU zaroori nahi — Kokoro CPU par chalta hai, bas pehli generation mein
model load hone mein kuch second lagte hain. Comfortable: 16 GB RAM, ya
cloning ke liye 4–6 GB VRAM wala GPU (baad mein, Qwen3-TTS ke liye).

```bash
cd awaazai

# 1. Virtual environment + dependencies
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Model files (ek dafa, ~338 MB) — pip mein nahi aate
#    kokoro-v1.0.onnx + voices-v1.0.bin, is release se:
#    https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
#    In dono ko models/ folder mein rakhein.

# 3. Server chalao
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
#    ya: ./run.sh
```

Phir browser mein kholein: **http://127.0.0.1:8000**

- Landing page + demo wahi khulega.
- Sample audio: `sample.wav` (4.33 s, 24 kHz, voice `af_heart`) — yehi
  engine, yehi awaz, is VM par generate hua hai. Frontend mein bhi link hai.

## API

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/voices
curl -X POST http://127.0.0.1:8000/api/tts \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hello, this is AwaazAI.","voice":"af_heart","speed":1.0}' \
  --output out.wav
curl http://127.0.0.1:8000/api/clone/status
# Cloning (multipart): reference audio + text + language + consent=true
curl -X POST http://127.0.0.1:8000/api/clone \
  -F "reference=@ref.wav" -F "text=Hello, this is my cloned voice." \
  -F "language=en" -F "consent=true" --output clone.wav
# -> 503 if the Qwen engine is not installed on this server (honest);
# -> 422 for language=ur (Qwen does not support Urdu);
# -> 400 if consent is missing/false, audio/text is missing, or the
#    reference is shorter than 3 s / longer than 30 s.
```

`POST /api/tts` limits (MVP safety): text max 1000 characters, speed 0.5–2.0,
voice sirf 54 Kokoro voices mein se. `POST /api/clone` limits: text max
500 characters, reference 3–30 s, max 20 MB, consent mandatory — bina
ijazat kisi aur ki awaz clone karna block hai.

## Architecture

```
User (browser)
   │  HTML/CSS/JS, no heavy framework
   ▼
FastAPI server (backend/main.py) ── serves frontend + /assets/logo.png
   │  /api/health, /api/voices, /api/tts, /api/clone (501)
   ▼
TTS engine (backend/tts_engine.py) ── Kokoro-82M via kokoro-onnx
   │  lazy load, thread lock, 24 kHz WAV out
   ▼
models/kokoro-v1.0.onnx + models/voices-v1.0.bin  (~338 MB, gitignored)
```

**Engine alag layer mein hai** — kal ko Qwen3-TTS se behtar model aaya to sirf
worker/engine badlega, website aur API waisi ki waisi rahegi. Yehi plan ka
Rasta B hai (apna platform, tayyar engine).

**Engines (license check):**

| Engine | Use | Cloning | License |
|---|---|---|---|
| Kokoro-82M | Fast TTS, fixed voices (MVP) | Nahi | Apache 2.0 — commercial OK |
| Qwen3-TTS 0.6B | Cloning (planned, Phase 1) | 3-second clip se | Apache 2.0 — commercial OK |
| Fish Speech | Urdu cloning candidate (test) | Han | Test phase mein verify karna hai |
| Whisper | Dubbing / transcription (Phase 2) | — | Open-source |
| XTTS v2 / F5-TTS | **Nahi use hoga** | Han | Weights non-commercial — paid product se bahar |

## Project structure

```
awaazai/
├── README.md
├── requirements.txt
├── run.sh                  # server start helper
├── sample.wav              # real TTS sample (af_heart, 4.33 s, 24 kHz)
├── assets/logo.png         # AwaazAI logo (original webp files/ mein mehfooz hai)
├── backend/
│   ├── main.py             # FastAPI app + API routes + static serving
│   └── tts_engine.py       # Kokoro wrapper (lazy load, voices, synthesize)
├── frontend/
│   ├── index.html          # landing + TTS demo + Coming Soon sections
│   ├── styles.css          # dark teal→violet theme (logo se match)
│   └── app.js              # demo logic, /api/* calls (koi fake audio nahi)
├── models/                 # gitignored, download once (kokoro-v1.0.onnx + voices-v1.0.bin)
└── .venv/                  # gitignored, local Python env
```

## Phase 0 — Urdu test verdict (v0.2.1, full report: docs/phase0-urdu-tests.md)

- **Qwen3-TTS Urdu: FAIL by design.** Qwen ki 10 languages mein Urdu
  nahi hai (Chinese, English, Japanese, Korean, German, French, Russian,
  Portuguese, Spanish, Italian). `/api/clone` par `language=ur` 422 deta hai.
- **English clone: PASS (v0.2.1).** User ki approval ke baad qwentts.cpp
  build hua (Base talker — CustomVoice `--ref-wav` reject karta hai, ye
  v0.2.0 ki ghalti thi, fix ho gayi) aur API se real clone bana:
  `samples/v0.2.0/en-clone.wav`, 5.44 s, HTTP 200 in 30.2 s on CPU.
- **Fish Speech S2: Urdu candidate (docs check).** 80+ languages, Urdu
  (`ur`) listed hai, Tier 3 (quality varies). ~4B parameters, GPU
  chahiye, licence research / non-commercial — product mein nahi hai,
  Phase 2 mein GPU par test hoga.
- Reference audio: `samples/v0.2.0/ref-en-af_heart.wav`
  (real Kokoro, 4.78 s) — clone test ke liye use hua.

Urdu mein open-source voice cloning abhi English jitni perfect nahi hai.
Is liye Urdu ko wada kar ke nahi, **test kar ke** shamil kiya jayega.
Ye test MVP se pehle, sab se pehle hona hai:

**Test 1 — Fish Speech par Urdu:**
Urdu ke 20 mukhtalif jumlay (sawal, khushi, aam guftagu) Fish Speech
(80+ languages) par chalao. Score karo: pronunciation, lehja, natural hona.

**Test 2 — Qwen3-TTS par Urdu:**
Qwen3-TTS par Urdu text chala kar dekho — kya wo Urdu bolta bhi hai ya
nahi, aur bolta hai to kaisa? (Qwen ki 10 languages mein Urdu hone ki
tasdeeq nahi hai.)

**Test 3 — Apni awaz ka Urdu clone:**
Apni awaz ke 10-second clip se Urdu clone banao. Kya clone Urdu mein
wohi awaz lagti hai?

**Pass ka matlab:** aam sunne wale ko awaz natural lage aur alfaaz saaf
samajh aayein. **Fail ho to:** Urdu TTS ke liye doosra engine ya Urdu
fine-tune wala rasta Phase 2 mein aayega — platform English par rukega nahi.

**Training ke liye audio (jab cloning aaye):** saaf awaz, background shor
ya music na ho, aik hi speaker, normal speed. Zero-shot ke liye 3–10
second, fine-tuning ke liye 30+ minute. Bina ijazat kisi aur ki awaz
clone karna block hoga; generated audio par watermark/metadata rahegi.

## What is still missing for MVP (Phase 1)

1. **Voice cloning engine install** — code + UI + API complete hain,
   lekin qwentts.cpp build user approval par ruka hai; GPU server par
   4–6 GB VRAM recommended. Approval ke baad English clone test dobara
   chalega aur docs update honge.
2. **User system** — sign up / login, history, apni cloned voices save karna.
3. **Credits system** — characters/credits ginna (billing ki bunyaad).
4. **Urdu cloning** — Qwen mein Urdu nahi hai; Fish Speech S2 GPU test
   Phase 2 mein (licence dobara check kar ke).
5. **Dubbing + Studio** — Phase 2 (Whisper + translate + clone; project editor).
6. **Public launch** — paid plans, API keys, GPU server (Phase 3).

## Full plan

Poora 10-page Roman Urdu plan: `../files/voice-platform-plan/voice-platform-plan.pdf`
(goal folder mein) — phases, time, cost andaze, aur risks wahi se liye gaye hain.
