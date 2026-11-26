// AwaazAI frontend — calls the local FastAPI backend. No fake audio: every
// clip comes from POST /api/tts (Kokoro-82M) or POST /api/clone (Qwen3-TTS).
const $ = (id) => document.getElementById(id);
const voiceSel = $("voice"), textEl = $("text"), speedEl = $("speed"),
  speedVal = $("speed-val"), btn = $("generate"), msg = $("msg"),
  player = $("player"), download = $("download"), pill = $("status-pill"),
  creditsPill = $("credits-pill"), userPill = $("user-pill"),
  logoutBtn = $("logout-btn");

let audioUrl = null;
let token = localStorage.getItem("awaazai_token") || null;
let username = localStorage.getItem("awaazai_user") || null;
const DEMO_LIMIT = 5;
let demoUsed = Number(localStorage.getItem("awaazai_demo_used") || 0);

// ---- v0.6.0 shared state ----
let allVoices = [];            // /api/voices list (id, name, gender, language_name)
let historyCache = [];         // /api/history list, newest first
let savedVoicesCache = [];     // /api/voices/saved list
let historyFilter = "all";
let modelEndpointAvailable = null; // null = unknown, true/false once probed
let modelPollTimer = null;

// ---- v0.6.0: toasts ----
function showToast(message, type) {
  const box = $("toast-container");
  if (!box) return;
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => { el.remove(); }, 4500);
}

// ---- v0.6.0: visible busy state (spinner + disabled) on any button ----
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

// ---- v0.6.0: fetch with a timeout so async loads never hang forever ----
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
  creditsPill.textContent = (n === null || n === undefined)
    ? "Credits: — (login karein)"
    : `Credits: ${n}`;
  const side = $("sidebar-credits");
  if (side) side.textContent = (n === null || n === undefined) ? "Credits: —" : `Credits: ${n}`;
  const stat = $("stat-credits");
  if (stat) stat.textContent = (n === null || n === undefined) ? "—" : String(n);
  const prof = $("profile-credits");
  if (prof && n !== null && n !== undefined) prof.textContent = String(n);
}

function ttsCostFor(len) {
  return Math.max(1, Math.ceil(len / 100));
}

function updateTtsCost() {
  const len = (textEl.value || "").length;
  const count = $("tts-count");
  if (count) count.textContent = `${len}/1000`;
  const prev = $("tts-cost-preview");
  if (prev) {
    prev.textContent = token
      ? `Cost: ${ttsCostFor(len)} credit${ttsCostFor(len) === 1 ? "" : "s"} · Logged in: ${creditsPill.textContent.replace("Credits: ", "")} credits`
      : `Cost: ${ttsCostFor(len)} credit${ttsCostFor(len) === 1 ? "" : "s"} when logged in · Demo: ${Math.max(0, DEMO_LIMIT - demoUsed)}/${DEMO_LIMIT} left`;
  }
}

function updateDemoLabel() {
  $("demo-left").textContent = `${Math.max(0, DEMO_LIMIT - demoUsed)} demo generations`;
  const acc = $("demo-left-account");
  if (acc) acc.textContent = `${Math.max(0, DEMO_LIMIT - demoUsed)} demo generations`;
  $("tts-cost").textContent = token
    ? "Logged in: 1 credit per 100 characters."
    : `Demo: is session mein ${Math.max(0, DEMO_LIMIT - demoUsed)} / ${DEMO_LIMIT} generations bache hain — login par 100 credits milte hain.`;
  updateTtsCost();
}

function renderAuth() {
  const loggedIn = !!token;
  $("auth-forms").classList.toggle("hidden", loggedIn);
  $("auth-logged").classList.toggle("hidden", !loggedIn);
  userPill.classList.toggle("hidden", !loggedIn);
  logoutBtn.classList.toggle("hidden", !loggedIn);
  const prof = $("profile-card");
  if (prof) prof.classList.toggle("hidden", !loggedIn);
  if (loggedIn) {
    userPill.textContent = "👤 " + username;
    $("auth-logged").textContent = `${username} — logged in. History aur saved voices neeche dikhengi.`;
    const pn = $("profile-name");
    if (pn) pn.textContent = username;
    loadProfile();
  }
  updateDemoLabel();
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

// ---- v0.6.0: profile card from /api/auth/me ----
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
  $("history-list").innerHTML = '<p class="muted">Login karein to history dikhegi.</p>';
  $("voices-list").innerHTML = '<p class="muted">Login karein to saved voices dikhengi.</p>';
  const ve = $("voices-empty");
  if (ve) ve.classList.add("hidden");
  $("saved-voice").innerHTML = '<option value="">— Nayi reference upload karein —</option>';
  const prof = $("profile-card");
  if (prof) prof.classList.add("hidden");
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
logoutBtn.addEventListener("click", () => doLogout(false));
const logoutBtn2 = $("logout-btn-2");
if (logoutBtn2) logoutBtn2.addEventListener("click", () => doLogout(false));
$("more-credits-btn").addEventListener("click", () => {
  $("auth-msg").textContent = "Credits khareedna abhi Coming Soon hai — filhal admin se rabta karein. Naye users ko 100 free credits milte hain.";
  showToast("Credits purchase abhi Coming Soon hai.", "error");
});

// ---- v0.6.0: change password (honest when the endpoint is absent) ----
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

async function loadHealth() {
  try {
    const r = await fetchTimeout("/api/health", {}, 10000);
    const d = await r.json();
    pill.textContent = d.status === "ok"
      ? `Engine: Kokoro-82M ${d.model_files_present ? "ready" : "model missing"}`
      : "Engine: error";
    pill.classList.toggle("ok", d.status === "ok" && d.model_files_present);
    pill.classList.toggle("bad", !(d.status === "ok" && d.model_files_present));
    if (d.status === "ok" && !d.model_files_present) showModelCard(true);
  } catch {
    pill.textContent = "Engine: unreachable";
    pill.classList.add("bad");
  }
}

// ---- v0.6.0: voice grid (select stays in sync as the fallback) ----
function renderVoiceGrid() {
  const grid = $("voice-grid");
  if (!grid) return;
  const q = ($("voice-search").value || "").trim().toLowerCase();
  const list = allVoices.filter((v) =>
    !q || `${v.name} ${v.id} ${v.language_name} ${v.gender}`.toLowerCase().includes(q));
  grid.innerHTML = "";
  if (!allVoices.length) {
    grid.innerHTML = '<p class="muted">Voices load nahi hui — neeche model-downloader card dekhein.</p>';
    return;
  }
  if (!list.length) {
    grid.innerHTML = '<p class="muted">Koi voice is search se match nahi karti.</p>';
    return;
  }
  for (const v of list) {
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
    const pick = () => {
      voiceSel.value = v.id;
      grid.querySelectorAll(".voice-card").forEach((c) => c.classList.remove("selected"));
      card.classList.add("selected");
    };
    card.addEventListener("click", pick);
    card.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); pick(); } });
    grid.appendChild(card);
  }
}

const voiceSearch = $("voice-search");
if (voiceSearch) voiceSearch.addEventListener("input", renderVoiceGrid);
voiceSel.addEventListener("change", renderVoiceGrid);

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
    renderVoiceGrid();
    if (msg.textContent.startsWith("Voices load nahi hui")) msg.textContent = "";
  } catch (e) {
    msg.textContent = "Voices load nahi hui: " + e.message + " (10s timeout) — model-downloader card neeche dekhein.";
    showToast("Voices load nahi hui: " + e.message, "error");
    showModelCard(true);
    renderVoiceGrid();
  }
}

// ---- v0.6.0: Kokoro model downloader (defensive — endpoint may not exist yet) ----
function showModelCard(show) {
  const card = $("model-card");
  if (!card) return;
  card.classList.toggle("hidden", !show);
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
      return null;
    }
    if (!r.ok) return null;
    modelEndpointAvailable = true;
    const d = await r.json();
    updateModelCard(d);
    return d;
  } catch {
    // Endpoint absent or server unreachable: manual-download note, no crash.
    modelEndpointAvailable = false;
    const note = $("model-manual-note");
    if (note) note.classList.remove("hidden");
    return null;
  }
}

function updateModelCard(d) {
  const card = $("model-card");
  if (!card || !d) return;
  const total = d.total_bytes || 0, done = d.downloaded_bytes || 0;
  const wrap = $("model-progress-wrap"), bar = $("model-progress"), pt = $("model-progress-text");
  if (d.complete) {
    card.classList.add("hidden");
    if (modelPollTimer) { clearTimeout(modelPollTimer); modelPollTimer = null; }
    showToast("Kokoro models download ho gaye — TTS ready.", "success");
    loadVoices();
    return;
  }
  card.classList.remove("hidden");
  if (total > 0) {
    const pct = Math.round((done / total) * 100);
    if (wrap) wrap.classList.remove("hidden");
    if (bar) bar.style.width = pct + "%";
    if (pt) pt.textContent = `Downloaded ${(done / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB (${pct}%)`;
  } else if (pt) {
    pt.textContent = d.downloading ? "Downloading…" : "Models missing.";
  }
  if (d.downloading) {
    modelPollTimer = setTimeout(loadModelStatus, 2000);
  } else if (modelPollTimer) { clearTimeout(modelPollTimer); modelPollTimer = null; }
}

const modelBtn = $("model-download-btn");
if (modelBtn) modelBtn.addEventListener("click", async () => {
  setBusy(modelBtn, true, "Starting download…");
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
  } finally { setBusy(modelBtn, false); }
});

speedEl.addEventListener("input", () => { speedVal.textContent = Number(speedEl.value).toFixed(1) + "×"; });
textEl.addEventListener("input", updateTtsCost);
updateTtsCost();

btn.addEventListener("click", async () => {
  const text = textEl.value.trim();
  if (!text) { msg.textContent = "Pehle kuch text likhein."; showToast("Pehle kuch text likhein.", "error"); return; }
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
    msg.textContent = `Ready — ${(blob.size / 1024).toFixed(0)} KB, engine Kokoro-82M.`;
    showToast("TTS audio ready.", "success");
    player.play().catch(() => {});
    if (token) loadHistory();
  } catch (e) {
    msg.textContent = "Error: " + e.message;
    showToast("Error: " + e.message, "error");
  } finally { setBusy(btn, false); }
});

// ---- History (v0.6.0: cards, filter chips, date grouping) ----
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
    list.innerHTML = '<p class="muted">Login karein to history dikhegi.</p>';
    if (empty) empty.classList.add("hidden");
    return;
  }
  if (!historyCache.length) {
    list.innerHTML = '<p class="muted">Abhi koi history nahi — pehle TTS ya Clone generate karein.</p>';
    if (empty) empty.classList.add("hidden");
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
        try {
          const res = await fetch(`/api/history/${h.id}/audio`, { headers: authHeaders() });
          if (!res.ok) throw new Error("Audio load nahi hua");
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url; a.download = `awaazai-${h.type}-${h.id}.wav`; a.click();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (e) { showToast("Error: " + e.message, "error"); }
      });
      actions.append(playBtn, dlBtn);
    }
    const del = document.createElement("button");
    del.textContent = "Delete"; del.className = "btn secondary small";
    del.addEventListener("click", async () => {
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
    recent.innerHTML = '<li class="muted">Login karein to recent TTS generations dikhengi.</li>';
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
  } catch (e) {
    historyCache = [];
    if (list) list.innerHTML = '<p class="muted">History load nahi hui (timeout ya server error) — dobara try karein.</p>';
    showToast("History load nahi hui.", "error");
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

// ---- Saved voices (v0.6.0: cards grid) ----
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
      showToast(`"${v.name}" clone ke liye select ho gayi.`, "success");
    });
    const del = document.createElement("button");
    del.textContent = "Delete";
    del.className = "btn secondary small";
    del.addEventListener("click", async () => {
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

// ---- v0.6.0: generic drag-and-drop wiring for file inputs ----
function wireDropzone(zoneId, inputId, infoId, onFile) {
  const zone = $(zoneId), input = $(inputId);
  if (!zone || !input) return;
  zone.addEventListener("click", (ev) => {
    if (ev.target === input || ev.target.closest("button") || ev.target.closest("a")) return;
    input.click();
  });
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

async function loadCloneStatus() {
  const card = $("clone-engine-card"), stateEl = $("clone-engine-state"), setupEl = $("clone-engine-setup");
  try {
    const r = await fetchTimeout("/api/clone/status", {}, 10000);
    const d = await r.json();
    const ready = d.state === "ready";
    cloneStatus.textContent = ready
      ? "Engine ready — Qwen3-TTS 0.6B Base."
      : `Engine: ${d.state} — cloning is code-ready but the engine is not installed on this server yet (${d.setup || ""})`;
    if (stateEl) stateEl.textContent = ready ? "Ready — Qwen3-TTS 0.6B Base." : `Not installed (state: ${d.state}).`;
    if (setupEl) {
      setupEl.textContent = ready
        ? "Engine ready — clone generate kar sakte hain."
        : `Setup steps: ${d.setup || "qwentts.cpp build karein aur Qwen 0.6B Base GGUF models models/qwen/ mein rakhein."} Cloning is PC par tab tak nahi chalegi jab tak engine install na ho — koi fake audio nahi banega.`;
    }
    if (card) { card.classList.toggle("ok", ready); card.classList.toggle("bad", !ready); }
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

// v0.6.0: inline save-voice form replaces prompt().
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
wireDropzone("stt-drop", "stt-audio", "stt-file-info", null);
sttBtn.addEventListener("click", async () => {
  const file = $("stt-audio").files[0];
  if (!file) { sttMsg.textContent = "Pehle audio file chunein."; showToast("Pehle audio file chunein.", "error"); return; }
  const form = new FormData();
  form.append("audio", file);
  setBusy(sttBtn, true, "Transcribing…");
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
wireDropzone("dub-drop", "dub-audio", "dub-file-info", null);
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
}
studioTextEl.addEventListener("input", updateStudioCount);
updateStudioCount();
studioBtn.addEventListener("click", async () => {
  if (!token) { studioMsg.textContent = "Studio ke liye login zaroori hai — pehle login ya signup karein."; showToast("Studio ke liye login zaroori hai.", "error"); return; }
  const text = studioTextEl.value.trim();
  if (!text) { studioMsg.textContent = "Pehle Studio ke liye text likhein."; showToast("Pehle Studio ke liye text likhein.", "error"); return; }
  setBusy(studioBtn, true, "Generating…");
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
    $("studio-download").href = studioUrl; $("studio-download").classList.remove("hidden");
    const chapters = JSON.parse(decodeURIComponent(r.headers.get("X-Chapters") || "[]"));
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
    const remaining = r.headers.get("X-Credits-Remaining");
    if (remaining !== null) setCredits(Number(remaining));
    studioMsg.textContent = `Ready — ${(blob.size / 1024).toFixed(0)} KB, ${chapters.length} chapters.`;
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
loadCloneStatus();
renderAuth();
if (token) { refreshCredits(); loadHistory(); loadSavedVoices(); }

// ---- v0.5.0: sidebar navigation (one page at a time, hash routing) ----
const PAGES = ["home", "tts", "clone", "voices", "dub", "studio", "stt", "history", "account"];
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
  closeSidebar();
  window.scrollTo(0, 0);
}
document.querySelectorAll(".nav-item").forEach((b) => {
  b.addEventListener("click", () => showPage(b.dataset.page));
});
document.querySelectorAll("[data-goto]").forEach((el) => {
  el.addEventListener("click", (ev) => { ev.preventDefault(); showPage(el.dataset.goto); });
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
window.addEventListener("hashchange", () => {
  showPage((location.hash || "#home").slice(1), false);
});
// ---- v0.5.0: in-app update (check + pull + prompt restart) ----
// Honest flow: the running server cannot safely restart itself, so after
// a successful pull we tell the user to restart (Ctrl+C, phir start.bat).
let pendingUpdate = null;
function setUpdateMsg(text) {
  const a = $("update-msg"), b = $("update-msg-account");
  if (a) a.textContent = text;
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
      showToast(`Update available: v${d.latest}`, "success");
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
$("update-btn").addEventListener("click", checkUpdate);
$("update-check-btn").addEventListener("click", checkUpdate);
$("update-apply-btn").addEventListener("click", applyUpdate);
$("update-refresh-btn").addEventListener("click", () => location.reload());
// Initial page from hash (default home).
showPage((location.hash || "#home").slice(1), false);
