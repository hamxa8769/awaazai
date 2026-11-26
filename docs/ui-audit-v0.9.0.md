# AwaazAI UI Audit — v0.9.0 (Step 1)

Date: 2026-11-27. App version under test: **v0.8.0** (from `/api/health`, live).
Auditor: subagent, Step 1 of v0.9.0. No code was changed, VERSION was not touched,
nothing was pushed. The premium-ui-ux skill created in this step is the fix
spec for every item below.

## Method

- Served the real backend from the repo copy:
  `.venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8009`.
  `/api/health` returned 200, `version 0.8.0`, `model_files_present true`,
  `engine_loaded false`, `cloning ready`, `urdu_engine ready`.
- Playwright (Chromium 1255) captured all 10 pages (Home, TTS, Voices, Clone,
  Training, Dubbing, Studio, STT, History, Account) at 1366x768, 1920x1080 and
  480x854 — 30 screenshots, each inspected visually.
- Measured per capture: document scroll width vs client width (horizontal
  overflow), sidebar/nav/footer heights, top-bar overflow, brand version text,
  status pill text, stuck "Loading voices…" / "Loading…" strings.
- Screenshots and raw measurements live outside the repo at
  `hidden_files/ui-verification-v0.9.0/` (goal folder), file names
  `<viewport>-<page>.png`, plus `metrics.json`.

## Headline result

- **Zero horizontal overflow on all 30 captures.** `scrollWidth == clientWidth`
  at 1366x768, 1920x1080 and 480x854 on every page.
- **B1–B5, B7, B11, B12 from the v0.7.0 research are fixed** (see re-check).
  B6, B8, B9, B10 are partially fixed.
- **The v0.7.0 "'Welcome, demo!' pill" bug is gone.** No such pill exists in
  the top bar any more. "Welcome, \<username\>!" now appears only as a toast
  and auth message after a real login (app.js:240-241), not as a top-bar pill.
- **18 open items (A1–A18) remain**, 2 high (both are honesty-of-status bugs),
  5 medium, 11 low/info. No page is broken; the worst problems are misleading
  status text, unstyled native controls and unequal card heights.

## Re-check of v0.7.0 bugs B1–B12 (docs/elevenlabs-ui-research.md §10)

- B1 FIXED. Sidebar footer is 84px tall (CSS caps it at 110px). At 1366x768
  the nav is 592px high with scrollHeight == clientHeight, so all 10 items are
  fully visible and nothing is half-hidden.
- B2 FIXED. Brand shows "v0.8.0 · local" from `/api/health` at runtime. No
  hardcoded version string remains in index.html (only the "Loading…" placeholder).
- B3 FIXED. Content max-width is 1120px with uniform 16px gaps and one card style.
- B4 FIXED. Voices load on both the TTS panel and the Library grid; zero
  occurrences of "Loading voices…" remain in the DOM after load. The error box
  with retry button exists in the markup (not triggered in this run, models present).
- B5 FIXED. TTS is a two-column layout (editor left, voice panel 340px right)
  collapsing to one column below 900px; verified at 480px.
- B6 PARTIAL. Dubbing, Studio and STT have wizard step headers and result
  panels stay hidden until a result exists. Training has no step indicator
  (three path cards plus an upload card), and no page except Clone advances its
  steps from real state (see A18).
- B7 FIXED. Home checklist shows real state (Kokoro models check is done) and
  stats show 0 with labels when logged out.
- B8 PARTIAL. The top bar fits at 1366px with no clipping or wrapping: title
  left, engine pill plus credits pill plus avatar right. Still missing: no
  breadcrumb and no user menu; the "?" avatar just navigates to Account.
- B9 FIXED at 480px. No horizontal overflow, voice grid falls to 2 columns,
  path cards stack, dropzones keep their 120px min-height. 360px was not tested.
- B10 PARTIAL. The Home badge still says "English + Urdu". The Honest status
  card now clarifies that Urdu cloning is not supported while Urdu TTS works
  via Piper, so the badge is defensible for TTS but still ambiguous at a glance.
- B11 FIXED. `setBusy` (spinner plus disabled, double-submit blocked) is used
  in 38 places, including Generate, Clone, Dub, Studio, STT, password change
  and model downloads.
- B12 FIXED. No engine-credit footer repeats on pages; engines live only in
  Account → About.

## Open items

### A1 — HIGH — Top-bar engine pill lies about readiness
- Where: every page, top bar. Pill reads "Engine: Kokoro-82M ready" (green).
- Evidence: `/api/health` in the same run returns `engine_loaded: false`.
  Pill logic (app.js:302-305) treats `model_files_present` as ready. The
  Account → About card contradicts the pill in the same app ("Kokoro not loaded
  yet", app.js:301).
- Fix: the pill must use `engine_loaded`. While files are present but the engine
  is not loaded, show "Models present — engine not loaded" (amber), not green.

### A2 — HIGH — Clone page claims an engine is ready that was never smoke-tested
- Where: Clone page, engine card. Reads "Ready — Qwen3-TTS 0.6B Base" and
  "Engine ready — clone generate kar sakte hain."
- Evidence: `/api/clone/status` returns `state: ready` from `binary_present`
  plus `models_present` only (app.js:1054-1078). There is no runtime probe.
  On this VM the qwen-tts binary is known to SIGILL and POST /api/clone
  returns 502 (v0.7.0 finding), so "ready" is unverified here.
- Fix: label the state "Installed — not smoke-tested" until a tiny real
  generation probe passes; show the probe result and date.

### A3 — MEDIUM — White text on the gradient primary button fails WCAG AA
- Where: every primary button ("Generate audio · demo", "Login", "Try Urdu TTS").
- Evidence: measured contrast — white on #2dd4bf is about 2.6 to 1, white on
  the gradient midpoint about 3.25 to 1; AA needs 4.5 to 1 for 15px bold text.
- Fix: primary button becomes solid #6d28d9 (white text 7.1 to 1, hover #7c3aed
  5.7 to 1). Keep the teal-to-violet gradient for the hero heading, logo and
  avatar only, where large text needs just 3 to 1.

### A4 — MEDIUM — No keyboard focus ring anywhere
- Where: all pages. styles.css contains no `:focus` or `:focus-visible` rule.
- Evidence: keyboard focus relies on the browser default outline, which is
  inconsistent across browsers and invisible on several controls.
- Fix: 2px solid #2dd4bf outline plus a 4px soft ring rgba(45,212,191,0.25)
  on every interactive element; test by keyboard on all 10 pages.

### A5 — MEDIUM — Native file inputs break the design system
- Where: Clone, Dubbing, STT dropzones. The grey OS "Choose File" button plus
  "No file chosen" text sits inside the styled dashed dropzone.
- Evidence: visible in 1366x768-clone.png, 1366x768-dub.png, 1366x768-stt.png.
  The dropzone text says "click to browse", but clicking the dropzone text
  does not open the picker — only the native button does.
- Fix: hide the native input and drive it from a styled label covering the
  whole dropzone, per the skill.

### A6 — MEDIUM — Range sliders are unstyled native controls
- Where: TTS speed slider, Studio speed slider.
- Evidence: default blue track and thumb on a dark theme (1366x768-studio.png),
  clashing with the teal/violet system. No other control uses native blue.
- Fix: custom track and thumb in the brand accent, per the skill.

### A7 — MEDIUM — Training path cards have unequal heights and unaligned CTAs
- Where: Training page at 1366x768 (and 1920x1080).
- Evidence: card 1 has a large empty gap above "Try Urdu TTS" (y≈535), card 3
  "Upload recordings" sits lower (y≈570), and the Fish Speech "Run GPU check"
  button is below the 768px fold. The Fish card is far taller than the others.
- Fix: equal-height grid with `margin-top: auto` on card CTAs, per the skill.

### A8 — LOW — TTS voice-search placeholder is clipped at desktop width
- Where: TTS right panel, 340px wide, at 1366x768. Placeholder reads
  "Search voices… (e.g. Heart, warm fema…" (truncated).
- Evidence: 1366x768-tts.png. The same placeholder fits fully on the Voices
  page and at 480px, so this is specific to the narrow side panel.
- Fix: shorten the TTS panel placeholder to "Search voices…".

### A9 — LOW — Voices grid cards have uneven heights in a row
- Where: Voices Library grid at 1366x768. Two-line voice names ("Alloy —
  neutral female") make their cards taller than single-line neighbours.
- Fix: fixed min-height for the name line or a two-line clamp, per the skill.

### A10 — LOW — Logged-out History and STT states skip the empty-state component
- Where: History page ("Login karein to history dikhegi.") and STT "Recent TTS"
  area — plain muted paragraphs, no action.
- Evidence: 1366x768-history.png. A designed `.empty-state` with a CTA exists
  in the markup but stays hidden in the logged-out case.
- Fix: use `.empty-state` with a "Login" CTA for logged-out, and keep the
  existing empty state for filtered-empty.

### A11 — LOW — "Get more credits" looks live but always fails
- Where: Account page. A normal secondary button that always ends in an error
  toast ("Credits purchase abhi Coming Soon hai", app.js:256-259).
- Fix: label it "Get more credits — Coming Soon" and style it as upcoming
  (or disable it with the reason beside it).

### A12 — LOW — Duplicated controls
- Where: "Check for updates" exists in the sidebar footer and again in
  Account → Updates; Logout exists in the footer (when logged in) and again in
  Account → Danger zone.
- Fix: keep one canonical place per action (Account), per the skill.

### A13 — LOW — Dead space in the sidebar at 1920x1080
- Where: sidebar at 1920x1080. The nav area is 904px tall but the 10 items
  occupy only about 460px; the bottom half is empty. Content max-width 1120px
  also leaves about 270px gutters on each side (by design, acceptable).
- Fix: accept, or add a small pinned "Recent generations" section; do not
  stretch the nav items to fill it.

### A14 — LOW — Home stat cards look hollow
- Where: Home, all sizes. A 32px number plus a label inside a tall card leaves
  large empty padding; the three cards read as placeholders when logged out.
- Fix: reduce card padding for stats or add a sub-label (e.g. "this session",
  "all time"); keep the 0 values honest.

### A15 — LOW — No webfont is ever loaded
- Where: all pages. The font stack is `system-ui` only, so the intended Inter
  face never renders. The UI still looks clean, but the premium typeface the
  tokens assume is absent.
- Fix: bundle Inter woff2 locally (offline-first) or record the system stack
  as the deliberate choice in the tokens file.

### A16 — LOW — Guest avatar is a "?"
- Where: top bar and sidebar footer when logged out. A gradient circle with a
  literal question mark reads as an error state, and clicking it only navigates
  to Account with no menu or tooltip beyond `title="Account"`.
- Fix: use a neutral user glyph for guests; add a small menu or keep the
  navigation but label it clearly.

### A17 — INFO — Dubbing intro is a wall of text
- Where: Dubbing page. The honest note about the missing translation pack is
  buried in a four-line paragraph at the top of the working card.
- Fix: move it into a dismissible info card, per the skill.

### A18 — INFO — Wizard steps never advance except on Clone (verify)
- Where: Dubbing, Studio, STT. Step 1 carries `.active` in static markup and
  no JavaScript updater exists for these pages (Clone has `updateCloneSteps`).
  In the 1366x768 Studio screenshot, steps 1 and 2 both appear teal-bordered
  though only step 1 carries `.active` in the markup — verify the border rule
  before fixing.
- Fix: wire step advancement from real state, or drop the stepper on pages
  where it cannot advance.

## Not tested in this step

- 360px viewport (task asked for 480px; 480px passes with no overflow).
- Logged-in flows (login, real generation, clone, dub, STT, history rows) — all
  captures are logged-out, which is why History shows the logged-out state.
- Model-missing state (Kokoro files were present, so the download card and the
  voices error box with retry were not triggered).
- Real cloning on this VM (known broken: SIGILL / 502) or on the user's PC.
- Keyboard-only navigation beyond the missing focus-ring finding (A4).

## Screenshot index

All under `hidden_files/ui-verification-v0.9.0/` (goal folder), plus
`metrics.json` with per-capture measurements:

- 1366x768: home, tts, voices, clone, training, dub, studio, stt, history, account
- 1920x1080: home, tts, voices, clone, training, dub, studio, stt, history, account
- 480x854: home, tts, voices, clone, training, dub, studio, stt, history, account

## Research summary (grounding for the skill)

- Linear: near-black ladder #08090a to #28282c, hairline borders #23252a,
  Inter at 400/510/590/680, body 15px/1.6, 4px grid, 100–160ms ease-out motion,
  indigo #5e6ad2 as the only chrome colour, 32px controls, 28px sidebar rows.
- Stripe Dashboard: product-UI density, borders over shadows, tabular numerals,
  40–48px table rows, indigo #635bff / #533afd, 4px spacing base, radius 4–8px.
- Vercel/Geist: monochrome neutral ramp (#000000, #111111, #171717, #fafafa),
  hairline borders, 6px control radius, blue #0070f3 for links and focus.
- ElevenLabs: light marketing canvas with Inter body, container 1200px with
  24px gutters, TTS canvas plus right Settings/History panel, four-step
  generate flow, Studio chapters sidebar with multi-track timeline.
- AwaazAI keeps its own teal #2dd4bf to violet #8b5cf6 brand and dark theme;
  the skill adopts only the patterns above, with the gradient restricted to
  display text after the contrast measurement in A3.
