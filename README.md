# AwaazAI — Apni Awaz, Apna Platform

ElevenLabs-style AI voice platform, apna brand, open-source engines.
**v0.7.0 — GitHub: https://github.com/hamxa8769/awaazai**

Version rule (Muuk jaisa): har release mein VERSION bump + git tag +
CHANGELOG entry — bina tag ke koi release nahi.

> **Honest status v0.7.0:** Text-to-Speech kaam karta hai (Kokoro-82M, 54 fixed
> voices, CPU par). Voice cloning engine is VM par **abhi crash karta hai** (qwentts.cpp binary SIGILL — Illegal instruction — inference shuru hote hi; `/api/clone/status` phir bhi "ready" kehta hai, sirf binary + models ki presence check karta hai). v0.6.0 mein clone is VM par pass hua tha — VM/CPU tab se badla lagta hai; user ke PC par asal test hoga, wahan binary dobara build karna par sakta hai.
> **Urdu Qwen mein supported nahi hai** (Phase 0 verdict:
> FAIL by design) — Urdu ka candidate Fish Speech S2 hai, Phase 2 mein.
> **Naya v0.7.0: ElevenLabs-style frontend rebuild** — compact pinned sidebar footer (84 px), version runtime par `/api/health` se, TTS two-column layout, Voices tabs (Library / My Voices / Add Voice), real-state Home checklist, step indicators har page par, har button par spinner + double-submit block, 1366×768 / 1920×1080 / 480 / 360 px par verify. Backend API unchanged. Details: CHANGELOG + `docs/elevenlabs-ui-research.md` (bug audit B1–B12, sab fix).
> **Naya v0.6.0: saare sections professionally upgrade + in-app Kokoro model downloader** — TTS voice grid/cards (search, char/cost counter), Clone 4-step wizard + drag-drop + sample reference, My Voices cards, Dubbing side-by-side transcript/translation, Studio chapters with jump, STT transcript download, History filters + date grouping, Account profile + change-password, toasts + spinners, koi stuck "Loading…" nahi. Model missing ho to app ke andar hi "Download Kokoro models (~338 MB)" button se download hota hai (`POST /api/models/download`, sirf 127.0.0.1, progress bar) — manual download ki zaroorat nahi.
> **Naya v0.5.0: professional sidebar UI + in-app Update button** — ElevenLabs-style sidebar, aik waqt mein aik page (Home, TTS, Cloning, My Voices, Dubbing, Studio, STT, History, Account), dashboard stats + recent generations. Update button sidebar aur Account page mein: `GET /api/update/check` GitHub releases se latest version batata hai, `POST /api/update/apply` (sirf 127.0.0.1) `git pull origin main` chalata hai — `data/` aur `models/` gitignored hain, pull un ko kabhi delete nahi karta. Server khud restart nahi hota: update ke baad Ctrl+C karke `start.bat` dobara chalana parta hai, button yehi imaandari se batata hai.
> **Naya v0.4.1: start.bat Python detection fix** — `where python` fail hone par bhi `py` launcher aur common install locations se Python dhoondhta hai; `.venv` ho to system Python ki zaroorat hi nahi. Agar phir bhi na mile to diagnostics print karta hai.
> **Naya v0.4.0: Speech-to-Text (faster-whisper tiny, CPU), Dubbing aur
> Studio** — dubbing same-language kaam karta hai; cross-language
> translation ke liye argos-translate abhi installed nahi hai, is liye
> us pair par 501 aata hai aur transcript phir bhi milta hai (credits
> nahi kat te).

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
| Dubbing (`POST /api/dub`) | ✅ Done v0.4.0 — STT + re-voice; same-language live, cross-language 501 (argos-translate not installed) |
| Studio (`POST /api/studio`) | ✅ Done v0.4.0 — 5000 chars, chunked, chapters, aik WAV |
| Speech-to-Text (`POST /api/stt`) | ✅ Done v0.4.0 — faster-whisper tiny, CPU, free |
| Login / history / credits | ✅ Done v0.3.0 — local SQLite, 100 free credits, history, saved voices |
| Professional sidebar UI + dashboard | ✅ Done v0.5.0 — aik waqt mein aik page, sidebar nav, stats, recent |
| In-app Update button | ✅ Done v0.5.0 — check + git pull (local-only), restart prompt — server khud restart nahi hota |
| Server start script (`start.bat` / `./start.sh` / `python3 start.py`) | ✅ Done — server + browser khulta hai |

## Kaise chalaye — server start karo, browser khud khul jayega

**Minimum:** 8 GB RAM, 10 GB free disk, Python 3.11+ (3.12 par test hua hai).
GPU zaroori nahi — Kokoro CPU par chalta hai, bas pehli generation mein
model load hone mein kuch second lagte hain. Comfortable: 16 GB RAM, ya
cloning ke liye 4–6 GB VRAM wala GPU (baad mein, Qwen3-TTS ke liye).

**Windows — sab se asaan:** `start.bat` par double-click karein.
Server start hoga, ready hote hi browser mein **http://127.0.0.1:8000**
khul jayega. Band karne ke liye console mein Ctrl+C dabayein.

> **Agar `start.bat` kahe "python nahi mila" jab ke PowerShell mein
> `python --version` chalta hai (v0.4.1 se pehle ka bug):** `git pull`
> se v0.4.1 lein — ab `start.bat` pehle `.venv` check karta hai, phir
> `py` launcher aur common install locations
> (`%LOCALAPPDATA%\Programs\Python\Python3*` waghera) se Python
> dhoondhta hai. Agar phir bhi na mile to wo diagnostics print karta
> hai. Foran ka hal (PowerShell, is folder se):
> `py -m venv .venv`, phir `.\.venv\Scripts\pip install -r requirements.txt`,
> phir `.\.venv\Scripts\python -u start.py`.
> Note: AwaazAI Python 3.12 par test hua hai; Python 3.14 par pip install
> fail ho to 3.12 use karein.

**Linux / macOS:**
```bash
./start.sh
```

**Kisi bhi system par (Python se):**
```bash
python3 start.py
```

Ye script server start karta hai, `/api/health` se ready hone ka wait
karta hai (max 60 second), phir browser kholta hai. Headless machine par
(headless server, koi browser nahi) browser kholna fail ho to script
fail nahi hoti — URL print karke server chalata rehta hai.

Pehli dafa `start.sh` / `start.bat` khud `.venv` banata hai aur
`requirements.txt` install karta hai (sirf pehli dafa). Pehli dafa
model files bhi chahiye hote hain (Kokoro ONNX ~310 MB + voices file,
kul ~338 MB) — ye pip mein nahi aate, neeche dekhein.

Doosra port: `./start.sh --port 8001` ya `python3 start.py --port 8001`.
Sirf server, browser nahi: `python3 start.py --no-browser`.

**Manual tareeqa (agar script na chale):**

```bash
cd awaazai

# 1. Virtual environment + dependencies
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Model files (ek dafa, ~338 MB) — pip mein nahi aate
#    kokoro-v1.0.onnx + voices-v1.0.bin, is release se:
#    https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0)
#    In dono ko models/ folder mein rakhein.

# 3. Server chalao (browser khud kholein)
.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000
#    ya: ./run.sh   (ye bhi ab start.sh ki taraf point karta hai)
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

## Accounts, credits, history, saved voices (v0.3.0)

Local-first: SQLite database `data/awaazai.db` (gitignored — repo mein
nahi jata, har machine par apna local database banta hai). Koi external
auth service nahi, koi real payment nahi.

- **Signup/login:** `POST /api/auth/signup` aur `POST /api/auth/login`
  (username + password). Password pbkdf2 (200,000 rounds, random salt) se
  hash hota hai — plain text mein kabhi save nahi hota, logs mein nahi aata.
  Login par random bearer token milta hai (30 din valid), frontend usay
  localStorage mein rakhta hai.
- **Credits:** naye user ko **100 free credits**. TTS: 1 credit per 100
  characters (round up). Clone: 10 credits per generation. Balance khatam
  ho to **402** milta hai, saaf message ke sath. Generation fail ho to
  credits wapas mil jate hain (refund). "Get more credits" button abhi
  Coming Soon kehta hai — payment abhi wired nahi hai.
- **History:** login ke baad ki har TTS/Clone generation save hoti hai
  (time, type, text snippet, voice, credits, duration, audio file).
  `GET /api/history`, play/download `GET /api/history/{id}/audio`,
  `DELETE /api/history/{id}`. Sirf apni history dikhti hai.
- **Saved voices:** clone ke baad "Save this voice" se awaz naam se save
  hoti hai (reference audio `data/voices/<user>/` mein, gitignored).
  `GET /api/voices/saved`, `DELETE /api/voices/saved/{id}`. Clone karte
  waqt saved voice chunein to dobara upload nahi karna parta
  (`saved_voice_id` se clone hota hai).
- **Demo (bina login):** TTS demo abhi bhi chalta hai — is browser session
  mein 5 generations (frontend counter, clearly shown). Cloning ke liye
  login zaroori hai.
- **Demo account (is machine ki local DB par):** username `demo`,
  password `awaazai123` — test ke liye banaya gaya hai, 100 credits.
  Ye sirf is VM ki `data/awaazai.db` mein hai; fresh install par database
  khaali banta hai, wahan signup se apna account banayein.

```bash
# Signup + login (token save karein)
curl -X POST http://127.0.0.1:8000/api/auth/signup \
  -H 'Content-Type: application/json' \
  -d '{"username":"demo","password":"awaazai123"}'
# -> {"user": {..., "credits": 100}, "token": "..."}
TOKEN=...
curl http://127.0.0.1:8000/api/credits -H "Authorization: Bearer $TOKEN"
curl http://127.0.0.1:8000/api/history -H "Authorization: Bearer $TOKEN"
curl http://127.0.0.1:8000/api/voices/saved -H "Authorization: Bearer $TOKEN"
```

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
├── start.py                # cross-platform start: server + browser khole
├── start.sh                # Linux/mac — .venv + install (pehli dafa) + start.py
├── start.bat               # Windows — double-click, .venv + install + start.py
├── run.sh                  # legacy naam, ab start.sh ki taraf point karta hai
├── sample.wav              # real TTS sample (af_heart, 4.33 s, 24 kHz)
├── assets/logo.png         # AwaazAI logo (original webp files/ mein mehfooz hai)
├── backend/
│   ├── main.py             # FastAPI app + API routes + static serving
│   ├── accounts.py         # SQLite: users, sessions, credits, history, saved voices
│   ├── tts_engine.py       # Kokoro wrapper (lazy load, voices, synthesize)
│   └── clone_engine.py     # Qwen3-TTS cloning (qwentts.cpp, consent check)
├── data/                   # gitignored — awaazai.db, history audio, saved voices
├── frontend/
│   ├── index.html          # landing + TTS demo + clone + auth + history + voices
│   ├── styles.css          # dark teal→violet theme (logo se match)
│   └── app.js              # demo logic, auth, credits, history, saved voices
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

1. **Voice cloning engine — DONE in v0.2.1** (pehle yahan "approval par
   ruka hai" likha tha, wo ab purana hai). qwentts.cpp build ho gaya,
   English clone test pass hua (30.2 s, `samples/v0.2.0/en-clone.wav`).
   Baaki: GPU server par tez chalana (CPU par ~30 s per short clone).
2. **User system — DONE in v0.3.0** — sign up / login, history, apni
   cloned voices save karna, credits system (100 free, TTS 1/100 chars,
   Clone 10, 402 on empty). Payment ("Get more credits") abhi Coming Soon.
3. **Urdu cloning** — Qwen mein Urdu nahi hai; Fish Speech S2 GPU test
   Phase 2 mein (licence dobara check kar ke, user ka faisla baaki).
4. **Dubbing + Studio — DONE in v0.4.0** — STT (faster-whisper tiny, CPU,
   free), Dubbing (STT → translate → re-voice, login, 20 credits; same-language
   live, cross-language 501 kyunki argos-translate abhi installed nahi hai),
   Studio (5000 chars, sentence-boundary chunks, chapters, TTS rate).
   Baaki: argos-translate pairs install karke cross-language dub kholna.
5. **Professional UI + Update button — DONE in v0.5.0** — sidebar layout, dashboard, in-app update (check + git pull, local-only, restart prompt).
6. **Public launch** — paid plans, API keys, GPU server (Phase 3).

## Full plan

Poora 10-page Roman Urdu plan: `../files/voice-platform-plan/voice-platform-plan.pdf`
(goal folder mein) — phases, time, cost andaze, aur risks wahi se liye gaye hain.
