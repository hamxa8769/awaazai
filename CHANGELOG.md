# Changelog — AwaazAI

Version rule (Muuk jaisa): har release mein **VERSION bump + git tag + is
CHANGELOG mein entry**. Bina tag ke koi release nahi.

## [0.8.0] — 2026-11-27

Piper Urdu TTS (user ne dono samples sun kar "Han" kaha) + Voice Training page — teenon natural-voice raste aik jagah, premium UI/UX, production checks ke sath.

### Added — Path 1: Piper Urdu (live)
- **Urdu TTS live:** `POST /api/tts` par `ur_aegis` (female) + `ur_fasih` (male), Piper 1.8.0 (`PiperVoice` Python API, bundled espeak-ng data), 22,050 Hz WAV, CPU-only, ~63 MB per voice. Qwen Urdu bolta hi nahi (ur → 422), is liye Piper Urdu engine hai; Kokoro English engine rehta hai.
- **Backend:** `backend/piper_engine.py` (lazy-load, thread lock, speed → length-scale), `tts_engine.synthesize_samples` Urdu voices ko Piper par route karta hai (Studio bhi isi raste se Urdu bol sakta hai). `/api/voices` ab 56 voices deta hai (54 Kokoro + 2 Piper, `engine: "piper"`, `model_present` flag). History mein Urdu generations `language: "ur"` ke sath save hoti hain, credits wahi TTS rate (1 per 100 chars).
- **Downloader:** `GET /api/models/status` mein Piper group (`piper.complete`, kul 128,357,852 bytes — 2 .onnx + 2 .json), `POST /api/models/download` par `{"group": "piper"}` (~126 MB, sirf 127.0.0.1). `.json` config files ~5 KB hain — downloader ka 1 MB minimum un par nahi lagta (per-file threshold fix).
- **Frontend:** TTS + Voices mein All / English / Urdu filter chips, voice cards par "Urdu · Piper" badge, Home badge ab "English + Urdu", Account → Models mein Piper download card + progress, Urdu voice chune par models missing hon to generate se pehle saaf error + download prompt.
- **Licence (honest, README + piper_engine.py docstring mein):** piper-tts 1.8.0 maintained OHF-Voice/piper1-gpl fork hai, **GPL-3.0** (purana rhasspy/piper MIT tha). AwaazAI isay pip dependency ke tor par call karta hai; Piper component GPL-3.0 rehta hai — combined app ki paid/commercial distribution se pehle advice lein. Voice models: dono HF listings par MIT likha hai, **lekin Aegis ki provenance kamzor hai** — OmniVoice teacher se distill, Fasih checkpoint se warm-start (jo khud Hindi checkpoint se aayi) — paid/commercial use se pehle is lineage ki licence check zaroori hai; test/personal use theek hai.

### Added — Path 2: Fish Speech S2 (GPU pending, kuch fake nahi)
- **`GET /api/fish-speech/status`:** asal readiness check — GPU (nvidia-smi / torch.cuda / /dev/nvidia*), fish-speech package, weights (`models/fish-speech/`), RAM/disk. Is VM par: **not-ready — koi GPU nahi hai** (7.7 GB RAM, 118.4 GB disk free), package not installed, weights nahi hain. Frontend Voice Training page par "Run GPU check" button yehi check dobara chalata hai — koi audio generate nahi karta, koi fake voice option nahi. Fish Speech voice tab hi milegi jab GPU machine par asal generation test pass ho. Licence: research / non-commercial.

### Added — Path 3: Own-voice training (intake + validation + queue)
- **Voice Training page (naya, sidebar mein 10th item):** teenon raston ka side-by-side comparison (Piper live / Fish Speech GPU pending / Own voice most natural) + step header + recordings intake.
- **Endpoints:** `POST /api/training/upload` (login, WAV/MP3, max 100 MB) — asal validation: duration (kam az kam 3 s), sample rate (kam az kam 8 kHz), RMS loudness, silence ratio; warnings ke sath save hota hai. `GET /api/training/status` (total minutes vs 30-minute goal, queue state), `DELETE /api/training/recordings/{name}`, `POST /api/training/request` (kam az kam 60 s audio chahiye — kam ho to 400 ke sath saaf message). Files `data/training/<user>/` mein (gitignored) + manifest.json.
- **Honest note:** training GPU ka kaam hai — laptop CPU par instant nahi hoti. Intake + queue live hai, training khud GPU server par hogi.

### Fixed (v0.8.0 mein pakda gaya)
- **PAGES whitelist bug:** naya Training page sidebar se click karne par Home par wapas gir jata tha — `PAGES` array mein "training" nahi tha. Fix ho gaya; ab 10 pages navigate karte hain.
- **Speed label:** TTS/Studio mein "Speed (Kokoro)" likha tha jabke Urdu voices par speed Piper length-scale ke tor par lagti hai — label ab "Speed" hai, note mein dono engines likhe hain.
- **TTS "Ready" message:** engine naam ab `X-Engine` header se aata hai (Piper par "piper-tts (Urdu)", Kokoro par "kokoro-82m").

### Tested (v0.8.0, this VM)
- Urdu TTS: `ur_aegis` → 200, 3.18 s, 22,050 Hz, md5 fa4f8fe66264aae6b375dcd93175c93a (original test sample 7fe2a3d8… se alag — nayi generation); `ur_fasih` → 200, 1.99 s, md5 740f49e20c4d470561fa8ce81a7d951c (original ba9ea37d… se alag). Logged-in: credits 100 → 99, history row `language: "ur"`, `credits_cost: 1`.
- `/api/voices` → 56 (54 Kokoro + 2 Piper); `/api/models/status` → Kokoro complete 353,746,785 B + Piper complete 128,357,852 B (4 files done); HF resolve URLs temp-dir download se verify (donon .json files 5207 + 5033 bytes, status done).
- Fish Speech: `GET /api/fish-speech/status` → not-ready, GPU absent, package not installed, weights nahi — honest.
- Training: upload 3.18 s clip → received (RMS −15.6 dB, silence 14%, no warnings); 1 s clip → 400 reject; 5 s silent clip → accepted with warnings (100% silent, RMS −120 dB); request <60 s → 400; delete → 200, count 0 (test recordings clean kar di).
- Regression: Kokoro TTS 200 (81,964 B), Studio Kokoro 200 (108,588 B), STT 200, Dub en→en (English source) 200 (197,676 B); Dub Urdu source → 501 (STT ne language "hi" detect ki — sahi behaviour, cross-language abhi bhi 501); `/api/health` 200 v0.8.0; server log mein 0 ERROR/Traceback.
- Screenshots (Playwright Chromium, `hidden_files/ui-verification-v0.8.0/` — repo mein nahi): 10 pages × 1366×768 (logged-in demo) + training 480×800 — har page visually inspect ki, 0 px horizontal overflow, console errors NONE; Urdu filter par sirf 2 cards (Aegis + Fasih, Piper badge).
- Samples: `samples/v0.8.0/ur-aegis.wav` (3.18 s) + `ur-fasih.wav` (1.99 s), test sentence "یہ آواز اے آئی ہے، اردو میں بول رہی ہے۔".

### Not yet / honest limits
- Cloning engine is VM par abhi bhi SIGILL se crash karta hai (v0.7.0 se, pre-existing) — clone generation ka VM test pass nahi hua; user ke PC par asal test hoga.
- Fish Speech generation test GPU machine par baaki hai — is VM par GPU nahi hai.
- Own-voice training ka asal GPU train abhi baaki hai — sirf intake + queue live hai.
- Cross-language dubbing abhi bhi 501 (argos-translate not installed), real payment NOT added.
- Windows `.bat`/browser test user ke PC par baaki hai.

## [0.7.0] — 2026-11-26

ElevenLabs-style frontend rebuild — **frontend ONLY** (`frontend/index.html` + `styles.css` + `app.js`), backend API unchanged (sirf `VERSION` 0.6.0 → 0.7.0). Design + audit: `docs/elevenlabs-ui-research.md` (ElevenLabs sidebar order, per-page workflows, design tokens, bug audit B1–B12 — sab fix hue).

### Fixed (B1–B12, sab)
- **B1 — Sidebar footer:** ~180 px → 84 px (avatar + naam, credits line, Logout + Check-for-updates chhote buttons). Nav hi aik scrolling region hai (thin scrollbar). 1366×768 par measured: brand 56 px + nav 592 px (scrollHeight 592, last item fully visible) + footer 84 px — koi nav item cut/half-hidden nahi.
- **B2 — Version:** HTML/CSS/JS mein koi hardcoded version nahi. Version + engine status `GET /api/health` se runtime par aate hain (brand sub `v0.7.0 · local`, Account → About card).
- **B3 — Content:** max-width 860 → 1120 px, centred, 24 px padding, uniform 16 px gaps, aik card style (radius 14 px, padding 20–24 px), aik H1 per page (topbar title).
- **B4 — Voice list stuck state:** model missing ho to voice panel ki jagah poora download card aata hai (progress bar + retry) — kabhi stuck "Loading voices…" nahi. Voices load par 10 s timeout + error box + Retry button (TTS panel + Library dono).
- **B5 — TTS two-column:** editor + output left, voice panel right (search + gender filter + scrollable list), 900 px se neeche aik column. Voice sample-play ka koi endpoint nahi hai — fake play button nahi banaya; cards mein naam + gender + language, note ke saath.
- **B6 — Step indicators:** Clone wizard ke steps ab real progress dikhate hain (reference → text → consent → generate); Dubbing (Upload → Settings → Generate → Result), Studio (Project → Text & voice → Generate → Listen), STT (Upload → Transcribe → Result) par step header; result panels tab dikhte hain jab result ho.
- **B7 — Home:** "Honest note" ki wall-of-text hata kar 2-line honest-status card; getting-started checklist REAL state ke saath (models `/api/models/status` se, login `/api/auth/me` se, first TTS / first clone history count se); stats logged-out par 0 + label dikhate hain, kabhi bare "—" nahi.
- **B8 — Top bar:** breadcrumb/title left, engine pill + credits pill + user avatar (initial letter) right; narrow widths par engine pill sirf coloured dot rehta hai (360 px par verify).
- **B9 — Mobile:** 480 px + 360 px test — horizontal overflow 0 px; voice grid `minmax(150px, 1fr)`; dropzones ki min-height 120 px; wizard steps full-width rows.
- **B10 — Labels:** "Urdu + English" badge → "English · 10 languages"; honest Urdu note sirf Clone page par (Qwen Urdu support nahi karta — 422).
- **B11 — Busy states:** har async button disabled + spinner + double-submit blocked (TTS, Clone, Dub, Studio, STT, auth, password, update, model download, history play/download/delete, saved-voice delete).
- **B12 — Footer:** engine credits har page se hata kar Account → About card mein (version bhi wahin).

### Added / changed per page
- **Home:** checklist, stats (0 + label), recent generations, quick actions, 2-line honest status.
- **Text to Speech:** two-column layout, cost Generate button par (`Generate audio · N credits`), char + word count, in-session Generations list, Recent TTS (logged-in + empty par sahi message).
- **Voices:** tabs Library (54 Kokoro voices, search + gender filter) / My Voices (saved clones, Use/Delete) / Add Voice (Clone wizard ka link).
- **Voice Cloning:** wizard step indicator real validation ke saath, engine status card, Urdu note, inline save-voice.
- **Dubbing:** step header, side-by-side transcript/translation, 501 card (argos not installed, transcript shown, 0 credits charged).
- **Studio:** project title field (download filename + chapters heading mein), chapters jump buttons, result panel hidden jab tak result na ho.
- **Speech-to-Text:** step header, auto-detect language note, transcript + copy/download .txt + clickable segments.
- **History:** filter chips + search + date grouping + play/download/delete per card; empty states mein CTA button.
- **Account:** profile, Credits & usage card, change password, Updates card (update status ab sirf yahan — sidebar footer se update-msg hata diya), Models card (download status + button), About card (version + engine credits).

### Tested (v0.7.0, this VM)
- Backend: `/api/health` → 200 v0.7.0, model files present; landing 200, 9 pages present, served HTML mein koi hardcoded version nahi; `/api/voices` → 54/54; `/api/models/status` → complete, 353,746,785 B; `/api/clone/status` → ready; `/api/update/check` → 200 (latest None — GitHub par abhi v0.7.0 release nahi, honest error field).
- Regression: TTS 200 real WAV 214,060 B (RIFF, credits 100→99); STT 200 (en, transcript sahi, 1 segment); Dub en→en 200 (214,060 B); Dub en→es **501**, `credits_charged: 0`, transcript present; Studio 200 (224,300 B, chapters header ke saath); history 4 items.
- Screenshots (Playwright Chromium, `hidden_files/ui-verification-v0.7.0/` — repo mein nahi): 9 pages × 1366×768 (logged-in demo) + 1920×1080, 480×800, 360×740 — har page visually inspect ki, koi overlap/cut-off/misalignment nahi; console par koi JS error nahi; horizontal overflow 0 px har viewport par.
- **Clone generation is VM par FAIL ho raha hai (pre-existing, frontend se unrelated):** `POST /api/clone` → 502, qwentts.cpp binary SIGILL (Illegal instruction, exit 132) deta hai inference shuru hote hi — model load ho jata hai, `[Pipeline] Ready` ke baad crash. Binary 2026-11-17 ka build hai; is VM ka CPU (AMD EPYC 9D64) us ke kisi instruction ko support nahi karta. v0.6.0 mein clone is VM par 200 deta tha — VM/CPU tab se badla lagta hai. `/api/clone/status` phir bhi "ready" kehta hai (sirf binary + models ki presence check karta hai). Backend is release mein change nahi hua (sirf VERSION string), is liye fix is release ka hissa nahi — user ke PC par asal test hoga; wahan binary dobara build karna par sakta hai.

### Not yet / honest limits
- Cloning engine user ke PC par abhi bhi qwentts.cpp build + Qwen GGUFs mangta hai; is VM par binary SIGILL se crash karta hai (upar dekhein) — clone generation ka VM test is dafa pass nahi hua.
- Cross-language dubbing abhi bhi 501 (argos-translate not installed), Urdu cloning (Fish Speech) NOT started, real payment NOT added.
- Windows `.bat`/browser test user ke PC par baaki hai — is release ka asal test wahin hoga.

## [0.6.0] — 2026-11-26

Baqi saare sections professionally upgrade, ElevenLabs jaisi fully developed + working (user ne v0.5.0 apne PC par dekh kar kaha tha: sidebar to aa gaya, baqi sections bhi professionally upgrade karo).

### Added
- **In-app Kokoro model downloader (sab se bara working fix):** user ko ab manually model files download nahi karne parte. `GET /api/models/status` (public) — dono files (kokoro-v1.0.onnx + voices-v1.0.bin, kul 353,746,785 bytes) ki state, progress aur `complete`/`engine_ready`. `POST /api/models/download` (sirf 127.0.0.1 / ::1, warna 403) — background thread mein download, `.part` + atomic rename, Range resume (206 → append, 200 → restart), idempotent (already complete/downloading → `started:false`). Frontend: model missing ho to TTS page par "Download Kokoro models (~338 MB)" button + progress bar (har 2 s poll), manual-download note bhi hai. Engine lazy-load karta hai, is liye download ke baad restart ki zaroorat nahi — pill green ho jata hai.
- **Text to Speech — professional:** voice dropdown ki jagah searchable voice grid/cards (54 voices, naam + gender + language, Heart highlighted, click/keyboard select; hidden `<select id="voice">` sync mein hai). Char counter (x/1000) + credit cost preview, recent TTS (last 3) inline.
- **Voice Cloning — 4-step wizard:** 1 Upload reference → 2 Text → 3 Language + consent → 4 Generate. Drag-and-drop upload, reference preview player + duration display (3–30 s warning, backend phir bhi validate karta hai), "Use sample.wav as reference" button, engine status card (ready / not-installed + setup steps, kabhi ready ka dawa nahi jab engine na ho). Save voice ab inline naam field se hota hai (`prompt()` hata diya).
- **My Voices — cards grid:** naam, language, created date, "Use for clone" (Clone page par le jata hai aur voice select karta hai), Delete. Search filter, empty state + "Clone your first voice" CTA.
- **Dubbing — professional flow:** drag-drop upload, source-language badge, target language + voice picker, transcript + translation side-by-side panels, dubbed audio player, "20 credits" cost preview. Cross-language 501 par saaf "Translation pack not installed" card (argos-translate + pair chahiye), transcript phir bhi dikhta hai, credits nahi kat te.
- **Studio:** word/char counter (x/5000, words, cost), chapter jump buttons (player ko chapter start par le jate hain), save-to-history note.
- **Speech-to-Text:** drag-drop, language badge, Copy + Download .txt, segments clickable rows (segment text copy karte hain, labelled).
- **History:** filter chips (All / TTS / Clone / Dub / Studio / STT) + search, cards (type badge, voice, credits, date, snippet, Play/Download/Delete), date grouping (Today / date), empty state.
- **Account:** profile card (username, member since, credits), **change-password** (`POST /api/auth/change-password`, current verify pbkdf2 se, wrong current → 401 generic, new < 6 → 400), Updates card waisa hi, Danger Zone mein logout.
- **Polish everywhere:** toast notifications (top-right, success/error) har generate/auth/update action par, loading spinners + disabled state har generate button par, har async load par 10 s timeout + error message — koi stuck "Loading voices…" nahi.

### Tested (v0.6.0, this VM — backend + frontend agents, phir parent ne dobara verify kiya)
- Backend: `/api/health` → 200 v0.6.0, model files present; `/api/models/status` → 200, kokoro 325,532,387 B done + voices 28,214,398 B done, total 353,746,785, complete true; download (already complete) → `started:false`; downloader unit test local http.server 2.5 MB file par pass (fresh, concurrent, resume, unreachable URL → error, good file survives); change-password wrong current → 401, right → 200, new password se login 200, purana 401; 403 TestClient se verify; regression `/api/voices` → 54, `/api/tts` → 200 real WAV 195,628 B.
- Frontend: landing 200, 9 pages present, console par load par koi JS error nahi; TTS 200 (96 KB, credits 100→99), STT 200, Clone 200 (~25 s, 80 KB), Dub en→en 200 (197 KB), Dub en→es **501** transcript + `credits_charged: 0`, Studio 200 chapters ke sath, change-password throwaway user par pass.
- Screenshots (Playwright Chromium, 1280×900, `hidden_files/ui-verification-v0.6.0/` — repo mein nahi): Home, TTS (voice grid, Heart highlighted), Clone (wizard + green Ready engine card), Dubbing, Studio, History (cards + Today heading), Account + My Voices logged-in — koi overlap ya toota layout nahi (parent ne TTS aur Clone screenshots khud dobara dekhe).

### Not yet / honest limits
- Real 338 MB GitHub download is VM par exercise nahi hua (files pehle se complete thi); download logic local 2.5 MB file par prove hui, 206 Range-resume path code-reviewed only — user ke PC par pehli download hi asal test hai.
- Cloning engine user ke PC par abhi bhi qwentts.cpp build + Qwen GGUFs mangta hai — in-app downloader sirf Kokoro models download karta hai, Qwen nahi. UI `/api/clone/status` jo kehta hai wahi dikhata hai.
- Cross-language dubbing abhi bhi 501 (argos-translate not installed), Urdu cloning (Fish Speech GPU test — user ka faisla baaki), real payment abhi bhi nahi.

## [0.5.0] — 2026-11-26

Professional sidebar UI (ElevenLabs-style) + in-app Update button.

### Added
- **Sidebar layout — sirf frontend badla, backend API waisa hi hai.** Left sidebar (fixed, ~248px): logo + naam, nav (Home, Text to Speech, Voice Cloning, My Voices, Dubbing, Studio, Speech-to-Text, History, Account), neeche credits + username + logout + Update button. Top bar mein page title, engine status pill aur credits pill. Aik waqt mein sirf aik page dikhta hai (JS show/hide, hash routing `#tts`, `#clone` …), page reload nahi hota. Mobile par sidebar hamburger se off-canvas khulti hai.
- **Home / Dashboard page:** welcome card, quick stats (credits, generations, saved voices), quick actions (TTS / Clone / Dub / Studio), recent generations (last 5, history se).
- **History aur My Voices mein search filter** — sirf list filter karta hai, koi fake global search nahi.
- **Update button (sidebar bottom + Account page):** `GET /api/update/check` — GitHub `releases/latest` se latest version (timeout 10s, no auth); offline/API fail par 200 with `error` field, kabhi crash nahi. `POST /api/update/apply` — sirf 127.0.0.1 / ::1 (warna 403); `.git` ho to `git pull origin main` (timeout 120s) aur `{updated, needs_restart: true}`; `.git` na ho to 501 + manual instructions (git clone / zip). `git pull` sirf tracked files badalta hai — `data/`, `models/` aur `.venv/` gitignored hain, pull un ko kabhi delete nahi karta.
- **Honest restart flow:** running uvicorn process khud ko safely restart nahi kar sakta, is liye update ke baad button kehta hai "server restart karein (Ctrl+C, phir start.bat), phir page refresh karein" — Refresh page button bhi hai. Auto-restart ka dawa nahi kiya gaya.

### Tested (v0.5.0, this VM, temp test DB /tmp/awaazai-v050-test.db — real data/awaazai.db untouched)
- `/api/health` → 200, version `0.5.0`, cloning "ready", STT "ready", model files present.
- Landing `/` → 200 (20,300 bytes); HTML mein 9 pages (`page-home` … `page-account`) aur 9 nav items maujood.
- `/api/update/check` → 200, `{"current":"0.5.0","latest":null,"update_available":false,"error":"HTTP Error 404: Not Found"}` — is VM se GitHub API rate-limit/404 mila (direct curl bhi "API rate limit exceeded" deta hai), endpoint ne crash kiye baghair honest error diya, jaisa design tha. User ke PC par normal network par latest release milegi to `latest` + `update_available` sahi aayenge; rate limit lage to button "Check failed" dikhayega, kabhi fake "up to date" nahi.
- `/api/update/apply` → 200, `{"updated":true,"needs_restart":true,"output":"Already up to date."}` — git pull chala, server ke baad bhi `/api/health` 200 deta raha.
- Regression: `/api/voices` → 54, `/api/tts` → 200 real WAV 81,964 bytes (24 kHz), signup → 100 credits, `/api/history` → [], STT bina file → 422.
- Screenshots (Chromium headless, 1280×900 + 480×900 mobile, `hidden_files/ui-verification-v0.5.0/` mein — repo mein commit nahi kiye): Home — sidebar + stats + quick actions + recent, koi overlap nahi; TTS page — aik hi section, voice "Heart — warm female" loaded, engine pill green "ready"; Account page — login form + Updates card + sidebar "Check for updates" button; Mobile — sidebar chhupi hui, hamburger dikh raha, stats aik column mein. **Windows visual check abhi bhi user se baaki hai — yehi asal test hai.**

### Not yet
- Cross-language dubbing (argos-translate + pairs install karna baaki), Urdu cloning (Fish Speech GPU test — user ka faisla baaki), real payment.

## [0.4.1] — 2026-11-26

Windows start.bat Python detection fix — user ke PC par real bug.

### Fixed
- **`start.bat` kehta tha "python nahi mila" jab ke PowerShell mein
  `python --version` chalta tha (Python 3.14.0).** Root cause: v0.4.0
  wala `start.bat` sirf cmd ke `where python` par bharosa karta tha —
  PowerShell mein `python --version` App Execution Alias / App Paths se
  bhi mil jata hai jab `where python` cmd mein fail ho. Ab detection
  is order mein hai: (1) `.venv\Scripts\python.exe` pehle — agar .venv
  hai to system Python PATH mein ho ya na ho, koi farq nahi; (2)
  `where python`; (3) `python --version` (alias/App Paths case);
  (4) `where py` / `py --version` (Python launcher — "Add Python to
  PATH" par tick na lagi ho to bhi milta hai); (5) common install
  locations: `%LOCALAPPDATA%\Programs\Python\Python3*`,
  `%USERPROFILE%\AppData\Local\Programs\Python\Python3*`,
  `%ProgramFiles%\Python3*`, `C:\Python3*`. Microsoft Store stub
  (`...\Microsoft\WindowsApps\python.exe`) jaan boojh kar use nahi
  hota — wo asal Python nahi, Store kholta hai.
- **Agar phir bhi Python na mile** to ab sirf "Add Python to PATH"
  nahi kehta — checked locations + `where python` / `where py` /
  `py --version` / `python --version` diagnostics print karta hai aur
  foran ka hal deta hai (`py -m venv .venv` + venv pip install +
  `.\.venv\Scripts\python -u start.py`).
- **`start.py` `pick_python()` (v0.4.1):** Windows par agar
  `sys.executable` Store stub (`WindowsApps`) hai to common locations
  mein asal Python dhoondhta hai (`_find_windows_python()`, 0-byte stub
  skip karta hai). `.venv` ho to wahi pehle use hota hai, jaise pehle tha.
- **pip install fail ho to saaf note:** AwaazAI Python 3.12 par test
  hua hai; Python 3.14 par install fail ho to 3.12 use karein.

### Tested (v0.4.1, this VM)
- `python3 -m py_compile start.py backend/main.py` → OK.
- `start._find_windows_python()` Linux par → None (sahi, Windows-only
  code); `pick_python()` → `.venv/bin/python` (venv prefer, unchanged).
- Batch logic static check: saare `goto` targets ke labels maujood hain
  (`:found_py`, `:found_python`, `:install`, `:venv_failed`,
  `:no_python`, `:run`); `cmd`/`wine` is VM par nahi hai, is liye
  **`.bat` Windows par run karke test nahi hua — user se confirm
  karwana baaki hai** (yehi is fix ka asal test hai).
- Regression (v0.4.1 code, port 8123, `--no-browser`): `/api/health`
  → 200, `/api/voices` → 54, server timeout ke baad cleanly shutdown.
  Version bump ke baad dobara check (port 8124): `/api/health` →
  200, version `0.4.1` sahi dikha raha hai.

### Not yet
- Cross-language dubbing (argos-translate + pairs install karna baaki),
  Urdu cloning (Fish Speech GPU test — user ka faisla baaki), real payment.

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
