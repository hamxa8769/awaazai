# Phase 0 — Urdu tests (AwaazAI v0.2.0 → v0.2.1)

Date: 2026-11-26. VM: no NVIDIA GPU (`nvidia-smi` not found), 4 CPUs,
7.7 GB RAM (~0.8–1.0 GB free at test time), 121 GB disk free.
Status: **updated for v0.2.1 — English clone PASS (real audio), Qwen Urdu
still FAILs by design, Fish Speech NOT RUN locally.** No audio was faked.

## Verdict up front

| Test | Result | Evidence |
|---|---|---|
| (a) Qwen3-TTS Urdu check | **FAIL — by design** | Qwen's model card lists 10 languages: Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian. **Urdu is not in the list.** A request for `ur` on `/api/clone` is therefore rejected with 422 (tested below). Urdu text fed to Qwen would not be Urdu speech. |
| (b) English clone test | **PASS (v0.2.1)** | Real clone via `/api/clone`: HTTP 200, 30.2 s on CPU, output `samples/v0.2.0/en-clone.wav` — 5.44 s, 24 kHz, RMS 0.073, distinct SHA-256 from reference and from Kokoro sample. First attempt failed honestly (see below) and was fixed by switching talker. |
| (c) Fish Speech as Urdu backup | **NOT RUN locally — docs check only** | Fish Speech S2 lists Urdu (`ur`) in its 80+ language coverage (Tier 3, quality varies by language). It is the correct Urdu candidate, but it is a ~4B-parameter model needing a GPU, and its licence is research / non-commercial — it is **not** in the product. Running it on this 7.7 GB, no-GPU VM was not attempted. |

## (a) Qwen3-TTS Urdu — FAIL by design

Source: Qwen/Qwen3-TTS model card (Hugging Face, checked 2026-11-26):
"Qwen3-TTS covers 10 major languages (Chinese, English, Japanese,
Korean, German, French, Russian, Portuguese, Spanish, and Italian)."
Urdu is absent from every model in the family (1.7B/0.6B, Base /
CustomVoice / VoiceDesign). qwentts.cpp's README says the same:
"10 languages" / "11 languages with Mandarin dialects".

The 5 Urdu sentences prepared for this test (not run through Qwen,
because the language is unsupported — running them would only produce
English-phonetic gibberish, not a test of Urdu):

1. السلام علیکم، میرا نام حمزہ ہے۔ (Assalam-o-Alaikum, mera naam Hamza hai.)
2. آج موسم بہت اچھا ہے، کیا آپ باہر جانا چاہیں گے؟ (Aaj mausam bohat acha hai...)
3. یہ آواز کیسی لگ رہی ہے؟ (Ye awaz kaisi lag rahi hai?)
4. میں کل لاہور جا رہا ہوں، وہاں ایک اہم میٹنگ ہے۔ (Main kal Lahore ja raha hoon...)
5. شکریہ، آپ نے بہت مدد کی۔ (Shukriya, aap ne bohat madad ki.)

API behaviour (tested live, v0.2.0 server): `POST /api/clone` with
`language=ur` returns **422** with the message that Urdu is not
supported by Qwen3-TTS and points to this document. That is the
correct, honest behaviour — not a bug.

**Consequence:** Urdu cloning cannot ship on Qwen3-TTS. It needs a
different engine (Fish Speech S2, see (c)) or an Urdu fine-tune in
Phase 2. The platform does not promise Urdu cloning in v0.2.0.

## (b) English clone test — PASS (v0.2.1, after one honest failure)

**Approval:** the user approved building/running qwentts.cpp in plain
words on 2026-11-26 ~16:37 PKT ("Han, qwentts.cpp build karke English
clone test chalao"). That approval covered the build/run of qwentts.cpp
**only for this English clone test** — not Urdu cloning, not Fish Speech.

**Build (v0.2.1):**
- `cmake` configure with `-DGGML_BLAS=ON` (as in `buildcpu.sh`) failed:
  BLAS dev files are not installed on this VM (only the runtime
  `libblas.so.3`, no headers). Re-configured **without BLAS** — configure
  passed, build with `-j2` (memory safety on 7.7 GB RAM) finished clean,
  exit 0: `build/qwen-tts`, `build/qwen-codec`, `build/tts-server`.
- Weights downloaded from Hugging Face `Serveurperso/Qwen3-TTS-GGUF`
  into `models/qwen/` (gitignored, not committed):
  `qwen-talker-0.6b-customvoice-Q8_0.gguf` (968,588,544 bytes,
  sha256 `4eb38675…8519`) and `qwen-tokenizer-12hz-Q8_0.gguf`
  (291,150,624 bytes, sha256 `1883beee…fd94`).

**First attempt — FAILED honestly (v0.2.0 code):** `POST /api/clone`
returned **502 after 14.5 s**. Exact engine error:
`[CLI] ERROR: custom_voice models require --speaker`.
Root cause: qwentts.cpp's `--ref-wav` is **Base only** (`--help` says so);
CustomVoice models are 9 named speakers only (`--speaker`) and cannot
clone from a reference clip. v0.2.0 had wired the CustomVoice talker —
wrong model for cloning. No audio was produced; the 560-byte response
was the error JSON, not a wav, and was deleted (not kept as a sample).

**Fix (v0.2.1):** downloaded the **Base** 0.6B talker
`qwen-talker-0.6b-base-Q8_0.gguf` (sha256
`d54dbaf1…426`, gitignored) and switched `backend/clone_engine.py` to it
(same `--ref-wav` command, no `--speaker`). All "CustomVoice" labels in
code, API header, frontend and README were corrected to "Base".

**Second attempt — PASS:** direct CLI test first, then the real API:
- CLI: `qwen-tts --model <base> --codec <tokenizer> --ref-wav
  ref-en-af_heart.wav --lang English -o cli-clone-test.wav` → exit 0,
  28 s wall, 5.36 s audio, RTF 4.256 on CPU.
- API: `POST /api/clone` (reference `ref-en-af_heart.wav`, text "Hello,
  this is AwaazAI. A natural voice, made on your own laptop.",
  language=en, consent=true) → **HTTP 200 in 30.2 s, 261,164 bytes**,
  saved as `samples/v0.2.0/en-clone.wav` — **5.44 s, 24 kHz mono,
  RMS 0.0734, peak 0.422, 67.9% non-silent** (reference: RMS 0.0753,
  83.3% non-silent — same loudness ballpark, speech-like energy with
  pauses). SHA-256 `8853aba6…e285` — distinct from the reference
  (`3861da5f…`) and from the Kokoro `sample.wav` (`18850c60…`), and
  distinct from the CLI run (`8db3fdcf…`, different random seed), so it
  is a genuine new generation, not a copy of any input.
- `GET /api/clone/status` → `state: "ready"`, engine
  `qwen3-tts-0.6b-base (via qwentts.cpp, GGUF Q8_0)`.

**Honest limit:** I cannot listen to audio, so "sounds like the
reference" is verified only by objective checks (real synthesis, correct
duration for the sentence, speech-like loudness/pauses, distinct hash,
same 24 kHz pipeline). The user should listen to `en-clone.wav` and
judge the voice match by ear — that is the real similarity test.
CPU speed on this VM is ~4.3× slower than real time (28–30 s for ~5.4 s
of audio); on a GPU server it would be seconds. The CustomVoice
weights stay on disk unused (gitignored) — they are not needed for
cloning and are not shipped.

What the clone run needed (now done):
- qwentts.cpp CPU build (cmake + g++ — both present on this VM) and
  GGUF weights `qwen-talker-0.6b-base-Q8_0.gguf` +
  `qwen-tokenizer-12hz-Q8_0.gguf` in `models/qwen/` (gitignored).
- The CustomVoice talker downloaded in the first attempt is **not**
  used for cloning and is not required for a fresh install.

## (c) Fish Speech as Urdu backup — docs check only

Sources checked 2026-11-26:
- Fish Audio S2 Pro README: "Trained on over 10 million hours of
  audio data covering more than 80 languages", global coverage list
  explicitly includes `ur` (Urdu), alongside Hindi, Persian, Arabic,
  Pashto, Sindhi, Punjabi.
- Fish Audio docs (Agent Voice & Language): `ur` | Urdu is in the
  52 supported speaking languages.
- Quality tier: Tier 1 = Japanese/English/Chinese; Tier 2 = Korean,
  Spanish, Portuguese, Arabic, Russian, French, German; Urdu is in
  Tier 3+, where quality "varies by language" — so Urdu is supported
  but not top-tier, and needs a listening test, not a paper claim.

Why it was not run locally:
- S2 Pro is ~4B parameters (Slow AR) + 400M Fast AR; it needs a GPU
  in practice and far more RAM than this VM's ~1 GB free.
- Licence: Fish Audio research licence / CC-BY-NC in the open
  weights — **not commercial-safe** for a paid product. It can be a
  test candidate, not the shipping engine, until its licence is
  re-checked for the intended use.
- No second engine was added to the product in v0.2.0, as instructed.

**Consequence:** Fish Speech S2 is the leading Urdu-cloning candidate
for Phase 2, to be tested on a GPU machine (or via a short paid API
evaluation, if the user approves that spend) before any Urdu-cloning
promise is made.

## API test results (v0.2.1 server, this VM)

Server: `uvicorn backend.main:app`, Kokoro models + Qwen engine present.
- `GET /api/health` → 200, `cloning: "ready"`,
  `cloning_engine: "qwen3-tts-0.6b-base (via qwentts.cpp, GGUF Q8_0)"`
- `GET /api/voices` → 200, 54 voices
- `POST /api/tts` → 200, real Kokoro WAV (regression: TTS still works)
- `GET /api/clone/status` → 200, `state: "ready"`,
  `urdu_supported: false`, supported languages listed
- `POST /api/clone` with no consent → 400 (consent required)
- `POST /api/clone` with consent + `language=ur` → 422 (Urdu not supported)
- `POST /api/clone` with consent + `language=en` + valid reference →
  **200, 261,164 bytes in 30.2 s** (see (b) above)
- `POST /api/clone` with no file field at all → 422 (FastAPI field
  validation, "Field required" — the multipart `reference` field itself
  is missing); with a `.txt` file → 400 (unsupported format)
- Landing `/` → 200, Clone section present

(Previous v0.2.0 results — cloning "not-installed", engine 503 — are
superseded by the v0.2.1 run above.)

## Samples in samples/v0.2.0/

| File | What it is | Real? |
|---|---|---|
| `ref-en-af_heart.wav` | Kokoro reference for the clone test | Yes — real Kokoro audio |
| `en-clone.wav` | English clone output (API, v0.2.1) | **Yes — real Qwen3-TTS Base clone, 5.44 s, sha256 `8853aba6…e285`** |
| `ur-test.wav` | Urdu Qwen test output | **Missing — Qwen does not support Urdu** |

## Decision needed from the user

1. ~~**Approve building/running qwentts.cpp**~~ — **DONE 2026-11-26
   ~16:37 PKT** ("Han, qwentts.cpp build karke English clone test
   chalao"). Engine built, English clone test passed in v0.2.1.
2. **Urdu direction — DECIDED 2026-11-27 (v0.8.0):** user ne Piper ke dono
   samples sun kar "Han" kaha — Piper Urdu TTS (Aegis + Fasih) AwaazAI v0.8.0
   mein live hai. Fish Speech S2 ab "more natural" backup rasta hai (GPU test
   pending — is VM par GPU nahi hai); own-voice training intake + queue bhi
   v0.8.0 mein live hai. Urdu *cloning* abhi bhi nahi hai (Qwen Urdu nahi
   bolta) — Urdu TTS Piper se, cloning English-only.
