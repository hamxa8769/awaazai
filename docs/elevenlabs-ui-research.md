# ElevenLabs UI/UX Research — for AwaazAI v0.7.0

Sources (2026-11-26): ElevenLabs dashboard walkthrough 2026-10-21
(util-kits.io.vn), SaaSUI ElevenLabs 25 screens, fahimai / clarratools /
workstack hands-on guides, ElevenLabs docs as summarised in those guides.
Layout patterns + workflow only — NO ElevenLabs branding, logo or trademark
copied. AwaazAI keeps its own name, logo and teal→violet colours.

## 1. App shell (ElevenLabs, current dashboard)
- Left sidebar, dark, fixed full-height. Top: workspace/product switcher
  (ElevenCreative / ElevenAgents / ElevenAPI). Then main nav: Home, Voices,
  Studio, Flows, Chat, Assets. Then "pinned tools": Text to Speech, Voice
  Creation, Sound Effects, Music, Speech to Text, + "More tools" menu.
- Bottom of sidebar: user / workspace, credits balance, plan. Footer is
  PINNED — it never scrolls away and never overlaps the nav; the nav list
  itself is the only scrolling region.
- Top bar (per page): page title, model picker where relevant, credits
  counter visible at all times, user avatar/menu at right.
- Main content: centred column, generous whitespace, one primary action
  per screen, secondary actions as quiet buttons/links. Light theme on
  ElevenLabs marketing/app (2026); AwaazAI stays dark — same spacing
  discipline, not the same colours.
- Home: greeting ("Good evening"), prompt-first "What would you like to
  create?" bar, large feature tiles (Instant speech, Audiobook, Dubbing,
  Music, Voice cloning, Speech to Text), "Latest from the library" voice
  list, "Create or clone a voice" panel on the right.

## 2. Text to Speech — workflow
1. Open Text to Speech from pinned sidebar.
2. Paste/type script into the MAIN central text area. Character counter at
   the bottom (e.g. 149 / 10,000). Audio tags ([whispers], [laughs]) are
   highlighted in the editor.
3. Pick a voice in the Voice panel — searchable library, "Recommended for
   your text", each voice has a sample-play button. Voice is shown by name
   above the text box once chosen.
4. Model row: picker (Eleven v4 default, v3, Multilingual v2, Flash v2.5),
   each with a one-line description.
5. Settings: Stability (Creative→Robust) and Similarity (Low→High) sliders
   only (v4 has NO speed control). Cost is shown on the Generate button.
6. Click "Generate speech" → generation cards appear below with play,
   thumbs up/down, download. Button becomes "Regenerate speech".
7. Scripts longer than one generation belong in Studio, not TTS.

## 3. Voices — workflow
- Voices page: tabs Personal / Library. Library is searchable + filterable
  (language, gender, age, accent, use case: narration / conversational /
  character), trending voices, each card: name, description/tags, sample play.
- Add Voice → chooser with 4 routes side by side: Instant Voice Clone
  (10 s minimum, best ~3 min), Professional Voice Clone (10 min minimum,
  best 30+ min), Voice Design (text prompt, no recording), Voice Remixing
  (existing voice + prompt).
- Clone flow: upload clean audio → name + description → consent
  verification (must confirm permission) → ready in ~1 min (instant).

## 4. Dubbing — workflow
1. Dubbing in sidebar → "Create Dub".
2. Upload video/audio (MP4/MOV) or paste a YouTube URL.
3. Source language (auto-detect) + target language(s).
4. Choose: keep original background audio or not; voice similarity setting.
5. Click Dub → processing 2–10 min → review segments → download dubbed
   video. Cost shown BEFORE generating (per source minute per language).

## 5. Studio — workflow
- Start page: "What would you like to create?" prompt bar (+ attach file),
  Inspiration templates (Film trailer, Explainer video, Product video,
  Audio documentary, How to tutorial, Audio podcast, Captions), Upload,
  "New blank project".
- Below: All / Video / Audio tabs, search, list-or-grid view of recent
  projects. Audio projects = long narration/podcast/audiobook; video
  projects = clips + images + speech + music + captions.
- Editor: multi-track timeline (trim/split/duplicate), chapters sidebar
  (auto-detected from imported documents, 500 ch / 400 para / 5000 chars
  per paragraph), different voice per section with colour marker,
  "Replace voice across project", pronunciations editor, paragraph
  locking, "Insert break" pauses up to 3 s, generation history.

## 6. Speech to Text — workflow
- Scribe interface: drop a file, or Upload / URL / existing assets /
  microphone record. Auto-detect language chip (or pick one).
- Settings panel: Tag audio events (on), Include subtitles, No verbatim
  (remove fillers), Assign speakers from library, Keyterms field.
- Result: timestamped transcript, speaker labels, subtitle track.

## 7. History / Assets / Settings
- History is per-generation cards/rows: play, download, delete, filter by
  type, search. Assets = saved files/voices in one place.
- Settings/Account: profile, plan + credits usage (bar + numbers), API key,
  billing. Credits are ALWAYS visible (sidebar + top bar), cost is shown
  BEFORE spending, never after.

## 8. States (ElevenLabs discipline to copy)
- Loading: skeleton/spinner in place, never a bare "Loading…" line that can
  stick forever; every async load has an error state with retry.
- Empty: illustration-free but clear — "No projects yet" + a Create CTA,
  never a blank page.
- Error: plain-language message + what to do next + retry button.
- Disabled: buttons that cannot run yet are visibly disabled with the
  reason next to them (e.g. "Login required", "Model not downloaded").

## 9. Design tokens to copy (patterns, not brand)
- Spacing scale: 8 / 12 / 16 / 24 / 32 px. Page padding 24 px, card
  padding 20–24 px, card radius 12–16 px, button radius 10 px, pill radius
  999 px. ONE max-width for content (~1080–1120 px), centred.
- Hierarchy: one H1 per page (21–24 px), section H2 17–18 px, body 15 px,
  muted 13–14 px. Muted text is for meta only, never for primary labels.
- Buttons: one primary (gradient/solid) per screen; secondary = outline;
  tertiary = text link. Danger = red outline only.
- Sidebar: 248–264 px wide, nav item 40–44 px tall, 15 px font, icon
  18–20 px, active = filled background + accent left border. Sidebar
  footer pinned, compact (max ~110 px): avatar+name, credits line,
  one small button.

## 10. Audit — CURRENT AwaazAI frontend bugs (v0.6.0, found 2026-11-26)
B1. Sidebar footer too tall (~180 px: user pill + credits + Logout +
    Check-for-updates + update-msg + "Local-first…" note). At 1366×768
    (viewport ~660–700 px after browser chrome/taskbar) brand (~70) +
    nav 9 items (~430) + footer (~180) = ~680 px → nav overflows, the
    Speech-to-Text item is half-hidden behind the nav scrollbar, footer
    competes for space. FIX: compact footer (~110 px), nav is the only
    scroller, thinner scrollbar, nav item padding 10 px.
B2. Version hardcoded in TWO places (brand "v0.6.0 · local" and footer
    "AwaazAI v0.6.0 — Engine…"). A v0.6.0 screenshot showed "v0.5.0" in
    the sidebar — stale string survived a bump. FIX: single source of
    truth — version comes from /api/health at runtime; no hardcoded
    version in HTML.
B3. Content max-width 860 px is too narrow for the voice grid / split
    panels; cards of different widths, inconsistent top margins
    (.card margin-top 22 px vs .page > .card:first-child 0). FIX:
    max-width 1120 px, uniform 16 px gaps, one card style.
B4. Voice list stuck state: "Loading voices…" is a plain <p> with no
    timeout/retry; when the Kokoro model is missing the dropdown also
    says "Loading voices…". FIX: model-missing state replaces the grid
    entirely (download card + progress), voices load has 10 s timeout +
    error + retry button.
B5. TTS page is one long stacked card (text → search → grid → fallback
    <details> dropdown → speed → buttons → player → notes). ElevenLabs
    splits it: editor left, voice/settings right. FIX: two-column TTS
    layout (editor + output left, voice panel right) collapsing to one
    column < 900 px.
B6. Dubbing/Studio/STT pages repeat the same long-card stack; no
    step indicator except Clone. FIX: step header (1 Upload → 2 Settings
    → 3 Generate → 4 Result) on Dub/STT/Studio, result panel hidden
    until there is a result.
B7. Home "Honest note" is a wall of text; stats show "—" when logged
    out with no explanation. FIX: getting-started checklist with REAL
    completion state (models downloaded? from /api/models/status;
    logged in?; first TTS done? from history count), stats show 0 +
    label when logged out.
B8. Top bar: title + two pills wrap awkwardly at 1366 px; no breadcrumb,
    no user menu. FIX: top bar = breadcrumb/title left, engine pill +
    credits pill + avatar (initial) right; hide engine pill text on
    narrow screens, keep the dot.
B9. Mobile: sidebar off-canvas works, but content padding + voice grid
    minmax(140 px) still overflow at 360 px; wizard steps stack to
    full-width rows (fine) but dropzones have no min height. FIX: test
    480 px + 360 px, grid minmax(150 px, 1fr), dropzone min-height.
B10. Inconsistent labels: "Urdu + English" badge promises Urdu, but
    Qwen does not support Urdu (422) — misleading on Home. FIX: badge
    becomes "English · 10 languages" with an honest Urdu note in Clone.
B11. Toasts exist but several buttons have no disabled/loading state
    wired (e.g. dub/studio submit while running). FIX: every async
    button disables + spinner + restores; double-submit blocked.
B12. Footer repeats engine credits on every page (noise). FIX: move to
    Account → About card only.
