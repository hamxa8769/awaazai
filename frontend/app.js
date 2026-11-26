// AwaazAI frontend — ElevenLabs-style rebuild (frontend only).
// Calls the local FastAPI backend. No fake audio: every clip comes from
// POST /api/tts (Kokoro-82M for English, Piper for Urdu) or POST /api/clone (Qwen3-TTS).
// Version comes from GET /api/health at runtime — never hardcoded here.
const $ = (id) => document.getElementById(id);
const voiceSel = $("voice"), textEl = $("text"), speedEl = $("speed"),
  speedVal = $("speed-val"), btn = $("generate"), msg = $("msg"),
  player = $("player"), download = $("download"), pill = $("status-pill"),
  creditsPill = $("credits-pill"),
  logoutBtn = $("logout-btn");

let audioUrl = null;
let token = localStorage.getItem("awaazai_token") || null;
let username = localStorage.getItem("awaazai_user") || null;
const DEMO_LIMIT = 5;
let demoUsed = Number(localStorage.getItem("awaazai_demo_used") || 0);

// ---- shared state ----
let allVoices = [];            // /api/voices list (id, name, gender, language_name)
let historyCache = [];         // /api/history list, newest first
let savedVoicesCache = [];     // /api/voices/saved list
let historyFilter = "all";
let ttsGenderFilter = "all";
let libraryGenderFilter = "all";
let ttsLangFilter = "all";       // all | en (non-Urdu) | ur (Piper Urdu voices)
let libraryLangFilter = "all";
let piperComplete = null;      // null = unknown, true/false from /api/models/status
let piperPollTimer = null;
let modelEndpointAvailable = null; // null = unknown, true/false once probed
let modelPollTimer = null;
let modelsComplete = null;     // null = unknown, true/false from /api/models/status
let appVersion = null;

// ---- toasts (optional Retry action on errors) ----
function showToast(message, type, retryLabel, retryFn) {
  const box = $("toast-container");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  const span = document.createElement("span");
  span.textContent = message;
  el.appendChild(span);
  if (retryFn) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "toast-retry";
    retry.textContent = retryLabel || "Retry";
    retry.addEventListener("click", () => { el.remove(); retryFn(); });
    el.appendChild(retry);
  }
  box.appendChild(el);
  setTimeout(() => { el.remove(); }, 6000);
}

// ---- visible busy state (spinner + disabled) on any button ----
function setBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    if (button.dataset.origText === undefined) button.dataset.origText = button.textContent;
    button.disabled = true;
    button.innerHTML = "";
    const sp = document.createElement("span");
    sp.className = "spinner";
    button.appendChild(sp);
    button.appendChild(document.createTextNode(label || "Working…"));
  } else {
    button.disabled = false;
    if (button.dataset.origText !== undefined) {
      button.textContent = button.dataset.origText;
      delete button.dataset.origText;
    }
  }
}

// ---- fetch with a timeout so async loads never hang forever ----
async function fetchTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 10000);
  try {
    return await fetch(url, { ...(opts || {}), signal: ctrl.signal });
  } finally { clearTimeout(t); }
}

function authHeaders(extra) {
  const h = extra || {};
  if (token) h["Authorization"] = "Bearer " + token;
  return h;
}

function setCredits(n) {
  const loggedIn = token !== null && n !== null && n !== undefined;
  const creditsText = loggedIn ? `Credits: ${n}` : "Credits: login";
  const pillText = creditsPill.querySelector(".pill-text");
  if (pillText) pillText.textContent = creditsText;
  else creditsPill.textContent = creditsText;
  const side = $("sidebar-credits");
  if (side) side.textContent = loggedIn ? `Credits: ${n}` : "Credits: login to see";
  const stat = $("stat-credits");
  if (stat) stat.textContent = loggedIn ? String(n) : "0";
  const prof = $("profile-credits");
  if (prof) prof.textContent = loggedIn ? String(n) : "0";
  const usage = $("usage-credits");
  if (usage) usage.textContent = loggedIn ? String(n) : "0";
}

function setAvatar() {
  const initial = username ? username.charAt(0).toUpperCase() : "G";
  const fa = $("footer-avatar");
  if (fa) { fa.textContent = initial; fa.setAttribute("aria-label", username || "Guest"); }
  const ta = $("top-avatar");
  if (ta) { ta.textContent = initial; ta.setAttribute("aria-label", username ? username : "Account (guest)"); }
  const fn = $("footer-name");
  if (fn) fn.textContent = username || "Guest";
}

function ttsCostFor(len) {
  return Math.max(1, Math.ceil(len / 100));
}

function updateTtsCost() {
  const len = (textEl.value || "").length;
  const words = (textEl.value || "").trim() ? (textEl.value || "").trim().split(/\s+/).length : 0;
  const count = $("tts-count");
  if (count) count.textContent = `${len}/1000`;
  const w = $("tts-words");
  if (w) w.textContent = `${words} words`;
  const cost = ttsCostFor(len);
  const prev = $("tts-cost-preview");
  if (prev) {
    prev.textContent = token
      ? `Cost: ${cost} credit${cost === 1 ? "" : "s"}`
      : `Cost: ${cost} credit${cost === 1 ? "" : "s"} when logged in · Demo: ${Math.max(0, DEMO_LIMIT - demoUsed)}/${DEMO_LIMIT} left`;
  }
  // Cost on the Generate button itself (label restored by setBusy after runs).
  if (btn && btn.dataset.origText === undefined) {
    btn.textContent = token ? `Generate audio · ${cost} credit${cost === 1 ? "" : "s"}` : "Generate audio · demo";
  }
}

function updateDemoLabel() {
  const dl = $("demo-left");
  if (dl) dl.textContent = `${Math.max(0, DEMO_LIMIT - demoUsed)} demo generations`;
  const acc = $("demo-left-account");
  if (acc) acc.textContent = `${Math.max(0, DEMO_LIMIT - demoUsed)} demo generations`;
  const tc = $("tts-cost");
  if (tc) tc.textContent = token
    ? "Logged in: 1 credit per 100 characters."
    : `Demo: is session mein ${Math.max(0, DEMO_LIMIT - demoUsed)} / ${DEMO_LIMIT} generations bache hain — login par 100 credits milte hain.`;
  updateTtsCost();
}

// ---- Home getting-started checklist (REAL completion state) ----
function updateChecklist() {
  const set = (id, done) => {
    const li = $(id);
    if (!li) return;
    li.classList.toggle("done", !!done);
    const st = li.querySelector(".check-state");
    if (st) st.textContent = done ? "✓" : "○";
  };
  set("check-models", modelsComplete === true);
  set("check-login", !!token);
  set("check-tts", historyCache.some((h) => h.type === "tts"));
  set("check-clone", historyCache.some((h) => h.type === "clone"));
}

function renderAuth() {
  const loggedIn = !!token;
  $("auth-forms").classList.toggle("hidden", loggedIn);
  $("auth-logged").classList.toggle("hidden", !loggedIn);
  if (logoutBtn) logoutBtn.classList.toggle("hidden", !loggedIn);
  const prof = $("profile-card");
  if (prof) prof.classList.toggle("hidden", !loggedIn);
  setAvatar();
  if (loggedIn) {
    $("auth-logged").textContent = `${username} — logged in. History aur saved voices neeche dikhengi.`;
    const pn = $("profile-name");
    if (pn) pn.textContent = username;
    loadProfile();
  }
  updateDemoLabel();
  updateChecklist();
}

async function refreshCredits() {
  if (!token) { setCredits(null); return; }
  try {
    const r = await fetchTimeout("/api/credits", { headers: authHeaders() });
    if (r.status === 401) { doLogout(true); return; }
    const d = await r.json();
    setCredits(d.credits);
  } catch { /* keep old value */ }
}

// ---- profile card from /api/auth/me ----
async function loadProfile() {
  if (!token) return;
  try {
    const r = await fetchTimeout("/api/auth/me", { headers: authHeaders() });
    if (!r.ok) return;
    const d = await r.json();
    const u = d.user || {};
    const pn = $("profile-name");
    if (pn) pn.textContent = u.username || username || "—";
    const ps = $("profile-since");
    if (ps) ps.textContent = u.created_at ? new Date(u.created_at).toLocaleDateString() : "—";
    if (d.credits !== undefined && d.credits !== null) setCredits(d.credits);
  } catch { /* profile is best-effort; login state already shown */ }
}

function doLogout(silent) {
  if (token) fetch("/api/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
  token = null; username = null;
  localStorage.removeItem("awaazai_token");
  localStorage.removeItem("awaazai_user");
  setCredits(null);
  historyCache = [];
  savedVoicesCache = [];
  $("history-list").innerHTML = '<div class="empty-state"><p class="muted">Login karein to history dikhegi.</p><button data-goto="account">Login</button></div>';
  $("voices-list").innerHTML = '<p class="muted">Login karein to saved voices dikhengi.</p>';
  const ve = $("voices-empty");
  if (ve) ve.classList.add("hidden");
  $("saved-voice").innerHTML = '<option value="">— Nayi reference upload karein —</option>';
  const prof = $("profile-card");
  if (prof) prof.classList.add("hidden");
  const sg = $("stat-generations");
  if (sg) sg.textContent = "0";
  const sv = $("stat-voices");
  if (sv) sv.textContent = "0";
  const ug = $("usage-generations");
  if (ug) ug.textContent = "0";
  const uv = $("usage-voices");
  if (uv) uv.textContent = "0";
  if (!silent) { $("auth-msg").textContent = "Logged out."; showToast("Logged out.", "success"); }
  renderAuth();
}

async function authAction(path, button) {
  const u = $("auth-user").value.trim(), p = $("auth-pass").value;
  if (!u || !p) { $("auth-msg").textContent = "Username aur password dono likhein."; showToast("Username aur password dono likhein.", "error"); return; }
  $("auth-msg").textContent = "Please wait…";
  setBusy(button, true, "Please wait…");
  try {
    const r = await fetchTimeout(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    }, 15000);
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || "Auth failed");
    token = d.token; username = d.user.username;
    localStorage.setItem("awaazai_token", token);
    localStorage.setItem("awaazai_user", username);
    $("auth-msg").textContent = `Welcome, ${username}! ${d.user.credits} credits mil gaye.`;
    showToast(`Welcome, ${username}!`, "success");
    setCredits(d.user.credits);
    renderAuth();
    loadHistory(); loadSavedVoices();
  } catch (e) {
    $("auth-msg").textContent = "Error: " + e.message;
    showToast("Error: " + e.message, "error");
  } finally { setBusy(button, false); }
}

$("login-btn").addEventListener("click", (ev) => authAction("/api/auth/login", ev.currentTarget));
$("signup-btn").addEventListener("click", (ev) => authAction("/api/auth/signup", ev.currentTarget));
if (logoutBtn) logoutBtn.addEventListener("click", () => doLogout(false));
const logoutBtn2 = $("logout-btn-2");
if (logoutBtn2) logoutBtn2.addEventListener("click", () => doLogout(false));
// "Get more credits" is disabled in the markup (Coming Soon) — no handler:
// there is no payment flow to run, and a button that always errors is a lie.

// ---- change password ----
const pwBtn = $("pw-btn");
if (pwBtn) pwBtn.addEventListener("click", async () => {
  const cur = $("pw-current").value, nw = $("pw-new").value;
  const pwMsg = $("pw-msg");
  if (!token) { pwMsg.textContent = "Change password ke liye pehle login karein."; showToast("Pehle login karein.", "error"); return; }
  if (!cur || !nw) { pwMsg.textContent = "Current aur new password dono likhein."; return; }
  setBusy(pwBtn, true, "Changing…");
  try {
    const r = await fetchTimeout("/api/auth/change-password", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ current_password: cur, new_password: nw }),
    }, 15000);
    if (r.status === 404) {
      pwMsg.textContent = "Change password is build mein available nahi hai — backend endpoint abhi nahi bana.";
      showToast("Change password is build mein available nahi hai.", "error");
      return;
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || "Change password failed");
    pwMsg.textContent = "Password change ho gaya.";
    showToast("Password change ho gaya.", "success");
    $("pw-current").value = ""; $("pw-new").value = "";
  } catch (e) {
    pwMsg.textContent = "Error: " + e.message;
    showToast("Error: " + e.message, "error");
  } finally { setBusy(pwBtn, false); }
});

// ---- health: version + engine status come from the API at runtime ----
async function loadHealth() {
  try {
    const r = await fetchTimeout("/api/health", {}, 10000);
    const d = await r.json();
    appVersion = d.version || null;
    const bv = $("brand-version");
    if (bv) bv.textContent = appVersion ? `v${appVersion} · local` : "local";
    const av = $("about-version");
    if (av) av.textContent = appVersion ? `v${appVersion}` : "unknown";
    const ae = $("about-engines");
    if (ae) ae.textContent = `Engines: Kokoro-82M (Apache 2.0) · Cloning: Qwen3-TTS 0.6B Base (Apache 2.0) · STT: faster-whisper tiny — engine status: ${d.engine_loaded ? "Kokoro loaded" : "Kokoro not loaded yet"} · cloning: ${d.cloning || "unknown"} · STT: ${d.stt || "unknown"}`;
    const ready = d.status === "ok" && d.engine_loaded === true;
    const filesPresent = !!d.model_files_present;
    const pillText = pill.querySelector(".pill-text");
    // A1: the pill must report the REAL loaded state, not file presence.
    // Files present + engine not loaded = amber "not loaded", never green.
    pill.classList.remove("ok", "bad", "warn");
    if (pillText) {
      if (d.status !== "ok") { pillText.textContent = "Engine: error"; pill.classList.add("bad"); }
      else if (ready) { pillText.textContent = "Engine: Kokoro-82M ready"; pill.classList.add("ok"); }
      else if (filesPresent) { pillText.textContent = "Models present — engine not loaded"; pill.classList.add("warn"); }
      else { pillText.textContent = "Engine: Kokoro-82M model missing"; pill.classList.add("bad"); }
    }
    if (d.status === "ok" && !filesPresent) showModelCard(true);
  } catch {
    const pillText = pill.querySelector(".pill-text");
    if (pillText) pillText.textContent = "Engine: unreachable";
    pill.classList.add("bad");
    const bv = $("brand-version");
    if (bv) bv.textContent = "local";
  }
}

// ---- voices: shared card renderer (TTS panel list + Library grid) ----
function voiceCard(v) {
  const card = document.createElement("div");
  card.className = "voice-card" + (voiceSel.value === v.id ? " selected" : "");
  card.setAttribute("role", "option");
  card.setAttribute("aria-selected", voiceSel.value === v.id ? "true" : "false");
  card.tabIndex = 0;
  const name = document.createElement("div");
  name.className = "voice-name";
  name.textContent = v.name;
  const meta = document.createElement("div");
  meta.className = "voice-meta";
  meta.textContent = v.language_name || v.language || "";
  const gender = document.createElement("span");
  gender.className = "voice-gender";
  gender.textContent = v.gender === "female" ? "♀ Female" : v.gender === "male" ? "♂ Male" : (v.gender || "");
  card.append(name, meta, gender);
  if (v.engine === "piper") {
    const badge = document.createElement("span");
    badge.className = "voice-engine";
    badge.textContent = "Urdu · Piper";
    card.append(badge);
  }
  const pick = () => {
    voiceSel.value = v.id;
    document.querySelectorAll(".voice-card").forEach((c) => c.classList.remove("selected"));
    document.querySelectorAll(".voice-card").forEach((c) => c.setAttribute("aria-selected", "false"));
    card.classList.add("selected");
    card.setAttribute("aria-selected", "true");
  };
  card.addEventListener("click", pick);
  card.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } });
  return card;
}

function filterVoices(q, gender, lang) {
  const query = (q || "").trim().toLowerCase();
  const langOk = (v) => lang === "all" || (lang === "ur" ? v.language === "ur" : v.language !== "ur");
  return allVoices.filter((v) =>
    (gender === "all" || v.gender === gender) && langOk(v) &&
    (!query || `${v.name} ${v.id} ${v.language_name} ${v.gender}`.toLowerCase().includes(query)));
}

function renderVoiceGrid() {
  const grid = $("voice-grid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!allVoices.length) {
    grid.innerHTML = '<p class="muted">No voices loaded yet.</p>';
    return;
  }
  const list = filterVoices($("voice-search").value, ttsGenderFilter, ttsLangFilter);
  if (!list.length) {
    grid.innerHTML = '<p class="muted">Koi voice is search se match nahi karti.</p>';
    return;
  }
  for (const v of list) grid.appendChild(voiceCard(v));
}

function renderLibraryGrid() {
  const grid = $("library-grid");
  if (!grid) return;
  grid.innerHTML = "";
  if (!allVoices.length) {
    grid.innerHTML = '<p class="muted">No voices loaded yet.</p>';
    return;
  }
  const list = filterVoices($("library-search").value, libraryGenderFilter, libraryLangFilter);
  if (!list.length) {
    grid.innerHTML = '<p class="muted">Koi voice is search se match nahi karti.</p>';
    return;
  }
  for (const v of list) grid.appendChild(voiceCard(v));
}

function showVoicesError(show, message) {
  for (const [boxId, textId] of [["voices-error", "voices-error-text"], ["library-error", "library-error-text"]]) {
    const box = $(boxId);
    if (!box) continue;
    box.classList.toggle("hidden", !show);
    if (show && message) {
      const t = $(textId);
      if (t) t.textContent = message;
    }
  }
}

const voiceSearch = $("voice-search");
if (voiceSearch) voiceSearch.addEventListener("input", renderVoiceGrid);
const librarySearch = $("library-search");
if (librarySearch) librarySearch.addEventListener("input", renderLibraryGrid);
voiceSel.addEventListener("change", () => { renderVoiceGrid(); renderLibraryGrid(); });
document.querySelectorAll("#tts-gender-filters .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#tts-gender-filters .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    ttsGenderFilter = chip.dataset.gender;
    renderVoiceGrid();
  });
});
document.querySelectorAll("#library-gender-filters .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#library-gender-filters .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    libraryGenderFilter = chip.dataset.gender;
    renderLibraryGrid();
  });
});
document.querySelectorAll("#tts-lang-filters .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#tts-lang-filters .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    ttsLangFilter = chip.dataset.lang;
    renderVoiceGrid();
  });
});
document.querySelectorAll("#library-lang-filters .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#library-lang-filters .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    libraryLangFilter = chip.dataset.lang;
    renderLibraryGrid();
  });
});

async function loadVoices() {
  try {
    const r = await fetchTimeout("/api/voices", {}, 10000);
    if (!r.ok) {
      let detail = "voices failed";
      try { detail = (await r.json()).detail || detail; } catch { /* keep default */ }
      throw new Error(detail);
    }
    const d = await r.json();
    allVoices = d.voices || [];
    voiceSel.innerHTML = "";
    for (const v of allVoices) {
      const o = document.createElement("option");
      o.value = v.id;
      o.textContent = `${v.name} — ${v.language_name}`;
      voiceSel.appendChild(o);
    }
    voiceSel.value = "af_heart";
    // Same voice list for Dubbing and Studio pickers.
    for (const selId of ["dub-voice", "studio-voice"]) {
      const sel = $(selId);
      if (!sel) continue;
      sel.innerHTML = "";
      for (const v of allVoices) {
        const o = document.createElement("option");
        o.value = v.id;
        o.textContent = `${v.name} — ${v.language_name}`;
        sel.appendChild(o);
      }
      sel.value = "af_heart";
    }
    showVoicesError(false);
    renderVoiceGrid();
    renderLibraryGrid();
    // /api/voices loads the Kokoro engine as a side effect, so the engine
    // pill may have been fetched before the engine existed — re-check the
    // real loaded state now so the pill settles on the truth.
    loadHealth();
    if (msg.textContent.startsWith("Voices load nahi hui")) msg.textContent = "";
  } catch (e) {
    showVoicesError(true, "Voices load nahi hui: " + e.message + " (10s timeout) — dobara try karein, ya model-downloader card dekhein.");
    showToast("Voices load nahi hui: " + e.message, "error", "Retry", () => { showVoicesError(false); loadVoices(); });
    renderVoiceGrid();
    renderLibraryGrid();
  }
}
const voicesRetry = $("voices-retry");
if (voicesRetry) voicesRetry.addEventListener("click", () => { showVoicesError(false); loadVoices(); });
const libraryRetry = $("library-retry");
if (libraryRetry) libraryRetry.addEventListener("click", () => { showVoicesError(false); loadVoices(); });

// ---- Kokoro model downloader: missing models REPLACE the voice panel ----
function showModelCard(show) {
  const card = $("model-card");
  const panel = $("voice-panel");
  if (!card || !panel) return;
  card.classList.toggle("hidden", !show);
  panel.classList.toggle("hidden", show);
  if (show) {
    const note = $("model-manual-note");
    if (note && modelEndpointAvailable === false) note.classList.remove("hidden");
    loadModelStatus();
  }
}

async function loadModelStatus() {
  try {
    const r = await fetchTimeout("/api/models/status", {}, 10000);
    if (r.status === 404) {
      modelEndpointAvailable = false;
      const note = $("model-manual-note");
      if (note) note.classList.remove("hidden");
      const pt = $("model-progress-text");
      if (pt) pt.textContent = "Model downloader is build mein nahi hai — manual download note dekhein.";
      const mst = $("models-state-text");
      if (mst) mst.textContent = "Model downloader is build mein nahi hai — manual download note dekhein (TTS page).";
      return null;
    }
    if (!r.ok) return null;
    modelEndpointAvailable = true;
    const d = await r.json();
    modelsComplete = !!d.complete;
    updateModelCard(d);
    updateChecklist();
    return d;
  } catch {
    modelEndpointAvailable = false;
    const note = $("model-manual-note");
    if (note) note.classList.remove("hidden");
    return null;
  }
}

function updateModelCard(d) {
  const card = $("model-card");
  if (!card || !d) return;
  // ---- Piper Urdu group (v0.8.0): same status payload, separate UI ----
  const p = d.piper || null;
  if (p) {
    piperComplete = !!p.complete;
    const pst = $("piper-state-text"), pwrap = $("piper-progress-wrap"),
      pbar = $("piper-progress"), ppt = $("piper-progress-text"),
      pbtn = $("piper-download-btn");
    const pTotal = p.total_bytes || 0, pDone = p.downloaded_bytes || 0;
    if (p.complete) {
      if (pst) pst.textContent = "Urdu voices downloaded — Aegis + Fasih ready (Piper).";
      if (pwrap) pwrap.classList.add("hidden");
      if (ppt) ppt.textContent = "";
      if (pbtn) pbtn.classList.add("hidden");
      if (piperPollTimer) { clearTimeout(piperPollTimer); piperPollTimer = null; }
    } else {
      if (pst) pst.textContent = p.downloading ? "Urdu voices downloading…" : "Urdu voices missing — download karein to Urdu TTS chalega (~126 MB).";
      if (pbtn) pbtn.classList.remove("hidden");
      if (pTotal > 0) {
        if (pwrap) pwrap.classList.remove("hidden");
        if (pbar) pbar.style.width = Math.round((pDone / pTotal) * 100) + "%";
        if (ppt) ppt.textContent = `Downloaded ${(pDone / 1048576).toFixed(1)} / ${(pTotal / 1048576).toFixed(1)} MB (${Math.round((pDone / pTotal) * 100)}%)`;
      }
      if (p.downloading) piperPollTimer = setTimeout(loadModelStatus, 2000);
      else if (piperPollTimer) { clearTimeout(piperPollTimer); piperPollTimer = null; }
    }
  }
  const total = d.total_bytes || 0, done = d.downloaded_bytes || 0;
  const wrap = $("model-progress-wrap"), bar = $("model-progress"), pt = $("model-progress-text");
  const mst = $("models-state-text");
  const mwrap = $("models-progress-wrap"), mbar = $("models-progress"), mpt = $("models-progress-text");
  if (d.complete) {
    card.classList.add("hidden");
    const panel = $("voice-panel");
    if (panel) panel.classList.remove("hidden");
    if (modelPollTimer) { clearTimeout(modelPollTimer); modelPollTimer = null; }
    if (mst) mst.textContent = "Kokoro models downloaded — TTS ready.";
    if (mwrap) mwrap.classList.add("hidden");
    if (mpt) mpt.textContent = "";
    if (allVoices.length) { renderVoiceGrid(); renderLibraryGrid(); }
    else loadVoices();
    return;
  }
  card.classList.remove("hidden");
  const panel = $("voice-panel");
  if (panel) panel.classList.add("hidden");
  const pctText = total > 0
    ? `Downloaded ${(done / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB (${Math.round((done / total) * 100)}%)`
    : (d.downloading ? "Downloading…" : "Models missing.");
  if (total > 0) {
    if (wrap) wrap.classList.remove("hidden");
    if (bar) bar.style.width = Math.round((done / total) * 100) + "%";
    if (mwrap) mwrap.classList.remove("hidden");
    if (mbar) mbar.style.width = Math.round((done / total) * 100) + "%";
  }
  if (pt) pt.textContent = pctText;
  if (mpt) mpt.textContent = pctText;
  if (mst) mst.textContent = d.downloading ? "Kokoro models downloading…" : "Kokoro models missing — download karein to TTS chalega.";
  if (d.downloading) {
    modelPollTimer = setTimeout(loadModelStatus, 2000);
  } else if (modelPollTimer) { clearTimeout(modelPollTimer); modelPollTimer = null; }
}

async function startModelDownload(button) {
  setBusy(button, true, "Starting download…");
  try {
    const r = await fetchTimeout("/api/models/download", { method: "POST" }, 15000);
    if (r.status === 404) {
      modelEndpointAvailable = false;
      const note = $("model-manual-note");
      if (note) note.classList.remove("hidden");
      showToast("Model downloader is build mein nahi hai — manual download note dekhein.", "error");
      return;
    }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || "Download start nahi hua");
    showToast("Model download shuru ho gaya (~338 MB).", "success");
    loadModelStatus();
  } catch (e) {
    showToast("Error: " + e.message, "error");
    const note = $("model-manual-note");
    if (note) note.classList.remove("hidden");
  } finally { setBusy(button, false); }
}
const modelBtn = $("model-download-btn");
if (modelBtn) modelBtn.addEventListener("click", () => startModelDownload(modelBtn));
const modelsBtn = $("models-download-btn");
if (modelsBtn) modelsBtn.addEventListener("click", () => startModelDownload(modelsBtn));

// ---- Piper Urdu voices download (v0.8.0): same endpoint, group=piper ----
async function startPiperDownload(button) {
  setBusy(button, true, "Starting download…");
  try {
    const r = await fetchTimeout("/api/models/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group: "piper" }),
    }, 15000);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || "Download start nahi hua");
    showToast("Urdu voices download shuru ho gaya (~126 MB).", "success");
    loadModelStatus();
  } catch (e) {
    showToast("Error: " + e.message, "error");
  } finally { setBusy(button, false); }
}
const piperBtn = $("piper-download-btn");
if (piperBtn) piperBtn.addEventListener("click", () => startPiperDownload(piperBtn));

speedEl.addEventListener("input", () => { speedVal.textContent = Number(speedEl.value).toFixed(1) + "×"; });
textEl.addEventListener("input", updateTtsCost);
updateTtsCost();

function addTtsGenerationCard(text, voiceId, sizeKB) {
  const list = $("tts-generations");
  if (!list) return;
  const empty = list.querySelector("li.muted");
  if (empty && list.children.length === 1) list.innerHTML = "";
  const li = document.createElement("li");
  const when = new Date().toLocaleString();
  li.innerHTML = `<b>TTS</b> · ${voiceId} · ${when} · ${sizeKB} KB<br><span class="muted"></span>`;
  li.querySelector(".muted").textContent = (text || "").slice(0, 120);
  list.prepend(li);
  while (list.children.length > 5) list.removeChild(list.lastChild);
}

btn.addEventListener("click", async () => {
  const text = textEl.value.trim();
  if (!text) { msg.textContent = "Pehle kuch text likhein."; showToast("Pehle kuch text likhein.", "error"); return; }
  if (voiceSel.value.startsWith("ur_") && piperComplete === false) {
    msg.textContent = "Urdu voices download nahi hui — Account → Models se 'Download Urdu voices' dabayein (~126 MB).";
    showToast("Urdu voices missing — pehle download karein.", "error");
    return;
  }
  if (!token && demoUsed >= DEMO_LIMIT) {
    msg.textContent = "Demo limit khatam (5/5). Login ya signup karein — 100 free credits milte hain.";
    showToast("Demo limit khatam (5/5). Login karein.", "error");
    return;
  }
  setBusy(btn, true, "Generating…");
  msg.textContent = "Generating… (CPU par pehli dafa model load hone mein kuch second lag sakte hain)";
  try {
    const r = await fetch("/api/tts", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text, voice: voiceSel.value, speed: Number(speedEl.value) }),
    });
    if (r.status === 402) {
      const d = await r.json();
      throw new Error(d.detail + " Get more credits abhi Coming Soon hai.");
    }
    if (!r.ok) throw new Error((await r.json()).detail || "TTS failed");
    const blob = await r.blob();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    player.src = audioUrl; player.classList.remove("hidden");
    download.href = audioUrl; download.classList.remove("hidden");
    const remaining = r.headers.get("X-Credits-Remaining");
    if (remaining !== null) setCredits(Number(remaining));
    else { demoUsed += 1; localStorage.setItem("awaazai_demo_used", String(demoUsed)); updateDemoLabel(); }
    msg.textContent = `Ready — ${(blob.size / 1024).toFixed(0)} KB, engine ${r.headers.get("X-Engine") || "TTS"}.`;
    showToast("TTS audio ready.", "success");
    addTtsGenerationCard(text, voiceSel.value, (blob.size / 1024).toFixed(0));
    player.play().catch(() => {});
    if (token) loadHistory();
  } catch (e) {
    msg.textContent = "Error: " + e.message;
    showToast("Error: " + e.message, "error");
  } finally { setBusy(btn, false); }
});

// ---- History (cards, filter chips, date grouping) ----
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  return d.toLocaleDateString();
}

function renderHistory() {
  const list = $("history-list");
  const empty = $("history-empty");
  if (!list) return;
  const q = ($("history-search").value || "").trim().toLowerCase();
  const filtered = historyCache.filter((h) =>
    (historyFilter === "all" || h.type === historyFilter) &&
    (!q || `${h.type} ${h.voice} ${h.text_snippet}`.toLowerCase().includes(q)));
  list.innerHTML = "";
  if (!token) {
    // A10: logged-out history uses the real empty-state component + Login CTA.
    list.innerHTML = '<div class="empty-state"><p class="muted">Login karein to history dikhegi.</p><button data-goto="account">Login</button></div>';
    if (empty) empty.classList.add("hidden");
    return;
  }
  if (!historyCache.length) {
    list.innerHTML = '<p class="muted">Abhi koi history nahi — pehle TTS ya Clone generate karein.</p>';
    if (empty) {
      empty.classList.remove("hidden");
      const p = empty.querySelector("p");
      if (p) p.textContent = "Start with your first generation.";
    }
    return;
  }
  if (!filtered.length) {
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");
  let lastDay = null;
  for (const h of filtered) {
    const day = dayLabel(h.created_at);
    if (day !== lastDay) {
      const gh = document.createElement("h4");
      gh.className = "history-group-h";
      gh.textContent = day;
      list.appendChild(gh);
      lastDay = day;
    }
    const card = document.createElement("div");
    card.className = "history-card";
    const head = document.createElement("div");
    head.className = "history-head";
    const badge = document.createElement("span");
    badge.className = "type-badge";
    badge.textContent = h.type;
    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${h.voice} · ${h.credits_cost} credits · ${new Date(h.created_at).toLocaleString()}`;
    head.append(badge, meta);
    const snip = document.createElement("p");
    snip.className = "history-snippet muted";
    snip.textContent = h.text_snippet || "";
    const actions = document.createElement("div");
    actions.className = "history-actions";
    const audioEl = document.createElement("audio");
    audioEl.controls = true;
    audioEl.classList.add("hidden");
    if (h.has_audio) {
      const playBtn = document.createElement("button");
      playBtn.textContent = "▶ Play";
      playBtn.className = "btn secondary small";
      playBtn.addEventListener("click", async () => {
        setBusy(playBtn, true, "Loading…");
        try {
          const res = await fetch(`/api/history/${h.id}/audio`, { headers: authHeaders() });
          if (!res.ok) throw new Error("Audio load nahi hua");
          const blob = await res.blob();
          audioEl.src = URL.createObjectURL(blob);
          audioEl.classList.remove("hidden");
          audioEl.play().catch(() => {});
        } catch (e) {
          showToast("Error: " + e.message, "error");
        } finally { setBusy(playBtn, false); }
      });
      const dlBtn = document.createElement("button");
      dlBtn.textContent = "Download";
      dlBtn.className = "btn secondary small";
      dlBtn.addEventListener("click", async () => {
        setBusy(dlBtn, true, "Loading…");
        try {
          const res = await fetch(`/api/history/${h.id}/audio`, { headers: authHeaders() });
          if (!res.ok) throw new Error("Audio load nahi hua");
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `awaazai-${h.type}-${h.id}.wav`; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (e) { showToast("Error: " + e.message, "error"); }
        finally { setBusy(dlBtn, false); }
      });
      actions.append(playBtn, dlBtn);
    }
    const del = document.createElement("button");
    del.textContent = "Delete"; del.className = "btn secondary small";
    del.addEventListener("click", async () => {
      setBusy(del, true, "Deleting…");
      await fetch(`/api/history/${h.id}`, { method: "DELETE", headers: authHeaders() });
      showToast("History item delete ho gaya.", "success");
      loadHistory();
    });
    actions.appendChild(del);
    card.append(head, snip, actions, audioEl);
    list.appendChild(card);
  }
}

function renderTtsRecent() {
  const recent = $("tts-recent");
  if (!recent) return;
  const ttsItems = historyCache.filter((h) => h.type === "tts").slice(0, 3);
  if (!ttsItems.length) {
    // A10: logged-out Recent TTS uses the empty-state pattern with a Login CTA.
    recent.innerHTML = token
      ? '<li class="muted">Abhi koi TTS generation nahi — generate karein.</li>'
      : '<li class="empty-state"><p class="muted">Login karein to recent TTS generations dikhengi.</p><button data-goto="account">Login</button></li>';
    return;
  }
  recent.innerHTML = "";
  for (const h of ttsItems) {
    const li = document.createElement("li");
    const when = new Date(h.created_at).toLocaleString();
    li.innerHTML = `<b>TTS</b> · ${h.voice} · ${when}<br><span class="muted"></span>`;
    li.querySelector(".muted").textContent = h.text_snippet || "";
    recent.appendChild(li);
  }
}

async function loadHistory() {
  const list = $("history-list");
  if (!token) return;
  try {
    const r = await fetchTimeout("/api/history", { headers: authHeaders() }, 10000);
    if (!r.ok) throw new Error("history failed");
    const d = await r.json();
    historyCache = d.history || [];
    const stat = $("stat-generations");
    if (stat) stat.textContent = String(historyCache.length);
    const ug = $("usage-generations");
    if (ug) ug.textContent = String(historyCache.length);
    const recent = $("recent-list");
    if (recent) {
      recent.innerHTML = "";
      for (const h of historyCache.slice(0, 5)) {
        const li = document.createElement("li");
        const when = new Date(h.created_at).toLocaleString();
        li.innerHTML = `<b>${h.type.toUpperCase()}</b> · ${h.voice} · ${when}<br><span class="muted"></span>`;
        li.querySelector(".muted").textContent = h.text_snippet || "";
        recent.appendChild(li);
      }
      if (!historyCache.length) recent.innerHTML = '<li class="muted">Abhi koi history nahi — pehle TTS ya Clone generate karein.</li>';
    }
    renderHistory();
    renderTtsRecent();
    updateChecklist();
  } catch (e) {
    historyCache = [];
    if (list) {
      list.innerHTML = '<div class="error-box"><p class="muted">History load nahi hui (timeout ya server error).</p><button id="history-retry" class="btn secondary small">Retry loading history</button></div>';
      const retry = $("history-retry");
      if (retry) retry.addEventListener("click", loadHistory);
    }
    showToast("History load nahi hui.", "error", "Retry", loadHistory);
  }
}

document.querySelectorAll("#history-filters .chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    document.querySelectorAll("#history-filters .chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    historyFilter = chip.dataset.filter;
    renderHistory();
  });
});
const historySearch = $("history-search");
if (historySearch) historySearch.addEventListener("input", renderHistory);

// ---- Voices page tabs ----
document.querySelectorAll("#page-voices .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#page-voices .tab").forEach((t) => {
      t.classList.remove("active");
      t.setAttribute("aria-selected", "false");
    });
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    for (const name of ["library", "mine", "add"]) {
      const panel = $("voices-panel-" + name);
      if (panel) panel.classList.toggle("hidden", tab.dataset.tab !== name);
    }
    if (tab.dataset.tab === "mine" && token) loadSavedVoices();
  });
});

// ---- Saved voices (cards grid) ----
function renderSavedVoices() {
  const list = $("voices-list");
  const empty = $("voices-empty");
  if (!list) return;
  const q = ($("voices-search").value || "").trim().toLowerCase();
  const filtered = savedVoicesCache.filter((v) => !q || v.name.toLowerCase().includes(q));
  list.innerHTML = "";
  if (!token) {
    list.innerHTML = '<p class="muted">Login karein to saved voices dikhengi.</p>';
    if (empty) empty.classList.add("hidden");
    return;
  }
  if (!savedVoicesCache.length) {
    if (empty) empty.classList.remove("hidden");
    return;
  }
  if (empty) empty.classList.add("hidden");
  if (!filtered.length) {
    list.innerHTML = '<p class="muted">Koi saved voice is search se match nahi karti.</p>';
    return;
  }
  for (const v of filtered) {
    const card = document.createElement("div");
    card.className = "voice-card";
    const name = document.createElement("div");
    name.className = "voice-name";
    name.textContent = v.name;
    const meta = document.createElement("div");
    meta.className = "voice-meta";
    meta.textContent = `${v.language} · ${new Date(v.created_at).toLocaleDateString()}`;
    const actions = document.createElement("div");
    actions.className = "row actions";
    const useBtn = document.createElement("button");
    useBtn.textContent = "Use for clone";
    useBtn.className = "btn secondary small";
    useBtn.addEventListener("click", () => {
      showPage("clone");
      const sel = $("saved-voice");
      if (sel) sel.value = String(v.id);
      updateCloneSteps();
      showToast(`"${v.name}" clone ke liye select ho gayi.`, "success");
    });
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "btn secondary small";
    del.addEventListener("click", async () => {
      setBusy(del, true, "Deleting…");
      await fetch(`/api/voices/saved/${v.id}`, { method: "DELETE", headers: authHeaders() });
      showToast(`"${v.name}" delete ho gayi.`, "success");
      loadSavedVoices();
    });
    actions.append(useBtn, del);
    card.append(name, meta, actions);
    list.appendChild(card);
  }
}

async function loadSavedVoices() {
  const list = $("voices-list"), sel = $("saved-voice");
  const dubSel = $("dub-saved-voice");
  if (dubSel) dubSel.innerHTML = '<option value="">— Kokoro voice use karein —</option>';
  if (!token) return;
  try {
    const r = await fetchTimeout("/api/voices/saved", { headers: authHeaders() }, 10000);
    if (!r.ok) throw new Error("saved voices failed");
    const d = await r.json();
    savedVoicesCache = d.voices || [];
    sel.innerHTML = '<option value="">— Nayi reference upload karein —</option>';
    const statV = $("stat-voices");
    if (statV) statV.textContent = String(savedVoicesCache.length);
    const uv = $("usage-voices");
    if (uv) uv.textContent = String(savedVoicesCache.length);
    for (const v of savedVoicesCache) {
      const o = document.createElement("option");
      o.value = v.id; o.textContent = `${v.name} (${v.language})`;
      sel.appendChild(o);
      const od = document.createElement("option");
      od.value = v.id; od.textContent = `${v.name} (${v.language})`;
      if (dubSel) dubSel.appendChild(od);
    }
    renderSavedVoices();
  } catch (e) {
    if (list) list.innerHTML = '<p class="muted">Saved voices load nahi hui (timeout ya server error) — dobara try karein.</p>';
    showToast("Saved voices load nahi hui.", "error");
  }
}

const voicesSearch = $("voices-search");
if (voicesSearch) voicesSearch.addEventListener("input", renderSavedVoices);

// ---- generic drag-and-drop wiring for file inputs ----
// A5: the styled <label> covering the whole dropzone opens the picker
// natively — this wiring only handles drag-and-drop + the change event.
function wireDropzone(zoneId, inputId, infoId, onFile) {
  const zone = $(zoneId), input = $(inputId);
  if (!zone || !input) return;
  ["dragenter", "dragover"].forEach((evt) => zone.addEventListener(evt, (ev) => {
    ev.preventDefault();
    zone.classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach((evt) => zone.addEventListener(evt, (ev) => {
    ev.preventDefault();
    zone.classList.remove("dragover");
  }));
  zone.addEventListener("drop", (ev) => {
    const files = ev.dataTransfer && ev.dataTransfer.files;
    if (files && files.length) {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    const info = infoId ? $(infoId) : null;
    if (info) info.textContent = f ? `Selected: ${f.name} (${(f.size / 1024).toFixed(0)} KB)` : "";
    if (f && onFile) onFile(f);
  });
}

// ---- Voice cloning ----
const refEl = $("ref-audio"), cloneTextEl = $("clone-text"), langEl = $("clone-lang"),
  consentEl = $("consent"), cloneBtn = $("clone-btn"), cloneMsg = $("clone-msg"),
  clonePlayer = $("clone-player"), cloneDownload = $("clone-download"),
  cloneStatus = $("clone-status"), saveVoiceBtn = $("save-voice-btn");
let cloneUrl = null;
let refPreviewUrl = null;

function updateCloneSteps() {
  const hasRef = ($("saved-voice").value !== "") || (refEl.files && refEl.files[0]);
  const hasText = cloneTextEl.value.trim().length > 0;
  const hasConsent = consentEl.checked;
  const steps = document.querySelectorAll("#clone-steps li");
  steps.forEach((li) => {
    const n = Number(li.dataset.step);
    let cls = null;
    if (n === 1) cls = hasRef ? "done" : "active";
    else if (n === 2) cls = !hasRef ? null : (hasText ? "done" : "active");
    else if (n === 3) cls = !(hasRef && hasText) ? null : (hasConsent ? "done" : "active");
    else if (n === 4) cls = (hasRef && hasText && hasConsent) ? "active" : null;
    li.classList.remove("active", "done");
    if (cls) li.classList.add(cls);
  });
}
cloneTextEl.addEventListener("input", updateCloneSteps);
consentEl.addEventListener("change", updateCloneSteps);
$("saved-voice").addEventListener("change", updateCloneSteps);

async function loadCloneStatus() {
  const card = $("clone-engine-card"), stateEl = $("clone-engine-state"), setupEl = $("clone-engine-setup");
  try {
    const r = await fetchTimeout("/api/clone/status", {}, 10000);
    const d = await r.json();
    // A2: /api/clone/status "ready" means only binary + models are PRESENT.
    // Manual smoke test PASSED on this VM on 27 Nov 2026 (verified twice,
    // independently: POST /api/clone 200, real non-silent audio). There is
    // still no in-app probe endpoint, so this is not re-checked live —
    // the card stays amber, not green, until a real probe endpoint exists.
    const installed = d.state === "ready";
    const probeNote = $("clone-probe-note");
    cloneStatus.textContent = installed
      ? "Engine installed — smoke-tested on this machine (27 Nov 2026)."
      : `Engine: ${d.state} — cloning is code-ready but the engine is not installed on this server yet (${d.setup || ""})`;
    if (stateEl) stateEl.textContent = installed
      ? "Installed — smoke-tested manually on this machine, 27 Nov 2026 (Qwen3-TTS 0.6B Base)."
      : `Not installed (state: ${d.state}).`;
    if (setupEl) {
      setupEl.textContent = installed
        ? "Binary + models are present. Manual smoke test passed on this VM on 27 Nov 2026 (POST /api/clone 200, real audio) — verified twice, independently. No in-app probe endpoint yet, so this status is not re-checked live. Last successful probe: 27 Nov 2026."
        : `Setup steps: ${d.setup || "qwentts.cpp build karein aur Qwen 0.6B Base GGUF models models/qwen/ mein rakhein."} Cloning is PC par tab tak nahi chalegi jab tak engine install na ho — koi fake audio nahi banega.`;
    }
    if (probeNote) probeNote.textContent = installed
      ? "Smoke test: passed manually on this machine — 27 Nov 2026 (real clone audio generated)."
      : "Smoke test: not applicable — engine not installed.";
    if (card) { card.classList.remove("ok", "bad", "warn"); card.classList.add(installed ? "warn" : "bad"); }
  } catch {
    cloneStatus.textContent = "Cloning engine status: unreachable.";
    if (stateEl) stateEl.textContent = "Unreachable — server se rabta nahi hua.";
    if (setupEl) setupEl.textContent = "";
    if (card) card.classList.add("bad");
  }
}

function showRefInfo(file) {
  const info = $("ref-info");
  const preview = $("ref-preview");
  if (!file) return;
  if (refPreviewUrl) URL.revokeObjectURL(refPreviewUrl);
  refPreviewUrl = URL.createObjectURL(file);
  if (preview) { preview.src = refPreviewUrl; preview.classList.remove("hidden"); }
  updateCloneSteps();
  const audio = new Audio(refPreviewUrl);
  audio.addEventListener("loadedmetadata", () => {
    const dur = audio.duration;
    const ok = dur >= 3 && dur <= 30;
    if (info) {
      info.textContent = `Reference: ${file.name}, ${dur.toFixed(1)}s (need 3–30s)${ok ? "" : " — duration range se bahar hai, backend phir bhi validate karega."}`;
      info.classList.toggle("warn-text", !ok);
    }
    if (!ok) showToast(`Reference duration ${dur.toFixed(1)}s — need 3–30s. Submit block nahi hoga, backend validate karega.`, "error");
  });
  audio.addEventListener("error", () => {
    if (info) info.textContent = `Reference: ${file.name} — duration read nahi ho saki (backend validate karega).`;
  });
}
wireDropzone("ref-drop", "ref-audio", "ref-info", showRefInfo);

const useSampleBtn = $("use-sample-btn");
if (useSampleBtn) useSampleBtn.addEventListener("click", async () => {
  setBusy(useSampleBtn, true, "Loading sample…");
  try {
    const r = await fetch("/sample.wav");
    if (!r.ok) throw new Error(`sample.wav load nahi hua (HTTP ${r.status})`);
    const blob = await r.blob();
    const file = new File([blob], "sample.wav", { type: blob.type || "audio/wav" });
    const dt = new DataTransfer();
    dt.items.add(file);
    refEl.files = dt.files;
    refEl.dispatchEvent(new Event("change", { bubbles: true }));
    showToast("sample.wav reference ke tor par set ho gaya.", "success");
  } catch (e) {
    showToast("Error: " + e.message, "error");
    const info = $("ref-info");
    if (info) info.textContent = "sample.wav load nahi ho saka: " + e.message;
  } finally { setBusy(useSampleBtn, false); }
});

cloneBtn.addEventListener("click", async () => {
  if (!token) { cloneMsg.textContent = "Cloning ke liye login zaroori hai — pehle login ya signup karein."; showToast("Cloning ke liye login zaroori hai.", "error"); return; }
  const savedId = $("saved-voice").value;
  if (!savedId && (!refEl.files || !refEl.files[0])) { cloneMsg.textContent = "Pehle reference audio upload karein (3–30 second) ya saved voice chunein."; showToast("Pehle reference audio upload karein.", "error"); return; }
  const text = cloneTextEl.value.trim();
  if (!text) { cloneMsg.textContent = "Pehle clone ke liye text likhein."; showToast("Pehle clone ke liye text likhein.", "error"); return; }
  if (!consentEl.checked) { cloneMsg.textContent = "Consent zaroori hai — checkbox tick karein ke ye aap ki apni awaz hai ya permission hai."; showToast("Consent checkbox zaroori hai.", "error"); return; }
  const form = new FormData();
  if (savedId) form.append("saved_voice_id", savedId);
  else form.append("reference", refEl.files[0]);
  form.append("text", text);
  form.append("language", langEl.value);
  form.append("consent", consentEl.checked ? "true" : "false");
  setBusy(cloneBtn, true, "Cloning…");
  saveVoiceBtn.classList.add("hidden");
  const svf = $("save-voice-form");
  if (svf) svf.classList.add("hidden");
  cloneMsg.textContent = "Cloning… CPU par is mein kuch minute lag sakte hain, page band na karein.";
  try {
    const r = await fetch("/api/clone", { method: "POST", headers: authHeaders(), body: form });
    if (r.status === 402) {
      const d = await r.json();
      throw new Error(d.detail + " Get more credits abhi Coming Soon hai.");
    }
    if (r.status === 401) throw new Error("Login zaroori hai — session khatam ho gaya ho to dobara login karein.");
    if (!r.ok) {
      let detail = "Clone failed";
      try { detail = (await r.json()).detail || detail; } catch { /* keep default */ }
      throw new Error(`(${r.status}) ${detail}`);
    }
    const blob = await r.blob();
    if (cloneUrl) URL.revokeObjectURL(cloneUrl);
    cloneUrl = URL.createObjectURL(blob);
    clonePlayer.src = cloneUrl; clonePlayer.classList.remove("hidden");
    cloneDownload.href = cloneUrl; cloneDownload.classList.remove("hidden");
    const remaining = r.headers.get("X-Credits-Remaining");
    if (remaining !== null) setCredits(Number(remaining));
    cloneMsg.textContent = `Ready — ${(blob.size / 1024).toFixed(0)} KB, cloned voice (Qwen3-TTS 0.6B).`;
    showToast("Clone ready.", "success");
    clonePlayer.play().catch(() => {});
    if (!savedId) saveVoiceBtn.classList.remove("hidden");
    loadHistory();
  } catch (e) {
    cloneMsg.textContent = "Error: " + e.message;
    showToast("Error: " + e.message, "error");
  } finally { setBusy(cloneBtn, false); }
});

// inline save-voice form
saveVoiceBtn.addEventListener("click", () => {
  const form = $("save-voice-form");
  if (!form) return;
  form.classList.remove("hidden");
  const nameInput = $("save-voice-name");
  if (nameInput) nameInput.focus();
});
const saveVoiceConfirm = $("save-voice-confirm");
if (saveVoiceConfirm) saveVoiceConfirm.addEventListener("click", async () => {
  const name = ($("save-voice-name").value || "").trim() || "My voice";
  if (!refEl.files || !refEl.files[0]) { cloneMsg.textContent = "Save karne ke liye reference audio dobara chunein."; showToast("Save ke liye reference audio dobara chunein.", "error"); return; }
  const form = new FormData();
  form.append("name", name);
  form.append("language", langEl.value);
  form.append("reference", refEl.files[0]);
  cloneMsg.textContent = "Voice save ho rahi hai…";
  setBusy(saveVoiceConfirm, true, "Saving…");
  try {
    const r = await fetch("/api/voices/save", { method: "POST", headers: authHeaders(), body: form });
    if (!r.ok) throw new Error((await r.json()).detail || "Save failed");
    cloneMsg.textContent = `Voice "${name}" save ho gayi.`;
    showToast(`Voice "${name}" save ho gayi.`, "success");
    saveVoiceBtn.classList.add("hidden");
    $("save-voice-form").classList.add("hidden");
    loadSavedVoices();
  } catch (e) {
    cloneMsg.textContent = "Error: " + e.message;
    showToast("Error: " + e.message, "error");
  } finally { setBusy(saveVoiceConfirm, false); }
});

// ---- Speech-to-Text ----
const sttBtn = $("stt-btn"), sttMsg = $("stt-msg"), sttCopyBtn = $("stt-copy");
let lastTranscript = "";
function setSttStep(n) {
  document.querySelectorAll("#stt-steps li").forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle("active", s === n);
    li.classList.toggle("done", s < n);
  });
}
wireDropzone("stt-drop", "stt-audio", "stt-file-info", () => setSttStep(2));
sttBtn.addEventListener("click", async () => {
  const file = $("stt-audio").files[0];
  if (!file) { sttMsg.textContent = "Pehle audio file chunein."; showToast("Pehle audio file chunein.", "error"); return; }
  const form = new FormData();
  form.append("audio", file);
  setBusy(sttBtn, true, "Transcribing…");
  setSttStep(2);
  sttMsg.textContent = "Transcribing… CPU par pehli dafa model download/load hone mein aik minute lag sakta hai.";
  try {
    const r = await fetch("/api/stt", { method: "POST", headers: authHeaders(), body: form });
    if (!r.ok) throw new Error(`(${r.status}) ${(await r.json()).detail || "STT failed"}`);
    const d = await r.json();
    lastTranscript = d.text;
    $("stt-text").textContent = d.text || "(koi speech nahi mili)";
    const badge = $("stt-lang-badge");
    if (badge) {
      badge.textContent = d.language ? `Language: ${d.language}` : "";
      badge.classList.toggle("hidden", !d.language);
    }
    $("stt-meta").textContent = `Language: ${d.language} (${(d.language_probability * 100).toFixed(0)}%) · Duration: ${d.duration_seconds}s · Model: ${d.model}`;
    const segList = $("stt-segments");
    segList.innerHTML = "";
    for (const s of d.segments) {
      const li = document.createElement("li");
      li.className = "segment-row";
      li.title = "Click to copy this segment";
      li.textContent = `[${s.start}s – ${s.end}s] ${s.text}`;
      li.addEventListener("click", () => {
        navigator.clipboard.writeText(s.text).then(
          () => showToast("Segment copy ho gaya.", "success"),
          () => showToast("Copy nahi ho saka.", "error"));
      });
      segList.appendChild(li);
    }
    $("stt-result").classList.remove("hidden");
    sttCopyBtn.classList.remove("hidden");
    const dlBtn = $("stt-download");
    if (dlBtn) dlBtn.classList.remove("hidden");
    sttMsg.textContent = "Ready.";
    setSttStep(3);
    showToast("Transcription ready.", "success");
    if (token) loadHistory();
  } catch (e) {
    sttMsg.textContent = "Error: " + e.message;
    showToast("Error: " + e.message, "error");
  } finally { setBusy(sttBtn, false); }
});
sttCopyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(lastTranscript).then(
    () => { sttMsg.textContent = "Transcript copy ho gaya."; showToast("Transcript copy ho gaya.", "success"); },
    () => { sttMsg.textContent = "Copy nahi ho saka — transcript ko select karke copy karein."; showToast("Copy nahi ho saka.", "error"); });
});
const sttDownloadBtn = $("stt-download");
if (sttDownloadBtn) sttDownloadBtn.addEventListener("click", () => {
  if (!lastTranscript) { showToast("Pehle transcribe karein.", "error"); return; }
  const blob = new Blob([lastTranscript], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "awaazai-transcript.txt"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// ---- Dubbing ----
const dubBtn = $("dub-btn"), dubMsg = $("dub-msg");
let dubUrl = null;
function setDubStep(n) {
  document.querySelectorAll("#dub-steps li").forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle("active", s === n);
    li.classList.toggle("done", s < n);
  });
}
wireDropzone("dub-drop", "dub-audio", "dub-file-info", () => setDubStep(2));
dubBtn.addEventListener("click", async () => {
  if (!token) { dubMsg.textContent = "Dubbing ke liye login zaroori hai — pehle login ya signup karein (20 credits per dub)."; showToast("Dubbing ke liye login zaroori hai.", "error"); return; }
  const file = $("dub-audio").files[0];
  if (!file) { dubMsg.textContent = "Pehle audio file chunein."; showToast("Pehle audio file chunein.", "error"); return; }
  const savedId = $("dub-saved-voice").value;
  if (savedId && !$("dub-consent").checked) { dubMsg.textContent = "Saved cloned voice ke liye consent checkbox zaroori hai."; showToast("Saved voice ke liye consent zaroori hai.", "error"); return; }
  const form = new FormData();
  form.append("audio", file);
  form.append("target_language", $("dub-lang").value);
  form.append("voice", $("dub-voice").value);
  if (savedId) form.append("saved_voice_id", savedId);
  form.append("consent", $("dub-consent").checked ? "true" : "false");
  setBusy(dubBtn, true, "Dubbing…");
  setDubStep(3);
  dubMsg.textContent = "Dubbing… pehle transcribe, phir re-voice — CPU par kuch minute lag sakte hain.";
  $("dub-501-card").classList.add("hidden");
  try {
    const r = await fetch("/api/dub", { method: "POST", headers: authHeaders(), body: form });
    if (r.status === 501) {
      const d = await r.json();
      $("dub-transcript").textContent = d.transcript || "(khaali)";
      $("dub-translation").textContent = "(translation nahi hui — pair installed nahi hai)";
      $("dub-result").classList.remove("hidden");
      const badge = $("dub-src-lang");
      if (badge) {
        badge.textContent = d.detected_language ? `Detected: ${d.detected_language}` : "";
        badge.classList.toggle("hidden", !d.detected_language);
      }
      const card501 = $("dub-501-card");
      card501.classList.remove("hidden");
      $("dub-501-detail").textContent = d.detail || "Translation pair installed nahi hai.";
      setDubStep(4);
      showToast("Translation pack not installed — transcript dikhaya gaya, credits nahi kate.", "error");
      throw new Error(`(501) ${d.detail}`);
    }
    if (r.status === 402) throw new Error((await r.json()).detail + " Get more credits abhi Coming Soon hai.");
    if (!r.ok) throw new Error(`(${r.status}) ${(await r.json()).detail || "Dub failed"}`);
    const blob = await r.blob();
    if (dubUrl) URL.revokeObjectURL(dubUrl);
    dubUrl = URL.createObjectURL(blob);
    const player = $("dub-player");
    player.src = dubUrl; player.classList.remove("hidden");
    $("dub-download").href = dubUrl; $("dub-download").classList.remove("hidden");
    $("dub-transcript").textContent = decodeURIComponent(r.headers.get("X-Transcript") || "");
    $("dub-translation").textContent = decodeURIComponent(r.headers.get("X-Translation") || "");
    $("dub-result").classList.remove("hidden");
    const remaining = r.headers.get("X-Credits-Remaining");
    if (remaining !== null) setCredits(Number(remaining));
    dubMsg.textContent = `Ready — ${(blob.size / 1024).toFixed(0)} KB dubbed audio.`;
    setDubStep(4);
    showToast("Dub ready.", "success");
    player.play().catch(() => {});
    loadHistory();
  } catch (e) {
    dubMsg.textContent = "Error: " + e.message;
    if (!e.message.startsWith("(501)")) showToast("Error: " + e.message, "error");
  } finally { setBusy(dubBtn, false); }
});

// ---- Studio ----
const studioBtn = $("studio-btn"), studioMsg = $("studio-msg"),
  studioSpeedEl = $("studio-speed");
let studioUrl = null;
function setStudioStep(n) {
  document.querySelectorAll("#studio-steps li").forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle("active", s === n);
    li.classList.toggle("done", s < n);
  });
}
studioSpeedEl.addEventListener("input", () => { $("studio-speed-val").textContent = Number(studioSpeedEl.value).toFixed(1) + "×"; });
const studioTextEl = $("studio-text");
function updateStudioCount() {
  const len = (studioTextEl.value || "").length;
  const words = (studioTextEl.value || "").trim() ? (studioTextEl.value || "").trim().split(/\s+/).length : 0;
  const c = $("studio-count");
  if (c) c.textContent = `${len}/5000`;
  const w = $("studio-words");
  if (w) w.textContent = `${words} words`;
  const cp = $("studio-cost-preview");
  if (cp) cp.textContent = `Cost: ${ttsCostFor(len)} credit${ttsCostFor(len) === 1 ? "" : "s"}`;
  if (len > 0) setStudioStep(2);
}
studioTextEl.addEventListener("input", updateStudioCount);
updateStudioCount();
studioBtn.addEventListener("click", async () => {
  if (!token) { studioMsg.textContent = "Studio ke liye login zaroori hai — pehle login ya signup karein."; showToast("Studio ke liye login zaroori hai.", "error"); return; }
  const text = studioTextEl.value.trim();
  if (!text) { studioMsg.textContent = "Pehle Studio ke liye text likhein."; showToast("Pehle Studio ke liye text likhein.", "error"); return; }
  setBusy(studioBtn, true, "Generating…");
  setStudioStep(3);
  studioMsg.textContent = "Generating Studio audio… lamba text chunks mein banta hai, CPU par kuch minute lag sakte hain.";
  try {
    const r = await fetch("/api/studio", {
      method: "POST", headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ text, voice: $("studio-voice").value, speed: Number(studioSpeedEl.value) }),
    });
    if (r.status === 402) throw new Error((await r.json()).detail + " Get more credits abhi Coming Soon hai.");
    if (!r.ok) throw new Error(`(${r.status}) ${(await r.json()).detail || "Studio failed"}`);
    const blob = await r.blob();
    if (studioUrl) URL.revokeObjectURL(studioUrl);
    studioUrl = URL.createObjectURL(blob);
    const player = $("studio-player");
    player.src = studioUrl; player.classList.remove("hidden");
    const title = ($("studio-title").value || "").trim() || "My narration project";
    const dl = $("studio-download");
    dl.href = studioUrl;
    dl.download = title.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase() + ".wav";
    dl.classList.remove("hidden");
    const chapters = JSON.parse(decodeURIComponent(r.headers.get("X-Chapters") || "[]"));
    const rt = $("studio-result-title");
    if (rt) rt.textContent = `Chapters — ${title}`;
    const list = $("studio-chapters");
    list.innerHTML = "";
    for (const c of chapters) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chapter-btn";
      b.textContent = `Chapter ${c.index} — starts ${c.start_seconds}s: ${c.text}`;
      b.addEventListener("click", () => {
        player.currentTime = Number(c.start_seconds) || 0;
        player.play().catch(() => {});
      });
      li.appendChild(b);
      list.appendChild(li);
    }
    $("studio-result").classList.remove("hidden");
    const remaining = r.headers.get("X-Credits-Remaining");
    if (remaining !== null) setCredits(Number(remaining));
    studioMsg.textContent = `Ready — ${(blob.size / 1024).toFixed(0)} KB, ${chapters.length} chapters.`;
    setStudioStep(4);
    showToast("Studio audio ready.", "success");
    player.play().catch(() => {});
    loadHistory();
  } catch (e) {
    studioMsg.textContent = "Error: " + e.message;
    showToast("Error: " + e.message, "error");
  } finally { setBusy(studioBtn, false); }
});

loadHealth();
loadVoices();
loadModelStatus();
loadCloneStatus();
renderAuth();
updateCloneSteps();
if (token) { refreshCredits(); loadHistory(); loadSavedVoices(); }

// ---- sidebar navigation (one page at a time, hash routing) ----
const PAGES = ["home", "tts", "voices", "clone", "training", "dub", "studio", "stt", "history", "account"];
function showPage(page, pushHash) {
  if (!PAGES.includes(page)) page = "home";
  for (const p of PAGES) {
    const sec = $("page-" + p);
    if (sec) sec.classList.toggle("active", p === page);
  }
  document.querySelectorAll(".nav-item").forEach((b) => {
    const on = b.dataset.page === page;
    b.classList.toggle("active", on);
    if (on) $("page-title").textContent = b.dataset.title || page;
  });
  if (pushHash !== false) {
    try { history.replaceState(null, "", "#" + page); } catch { /* ignore */ }
  }
  if (page === "home" && token) { refreshCredits(); loadHistory(); loadSavedVoices(); }
  if (page === "history" && token) loadHistory();
  if (page === "voices" && token) loadSavedVoices();
  if (page === "account" && token) loadProfile();
  if (page === "training") { loadFishStatus(); loadTrainingStatus(); }
  closeSidebar();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".nav-item").forEach((b) => {
  b.addEventListener("click", () => showPage(b.dataset.page));
});
// Delegated [data-goto] — also covers buttons rendered later (empty states).
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-goto]");
  if (!el) return;
  ev.preventDefault();
  showPage(el.dataset.goto);
});
function closeSidebar() {
  const sb = $("sidebar"), ov = $("sidebar-overlay");
  if (sb) sb.classList.remove("open");
  if (ov) ov.classList.add("hidden");
}
$("hamburger").addEventListener("click", () => {
  $("sidebar").classList.toggle("open");
  $("sidebar-overlay").classList.toggle("hidden");
});
$("sidebar-overlay").addEventListener("click", closeSidebar);
$("top-avatar").addEventListener("click", () => showPage("account"));
$("top-avatar").addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); showPage("account"); }
});
window.addEventListener("hashchange", () => {
  showPage((location.hash || "#home").slice(1), false);
});
// ---- in-app update (check + pull + prompt restart) ----
// Honest flow: the running server cannot safely restart itself, so after
// a successful pull we tell the user to restart (Ctrl+C, phir start.bat).
let pendingUpdate = null;
function setUpdateMsg(text) {
  const b = $("update-msg-account");
  if (b) b.textContent = text;
}
function setApplyVisible(v) {
  const btn = $("update-apply-btn");
  if (btn) btn.classList.toggle("hidden", !v);
}
async function checkUpdate() {
  setUpdateMsg("Checking for updates…");
  setApplyVisible(false);
  const ref = $("update-refresh-btn");
  if (ref) ref.classList.add("hidden");
  try {
    const r = await fetchTimeout("/api/update/check", {}, 15000);
    const d = await r.json();
    if (d.error || !d.latest) {
      setUpdateMsg(`Check failed — ${d.error || "offline?"} (current v${d.current})`);
      showToast("Update check failed.", "error");
      return;
    }
    if (d.update_available) {
      pendingUpdate = d.latest;
      setUpdateMsg(`Update available: v${d.latest} (current v${d.current})`);
      setApplyVisible(true);
      showToast(`Update available: v${d.latest} — see Account → Updates.`, "success");
    } else {
      setUpdateMsg(`✓ Up to date — v${d.current}`);
      showToast("Up to date.", "success");
    }
  } catch (e) {
    setUpdateMsg("Check failed — server se rabta nahi hua.");
    showToast("Update check failed.", "error");
  }
}
async function applyUpdate() {
  if (!pendingUpdate) return;
  setUpdateMsg(`Updating to v${pendingUpdate}… (git pull, data/ aur models/ ko kuch nahi hoga)`);
  setApplyVisible(false);
  try {
    const r = await fetch("/api/update/apply", { method: "POST" });
    const d = await r.json();
    if (r.status === 501) {
      setUpdateMsg(`Update nahi hua (501): ${d.detail}`);
      showToast("Update nahi hua (501).", "error");
      return;
    }
    if (r.status === 403) {
      setUpdateMsg("Update sirf is machine se (127.0.0.1) allowed hai.");
      showToast("Update sirf is machine se allowed hai.", "error");
      return;
    }
    if (!d.updated) {
      setUpdateMsg(`Update fail: ${d.detail || "git pull fail hua."} Server waisa hi chal raha hai.`);
      showToast("Update fail.", "error");
      return;
    }
    setUpdateMsg("Update ho gaya — server restart karein (Ctrl+C, phir start.bat), phir page refresh karein.");
    showToast("Update ho gaya — server restart karein.", "success");
    const ref = $("update-refresh-btn");
    if (ref) ref.classList.remove("hidden");
  } catch (e) {
    setUpdateMsg("Update fail — server se rabta nahi hua. Server waisa hi chal raha hai.");
    showToast("Update fail.", "error");
  }
}
const updateBtnSidebar = $("update-btn");
if (updateBtnSidebar) updateBtnSidebar.addEventListener("click", checkUpdate);
$("update-check-btn").addEventListener("click", checkUpdate);
$("update-apply-btn").addEventListener("click", applyUpdate);
$("update-refresh-btn").addEventListener("click", () => location.reload());
// Initial page from hash (default home).
showPage((location.hash || "#home").slice(1), false);

// ---- Fish Speech S2 readiness (v0.8.0) ----
// The "Test" button re-runs the REAL hardware check (GET /api/fish-speech/status).
// No audio is generated here, and no Fish Speech voice is offered until a
// real GPU generation test passes.
async function loadFishStatus(button) {
  const verdict = $("fish-verdict"), details = $("fish-details"), badge = $("fish-badge");
  if (button) setBusy(button, true, "Checking…");
  try {
    const r = await fetchTimeout("/api/fish-speech/status", {}, 15000);
    if (!r.ok) throw new Error("Status check failed (HTTP " + r.status + ")");
    const d = await r.json();
    if (verdict) verdict.textContent = d.verdict;
    if (badge) {
      badge.textContent = d.state === "ready" ? "Ready" : "GPU test pending";
      badge.classList.toggle("ok", d.state === "ready");
      badge.classList.toggle("bad", d.state !== "ready");
    }
    if (details) {
      const g = d.gpu || {};
      details.innerHTML = "";
      const rows = [
        "GPU: " + (g.present ? `${g.name} (${g.vram_gb ?? "?"} GB VRAM, via ${g.via})` : "koi GPU nahi mila"),
        "RAM: " + (d.ram_gb ? d.ram_gb + " GB" : "unknown") + " · Disk free: " + (d.disk_free_gb ? d.disk_free_gb + " GB" : "unknown"),
        "fish-speech package: " + (d.package_installed ? "installed" : "not installed"),
        "Weights: " + (d.weights && d.weights.length ? d.weights.join(", ") : "not downloaded (models/fish-speech/)"),
        "Licence: " + d.licence,
        "Urdu: " + d.urdu_support,
      ];
      for (const t of rows) {
        const li = document.createElement("li");
        li.className = "muted";
        li.textContent = t;
        details.appendChild(li);
      }
    }
  } catch (e) {
    if (verdict) verdict.textContent = "Check fail hua: " + e.message + " — dobara try karein.";
    showToast("Fish Speech check fail: " + e.message, "error");
  } finally {
    if (button) setBusy(button, false);
  }
}
const fishBtn = $("fish-test-btn");
if (fishBtn) fishBtn.addEventListener("click", () => loadFishStatus(fishBtn));

// ---- Own-voice training intake (v0.8.0) ----
// A18: Training steps advance from real state (recordings / goal / queued).
function updateTrainingSteps(d) {
  const hasRec = !!(d && d.count > 0);
  const goalReached = !!(d && d.goal_reached);
  const queued = !!(d && d.training_queued);
  document.querySelectorAll("#training-steps li").forEach((li) => {
    const s = Number(li.dataset.step);
    let cls = null;
    if (s === 1) cls = (hasRec || queued) ? "done" : "active";
    else if (s === 2) cls = !hasRec ? null : ((goalReached || queued) ? "done" : "active");
    else if (s === 3) cls = queued ? "done" : (goalReached ? "active" : null);
    li.classList.remove("active", "done");
    if (cls) li.classList.add(cls);
  });
}
const trainingGotoUpload = $("training-goto-upload");
if (trainingGotoUpload) trainingGotoUpload.addEventListener("click", () => {
  const target = $("training-upload");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  const picker = $("training-file");
  if (picker) picker.focus({ preventScroll: true });
});
const trainingFileInput = $("training-file");
if (trainingFileInput) trainingFileInput.addEventListener("change", () => {
  const nameEl = $("training-file-name");
  const f = trainingFileInput.files && trainingFileInput.files[0];
  if (nameEl) nameEl.textContent = f ? `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)` : "No file chosen — WAV/MP3, max 100 MB per file";
});
const dubInfoDismiss = $("dub-info-dismiss");
if (dubInfoDismiss) dubInfoDismiss.addEventListener("click", () => {
  const card = $("dub-info-card");
  if (card) card.classList.add("hidden");
});
function renderTrainingStatus(d) {
  const total = $("training-total"), bar = $("training-progress"),
    wrap = $("training-progress-wrap"), list = $("training-list"),
    msgEl = $("training-msg"), badge = $("training-badge");
  if (!d) return;
  updateTrainingSteps(d);
  if (total) total.textContent = `${d.total_minutes.toFixed(1)} / ${d.goal_minutes.toFixed(1)} minutes (${d.count} recordings)`;
  if (bar) bar.style.width = Math.min(100, Math.round((d.total_seconds / d.goal_seconds) * 100)) + "%";
  if (wrap) wrap.classList.remove("hidden");
  if (badge) {
    badge.textContent = d.training_queued ? "Training queued" : (d.goal_reached ? "Ready for training" : "Collecting recordings");
    badge.classList.toggle("ok", d.training_queued || d.goal_reached);
  }
  if (msgEl) msgEl.textContent = d.training_note;
  if (!list) return;
  list.innerHTML = "";
  if (!d.recordings.length) {
    list.innerHTML = '<li class="muted">Abhi koi recording nahi.</li>';
    return;
  }
  for (const r of d.recordings) {
    const li = document.createElement("li");
    const warn = (r.warnings || []).join(" ");
    li.innerHTML = `<b></b> <span class="muted"></span> <button class="btn secondary small" data-del="${r.name}">Delete</button>`;
    li.querySelector("b").textContent = r.original_name;
    li.querySelector(".muted").textContent =
      `${r.duration_seconds}s · ${r.sample_rate} Hz · RMS ${r.rms_db ?? "?"} dB · silence ${r.silence_ratio === null || r.silence_ratio === undefined ? "?" : Math.round(r.silence_ratio * 100) + "%"}${warn ? " · ⚠ " + warn : ""}`;
    li.querySelector("[data-del]").addEventListener("click", async (ev) => {
      setBusy(ev.target, true, "Deleting…");
      try {
        const resp = await fetch("/api/training/recordings/" + encodeURIComponent(r.name), {
          method: "DELETE", headers: authHeaders({}),
        });
        if (!resp.ok) throw new Error((await resp.json()).detail || "Delete fail");
        showToast("Recording delete ho gayi.", "success");
        loadTrainingStatus();
      } catch (e) { showToast("Error: " + e.message, "error"); }
      finally { setBusy(ev.target, false); }
    });
    list.appendChild(li);
  }
}

async function loadTrainingStatus() {
  if (!token) {
    const m = $("training-msg");
    if (m) m.textContent = "Login karein to recordings upload kar sakte hain.";
    updateTrainingSteps(null);
    return;
  }
  try {
    const r = await fetchTimeout("/api/training/status", { headers: authHeaders({}) }, 10000);
    if (!r.ok) return;
    renderTrainingStatus(await r.json());
  } catch { /* training panel is best-effort on load */ }
}

const trainingUploadBtn = $("training-upload-btn");
if (trainingUploadBtn) trainingUploadBtn.addEventListener("click", async () => {
  const file = $("training-file").files[0];
  const m = $("training-msg");
  if (!token) { showToast("Pehle login karein.", "error"); return; }
  if (!file) { showToast("Pehle aik recording file chunein.", "error"); return; }
  setBusy(trainingUploadBtn, true, "Uploading…");
  if (m) m.textContent = "Uploading & validating… (duration, sample rate, loudness, silence check)";
  try {
    const fd = new FormData();
    fd.append("audio", file);
    const r = await fetch("/api/training/upload", { method: "POST", headers: authHeaders({}), body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || "Upload fail");
    showToast("Recording save ho gayi — validated.", "success");
    renderTrainingStatus(d.status);
    $("training-file").value = "";
  } catch (e) {
    if (m) m.textContent = "Error: " + e.message;
    showToast("Error: " + e.message, "error");
  } finally { setBusy(trainingUploadBtn, false); }
});

const trainingRequestBtn = $("training-request-btn");
if (trainingRequestBtn) trainingRequestBtn.addEventListener("click", async () => {
  if (!token) { showToast("Pehle login karein.", "error"); return; }
  setBusy(trainingRequestBtn, true, "Queueing…");
  try {
    const r = await fetch("/api/training/request", { method: "POST", headers: authHeaders({}) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || "Request fail");
    showToast("Training queued — GPU server par hogi.", "success");
    renderTrainingStatus(d);
  } catch (e) {
    showToast("Error: " + e.message, "error");
  } finally { setBusy(trainingRequestBtn, false); }
});

// Load the training page data on first paint + whenever it is opened.
loadFishStatus();
loadTrainingStatus();
document.addEventListener("click", (ev) => {
  const t = ev.target.closest('[data-page="training"], [data-goto="training"]');
  if (t) setTimeout(() => { loadFishStatus(); loadTrainingStatus(); }, 50);
});
