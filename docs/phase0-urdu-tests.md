# Phase 0 — Urdu tests (AwaazAI v0.2.0)

Date: 2026-11-26. VM: no NVIDIA GPU (`nvidia-smi` not found), 4 CPUs,
7.7 GB RAM (~0.8–1.0 GB free at test time), 121 GB disk free.
Status: **recorded honestly — Qwen Urdu FAILs by design, English clone
NOT RUN on this VM, Fish Speech NOT RUN locally.** No audio was faked.

## Verdict up front

| Test | Result | Evidence |
|---|---|---|
| (a) Qwen3-TTS Urdu check | **FAIL — by design** | Qwen's model card lists 10 languages: Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian. **Urdu is not in the list.** A request for `ur` on `/api/clone` is therefore rejected with 422 (tested below). Urdu text fed to Qwen would not be Urdu speech. |
| (b) English clone test | **NOT RUN on this VM** | Clone code + UI + API are complete and tested for validation. The engine binary (qwentts.cpp) was cloned but **not built or run** — the build step failed an execution-risk check and needs explicit user approval before it is processed (see "Blocker" below). No cloned wav exists; none was faked. |
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

## (b) English clone test — NOT RUN on this VM

What is done:
- `backend/clone_engine.py` — full Qwen3-TTS 0.6B CustomVoice wiring
  via qwentts.cpp (GGUF Q8_0, CPU backend), with validation
  (3–30 s reference, max 500 chars, consent mandatory), 503 when the
  engine is not installed, 422 for unsupported language.
- `POST /api/clone` (multipart) + `GET /api/clone/status` — tested
  for validation errors (see "API test results" below).
- Frontend Clone section — upload, text, language picker, consent
  checkbox, Generate, play/download.

What is NOT done:
- The qwentts.cpp binary was **not built and not run** on this VM.

Blocker (exact): while fetching the qwentts.cpp source, the execution
returned a security notice that the delivered content failed an
execution-risk check — its build scripts / hooks can run code during
ordinary processing. Per that notice, I did **not** run, build, test,
import, load or source that content, and did not run git/package
commands inside it. The cloned source sits unbuilt at
`tools/qwentts.cpp/` (gitignored, not committed) and must not be built
until the user explicitly approves going ahead in plain words.

Reference audio prepared for the future run (real Kokoro audio, NOT a
clone): `samples/v0.2.0/ref-en-af_heart.wav` — generated with the
v0.1.0 Kokoro engine, voice af_heart, text "Hello, this is AwaazAI.
This is a clean reference voice for cloning tests." When the engine
is approved and built, the clone test is: feed this file as reference,
generate "Hello, this is my cloned voice, speaking with AwaazAI.",
and compare by listening + duration/sample-rate + a basic spectral
similarity check. Until then, `samples/v0.2.0/` contains only the
reference — **no `en-clone.wav` exists, and none was created.**

What the clone run needs (for the GPU-server / approved-build run):
- qwentts.cpp CPU build (`./buildcpu.sh`, needs cmake + g++ — both
  present on this VM) and GGUF weights
  `qwen-talker-0.6b-customvoice-Q8_0.gguf` + `qwen-tokenizer-12hz-Q8_0.gguf`
  in `models/qwen/` (gitignored, ~1–2 GB download).
- Expected CPU speed: roughly a quarter of GPU speed; a short clone
  may take minutes on 4 CPUs. On a GPU server (4–6 GB VRAM) it is
  seconds.
- After approval, re-run this test and update this document with the
  real result — do not ship cloning as "working" before that run.

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

## API test results (v0.2.0 server, this VM)

Server: `uvicorn backend.main:app`, Kokoro models present.
- `GET /api/health` → 200, `cloning: "not-installed"`,
  `cloning_engine: "qwen3-tts-0.6b-customvoice (via qwentts.cpp, GGUF Q8_0)"`
- `GET /api/voices` → 200, 54 voices
- `POST /api/tts` → 200, real Kokoro WAV (regression: TTS still works)
- `GET /api/clone/status` → 200, `state: "not-installed"`,
  `urdu_supported: false`, supported languages listed
- `POST /api/clone` with no consent → 400 (consent required)
- `POST /api/clone` with consent + `language=ur` → 422 (Urdu not supported)
- `POST /api/clone` with consent + `language=en` + valid reference,
  engine not installed → 503 (engine not installed, with setup steps)
- `POST /api/clone` with no file field at all → 422 (FastAPI field
  validation, "Field required" — the multipart `reference` field itself
  is missing); with a `.txt` file → 400 (unsupported format)
- Landing `/` → 200, Clone section present

Full curl transcript: see the v0.2.0 release report (parent agent).

## Samples in samples/v0.2.0/

| File | What it is | Real? |
|---|---|---|
| `ref-en-af_heart.wav` | Kokoro reference for future clone test | Yes — real Kokoro audio |
| `en-clone.wav` | English clone output | **Missing — not generated (engine not run)** |
| `ur-test.wav` | Urdu Qwen test output | **Missing — Qwen does not support Urdu** |

## Decision needed from the user

1. **Approve building/running qwentts.cpp** (the cloned C++ source)
   so the English clone test can actually run on this VM (CPU, slow)
   or on a GPU server? Until approval, cloning stays "code ready,
   needs engine".
2. **Urdu direction:** Fish Speech S2 GPU test in Phase 2, or accept
   English-only cloning in v0.2.0 and revisit Urdu later?
