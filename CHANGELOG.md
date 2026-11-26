# Changelog — AwaazAI

Version rule (Muuk jaisa): har release mein **VERSION bump + git tag + is
CHANGELOG mein entry**. Bina tag ke koi release nahi.

## [0.4.0] — 2026-11-26

Dubbing + Studio (Phase 2) — local-first, CPU-friendly, no paid APIs.

### Added
- **Speech-to-Text (`POST /api/stt`, `backend/stt_engine.py`):**
  faster-whisper 1.2.1, model "tiny" (~75 MB, HF se aik dafa download,
  phir offline), CPU int8. Audio (WAV/MP3, max 5 min / 25 MB) ffmpeg se
  16 kHz mono WAV banta hai, phir transcript + detected language +
  timestamped segments. Free hai; logged-in users ki STT history mein
  save hoti hai (type `stt`, 0 credits).
- **Dubbing (`POST /api/dub`, login, 20 credits):** pipeline STT →
  translate → re-voice. Kokoro voice ya saved cloned voice (consent
  zaroori) mein dub hota hai. Same-language dub live hai (e.g. en→en).
  Cross-language translation ke liye argos-translate chahiye jo abhi
  installed nahi hai — us pair par **501 aata hai, transcript phir bhi
  milta hai, credits nahi kat te**, kuch fake nahi hota.
  Dubbed WAV ke sath `X-Transcript` / `X-Translation` headers aate hain.
- **Studio (`POST /api/studio`, login, TTS rate):** 5000 characters tak
  lamba text, sentence boundaries par ~900-char chunks, har chunk Kokoro
  se, aik hi WAV mein join + chapter markers (har chunk ka start time,
  `X-Chapters` header). `backend/studio.py` mein chunking; TTS engine
  mein `synthesize_samples()` nikala gaya hai taake Studio aur `/api/tts`
  aik hi rasta use karein.
- **Frontend:** STT section (upload, transcript, copy, segments), Dubbing
  section (upload, target language, Kokoro/saved voice, consent, transcript
  + translation display), Studio section (bara textarea, voice/speed,
  chapters list). History mein `dub` / `studio` / `stt` types dikhte hain.
- `GET /api/health` mein ab `stt`, `dubbing` aur `studio` status bhi hain.

### Fixed
- **faster-whisper + PyAV 19.x crash (real bug, is release mein mila):**
  faster-whisper 1.2.1 file path dene par `av.open(...,
  metadata_errors="ignore")` call karta hai, jo PyAV 19.0.2 mein nahi
  hai — har STT call `TypeError` se 500 hoti thi. Fix: WAV ko soundfile
  se float32 array mein load karke array pass kiya jata hai (faster-whisper
  ka PyAV decode path skip ho jata hai). `av==14.4.0` downgrade try kiya
  tha — Python 3.12 ke liye wheel nahi hai, source build fail hua.

### Tested (v0.4.0 server, this VM, temp test DB)
- STT on `samples/v0.2.0/en-clone.wav` (5.44 s) → 200 in 3.7 s, transcript
  "Hello, this is Awazayai, a natural voice made on your own laptop.",
  language en (0.992), 1 segment 0.24–5.24 s. Tiny model ne "AwaazAI" ko
  "Awazayai" suna — tiny-model accuracy, honest limit.
- Dub logged-out → 401. Dub en→es → **501 + transcript, credits 99
  unchanged**. Dub en→en (Kokoro af_heart) → 200 in 8.5 s, real WAV
  196,652 bytes, 4.1 s, credits 99→79 (20 deducted).
- Studio 932 chars → 200 in 53 s, 2 chunks, aik WAV 2,741,004 bytes,
  57.1 s, chapters 0.0 s / 52.5 s, credits 79→69. Studio 1165 chars →
  200 in 66 s, 2 chunks, 71.14 s WAV, chapters 0.0 s / 54.39 s.
- Dub with 5 credits (needs 20) → **402**, balance unchanged (5).
- Clone regression → 200, real WAV 172,844 bytes, 3.6 s, 10 credits.
- Regression: `/api/health` → 200 (v0.4.0, cloning "ready", stt "ready"),
  `/api/voices` → 54, landing `/` → 200, TTS → 200. History mein
  tts/stt/dub/studio chaaron types dikhe.

### Not yet
- Cross-language dubbing (argos-translate + pairs install karna baaki),
  Urdu cloning (Fish Speech GPU test — user ka faisla baaki), real payment.

## [0.3.0] — 2026-11-26

Login + History + Credits + Saved Voices (local-first, no external service).

### Added
- **Accounts (`backend/accounts.py`, SQLite `data/awaazai.db`, gitignored):**
  `POST /api/auth/signup` (100 free credits), `POST /api/auth/login`,
  `POST /api/auth/logout`, `GET /api/auth/me`. Password pbkdf2
  (200,000 rounds, random salt) se hash hota hai — plain text kabhi save
  nahi hota, logs mein nahi aata. Random bearer token (30 din valid),
  frontend localStorage mein rakhta hai. Galat password / unknown user
  par aik hi generic error (no user enumeration).
- **Credits:** TTS 1 credit per 100 characters (round up), Clone 10
  credits per generation. Balance kam ho to **402** saaf message ke sath.
  Generation fail ho to credits wapas (refund). "Get more credits"
  button honestly Coming Soon kehta hai — koi real payment wired nahi hai.
- **History:** login ke baad ki har TTS/Clone generation save hoti hai
  (`GET /api/history`, play/download `GET /api/history/{id}/audio`,
  `DELETE /api/history/{id}`). Audio `data/history/<user>/` mein save
  hoti hai (gitignored). Sirf apni history dikhti hai.
- **Saved voices:** clone ke baad "Save this voice" se awaz naam se save
  hoti hai (`POST /api/voices/save`, reference `data/voices/<user>/`
  mein). `GET /api/voices/saved`, `DELETE /api/voices/saved/{id}`.
  Clone karte waqt saved voice chunein to dobara upload nahi karna parta
  (`saved_voice_id` se clone, is VM par test pass).
- **Frontend:** header mein credits pill + username + logout, auth card
  (login/signup), History section (play/download/delete), My Voices
  section, clone mein saved-voice picker + Save button. Bina login ke TTS
  demo abhi bhi chalta hai — 5 generations per browser session, clearly
  shown (frontend counter); cloning ke liye login zaroori hai.
- **Demo account (is machine ki local DB par):** `demo` / `awaazai123`,
  100 credits, khaali history. Ye sirf is VM ki `data/awaazai.db` mein
  hai — fresh install par database khaali banta hai, wahan signup karein.

### Tested (v0.3.0 server, this VM, temp test DB)
- Signup 100 credits; duplicate signup → 400; wrong password → 401;
  `/api/credits` bina token → 401; clone bina login → 401.
- TTS logged in (150 chars) → cost 2, remaining 98, real WAV 674,860 bytes;
  TTS logged out → 200 (demo). History mein 1 item, audio play → 200.
- Save voice → 200, list → 1 voice. Clone with `saved_voice_id` → 200,
  real WAV 180,524 bytes, remaining 88, `X-Cloned-Voice: Test Voice`.
- Credits 0 par TTS → **402**. User2 ki history khaali, doosre user ki
  history/voice delete → 404 (isolation pass). Own delete → 200.
- Regression: `/api/health` → 200 (v0.3.0, cloning "ready"),
  `/api/voices` → 54, landing `/` → 200.

### Not yet
- Urdu cloning (Fish Speech GPU test, Phase 2 — user ka faisla baaki),
  dubbing/Studio, real payment.

## [0.2.2] — 2026-11-26

Server start script — server start karke browser mein page khol deta hai.

### Added
- **`start.py` (cross-platform, main script)** — uvicorn subprocess start
  kare, `/api/health` poll karke ready hone ka wait kare (max 60 s),
  phir browser mein `http://127.0.0.1:8000` khole. Console mein saaf
  message: "AwaazAI chal raha hai: http://127.0.0.1:8000 — band karne ke
  liye Ctrl+C dabayein". Ctrl+C par server cleanly band hota hai.
  Headless machine par browser-open fail ho to script fail nahi hoti —
  URL print karke server chalata rehta hai. Port 8000 busy ho to saaf
  error + port khaali karne ke steps (crash/traceback nahi). Flags:
  `--port`, `--host`, `--no-browser`. Sirf Python stdlib, koi dependency nahi.
- **`start.sh` (Linux/mac)** — pehli dafa `.venv` banaye + requirements
  install kare, phir `start.py` chalaye. Executable permission set hai.
- **`start.bat` (Windows)** — double-click se chalaye: python check,
  `.venv` banaye + install kare (pehli dafa), phir `start.py` chalaye
  aur browser khole. Is VM par test nahi hua (Linux VM hai) — ye saaf
  README mein likha hai.
- **`run.sh`** ab `start.sh` ki taraf point karta hai — purana naam bhi
  browser kholta hai, dono se ek hi kaam hota hai.

### Changed
- README: "Kaise chalaye" section — Windows double-click `start.bat`,
  Linux/mac `./start.sh`, ya `python3 start.py`; pehli dafa model files
  (Kokoro ~310 MB ONNX + voices, kul ~338 MB) ka note.
- README ki "still missing" list se cloning-engine wali purani line
  hatayi — cloning v0.2.1 mein ho gaya tha, wo note ab ghalat tha.
- Version strings 0.2.2 par: `VERSION`, `backend/main.py`, frontend footer.

### Tested (v0.2.2, this VM — neeche report mein tafseel)
- `./start.sh` background test: `/api/health` → 200, landing `/` → 200,
  headless browser-open fail hone par bhi server chalta raha.
- Windows `start.bat` is VM par test nahi hua — code carefully likha hai,
  Windows user se confirm karwana baaki hai.

### Not yet
- Urdu cloning (Fish Speech GPU test, Phase 2 — user ka faisla baaki),
  login/history, credits, dubbing/Studio.

## [0.2.1] — 2026-11-26

Voice cloning engine ab asal mein chalta hai (patch — koi API change nahi).

### Fixed
- **v0.2.0 ki ghalti: CustomVoice talker cloning nahi kar sakta.**
  qwentts.cpp ka `--ref-wav` sirf Base models ke liye hai; CustomVoice
  sirf 9 named speakers (`--speaker`) deta hai. Pehla clone test is
  liye 502 par fail hua (`custom_voice models require --speaker`,
  14.5 s). Fix: Base 0.6B talker (`qwen-talker-0.6b-base-Q8_0.gguf`)
  download karke `backend/clone_engine.py` us par switch kiya; code,
  API header, frontend aur README mein "CustomVoice" labels ko "Base"
  se correct kiya.
- **Build note:** `buildcpu.sh` ka `-DGGML_BLAS=ON` is VM par fail hota
  hai (BLAS dev files nahi hain, sirf runtime lib) — bina BLAS ke
  configure kiya, `-j2` build clean (exit 0). CPU backend OpenMP ke
  sath chalta hai.

### Added
- English clone test **PASS** — user ki approval (2026-11-26 ~16:37 PKT)
  ke baad qwentts.cpp build hua aur API se real clone bana:
  `POST /api/clone` → HTTP 200 in 30.2 s, `samples/v0.2.0/en-clone.wav`
  (5.44 s, 24 kHz, RMS 0.073, SHA-256 `8853aba6…e285` — reference aur
  Kokoro sample dono se alag, genuine new generation). CLI se bhi
  verify hua (exit 0, 28 s, 5.36 s audio, RTF 4.256 on CPU).
- `docs/phase0-urdu-tests.md` updated — English clone PASS, pehli
  failure + fix honestly recorded.
- Qwen weights (gitignored, not committed): Base talker Q8_0
  (sha256 `d54dbaf1…426`) + tokenizer Q8_0. CustomVoice talker bhi disk
  par hai (unused, cloning ke liye zaroori nahi).

### Tested (v0.2.1 server, this VM)
- `GET /api/health` → 200, cloning "ready"; `GET /api/voices` → 54;
  `POST /api/tts` → 200, real Kokoro WAV — TTS regression pass.
- Clone: no consent → 400; `language=ur` → 422; valid English clone →
  200 (upar dekhein). Voice-match ko kaan se sunna baaki hai — user
  `en-clone.wav` sun kar judge karein (objective checks: real synthesis,
  duration, speech-like loudness, distinct hash).
- CPU speed: ~30 s per ~5.4 s clone (RTF ~4.3× slower than real time);
  GPU server par seconds mein hoga.

### Not yet
- Urdu cloning (Fish Speech GPU test, Phase 2 — user ka faisla baaki),
  login/history, credits, dubbing/Studio.

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
