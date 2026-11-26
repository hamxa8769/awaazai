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
}

function updateDemoLabel() {
  $("demo-left").textContent = `${Math.max(0, DEMO_LIMIT - demoUsed)} demo generations`;
  const acc = $("demo-left-account");
  if (acc) acc.textContent = `${Math.max(0, DEMO_LIMIT - demoUsed)} demo generations`;
  $("tts-cost").textContent = token
    ? "Logged in: 1 credit per 100 characters."
    : `Demo: is session mein ${Math.max(0, DEMO_LIMIT - demoUsed)} / ${DEMO_LIMIT} generations bache hain — login par 100 credits milte hain.`;
}

function renderAuth() {
  const loggedIn = !!token;
  $("auth-forms").classList.toggle("hidden", loggedIn);
  $("auth-logged").classList.toggle("hidden", !loggedIn);
  userPill.classList.toggle("hidden", !loggedIn);
  logoutBtn.classList.toggle("hidden", !loggedIn);
  if (loggedIn) {
    userPill.textContent = "👤 " + username;
    $("auth-logged").textContent = `${username} — logged in. History aur saved voices neeche dikhengi.`;
  }
  updateDemoLabel();
}

async function refreshCredits() {
  if (!token) { setCredits(null); return; }
  try {
    const r = await fetch("/api/credits", { headers: authHeaders() });
    if (r.status === 401) { doLogout(true); return; }
    const d = await r.json();
    setCredits(d.credits);
  } catch { /* keep old value */ }
}

function doLogout(silent) {
  if (token) fetch("/api/auth/logout", { method: "POST", headers: authHeaders() }).catch(() => {});
  token = null; username = null;
  localStorage.removeItem("awaazai_token");
  localStorage.removeItem("awaazai_user");
  setCredits(null);
  $("history-list").innerHTML = '<li class="muted">Login karein to history dikhegi.</li>';
  $("voices-list").innerHTML = '<li class="muted">Login karein to saved voices dikhengi.</li>';
  $("saved-voice").innerHTML = '<option value="">— Nayi reference upload karein —</option>';
  if (!silent) $("auth-msg").textContent = "Logged out.";
  renderAuth();
}

async function authAction(path) {
  const u = $("auth-user").value.trim(), p = $("auth-pass").value;
  if (!u || !p) { $("auth-msg").textContent = "Username aur password dono likhein."; return; }
  $("auth-msg").textContent = "Please wait…";
  try {
    const r = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.detail || "Auth failed");
    token = d.token; username = d.user.username;
    localStorage.setItem("awaazai_token", token);
    localStorage.setItem("awaazai_user", username);
    $("auth-msg").textContent = `Welcome, ${username}! ${d.user.credits} credits mil gaye.`;
    setCredits(d.user.credits);
    renderAuth();
    loadHistory(); loadSavedVoices();
  } catch (e) {
    $("auth-msg").textContent = "Error: " + e.message;
  }
}

$("login-btn").addEventListener("click", () => authAction("/api/auth/login"));
$("signup-btn").addEventListener("click", () => authAction("/api/auth/signup"));
logoutBtn.addEventListener("click", () => doLogout(false));
$("more-credits-btn").addEventListener("click", () => {
  $("auth-msg").textContent = "Credits khareedna abhi Coming Soon hai — filhal admin se rabta karein. Naye users ko 100 free credits milte hain.";
});

async function loadHealth() {
  try {
    const r = await fetch("/api/health");
    const d = await r.json();
    pill.textContent = d.status === "ok"
      ? `Engine: Kokoro-82M ${d.model_files_present ? "ready" : "model missing"}`
      : "Engine: error";
    pill.classList.toggle("ok", d.status === "ok" && d.model_files_present);
    pill.classList.toggle("bad", !(d.status === "ok" && d.model_files_present));
  } catch {
    pill.textContent = "Engine: unreachable";
    pill.classList.add("bad");
  }
}

async function loadVoices() {
  try {
    const r = await fetch("/api/voices");
    if (!r.ok) throw new Error((await r.json()).detail || "voices failed");
    const d = await r.json();
    voiceSel.innerHTML = "";
    for (const v of d.voices) {
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
      for (const v of d.voices) {
        const o = document.createElement("option");
        o.value = v.id;
        o.textContent = `${v.name} — ${v.language_name}`;
        sel.appendChild(o);
      }
      sel.value = "af_heart";
    }
  } catch (e) {
    msg.textContent = "Voices load nahi hui: " + e.message;
  }
}

speedEl.addEventListener("input", () => { speedVal.textContent = Number(speedEl.value).toFixed(1) + "×"; });

btn.addEventListener("click", async () => {
  const text = textEl.value.trim();
  if (!text) { msg.textContent = "Pehle kuch text likhein."; return; }
  if (!token && demoUsed >= DEMO_LIMIT) {
    msg.textContent = "Demo limit khatam (5/5). Login ya signup karein — 100 free credits milte hain.";
    return;
  }
  btn.disabled = true; msg.textContent = "Generating… (CPU par pehli dafa model load hone mein kuch second lag sakte hain)";
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
    player.play().catch(() => {});
    if (token) loadHistory();
  } catch (e) {
    msg.textContent = "Error: " + e.message;
  } finally { btn.disabled = false; }
});

// ---- History ----
async function loadHistory() {
  const list = $("history-list");
  if (!token) return;
  try {
    const r = await fetch("/api/history", { headers: authHeaders() });
    if (!r.ok) throw new Error("history failed");
    const d = await r.json();
    if (!d.history.length) { list.innerHTML = '<li class="muted">Abhi koi history nahi — pehle TTS ya Clone generate karein.</li>'; const s0 = $("stat-generations"); if (s0) s0.textContent = "0"; return; }
    list.innerHTML = "";
    for (const h of d.history) {
      const li = document.createElement("li");
      const when = new Date(h.created_at).toLocaleString();
      li.innerHTML = `<b>${h.type.toUpperCase()}</b> · ${h.voice} · ${h.credits_cost} credits · ${when}<br>
        <span class="muted">${h.text_snippet}</span><br>`;
      if (h.has_audio) {
        const a = document.createElement("a");
        a.href = `/api/history/${h.id}/audio`;
        a.textContent = "▶ Play / download";
        a.addEventListener("click", (ev) => {
          ev.preventDefault();
          fetch(`/api/history/${h.id}/audio`, { headers: authHeaders() })
            .then((res) => res.blob()).then((blob) => {
              const url = URL.createObjectURL(blob);
              const audio = new Audio(url); audio.play().catch(() => {});
              const dl = document.createElement("a"); dl.href = url; dl.download = `awaazai-${h.type}-${h.id}.wav`; dl.click();
            });
        });
        li.appendChild(a);
        li.appendChild(document.createTextNode("  "));
      }
      const del = document.createElement("button");
      del.textContent = "Delete"; del.className = "btn secondary small";
      del.addEventListener("click", async () => {
        await fetch(`/api/history/${h.id}`, { method: "DELETE", headers: authHeaders() });
        loadHistory();
      });
      li.appendChild(del);
      list.appendChild(li);
    }
    // Dashboard: recent 5 + generation count.
    const stat = $("stat-generations");
    if (stat) stat.textContent = String(d.history.length);
    const recent = $("recent-list");
    if (recent) {
      recent.innerHTML = "";
      for (const h of d.history.slice(0, 5)) {
        const li = document.createElement("li");
        const when = new Date(h.created_at).toLocaleString();
        li.innerHTML = `<b>${h.type.toUpperCase()}</b> · ${h.voice} · ${when}<br><span class="muted">${h.text_snippet}</span>`;
        recent.appendChild(li);
      }
    }
  } catch (e) {
    list.innerHTML = '<li class="muted">History load nahi hui.</li>';
  }
}

// ---- Saved voices ----
async function loadSavedVoices() {
  const list = $("voices-list"), sel = $("saved-voice");
  const dubSel = $("dub-saved-voice");
  if (dubSel) dubSel.innerHTML = '<option value="">— Kokoro voice use karein —</option>';
  if (!token) return;
  try {
    const r = await fetch("/api/voices/saved", { headers: authHeaders() });
    if (!r.ok) throw new Error("saved voices failed");
    const d = await r.json();
    sel.innerHTML = '<option value="">— Nayi reference upload karein —</option>';
    const statV = $("stat-voices");
    if (statV) statV.textContent = String(d.voices.length);
    if (!d.voices.length) { list.innerHTML = '<li class="muted">Koi saved voice nahi — clone ke baad "Save this voice" dabayein.</li>'; return; }
    list.innerHTML = "";
    for (const v of d.voices) {
      const o = document.createElement("option");
      o.value = v.id; o.textContent = `${v.name} (${v.language})`;
      sel.appendChild(o);
      const od = document.createElement("option");
      od.value = v.id; od.textContent = `${v.name} (${v.language})`;
      if (dubSel) dubSel.appendChild(od);
      const li = document.createElement("li");
      li.innerHTML = `<b>${v.name}</b> · ${v.language} · ${new Date(v.created_at).toLocaleString()} `;
      const del = document.createElement("button");
      del.textContent = "Delete"; del.className = "btn secondary small";
      del.addEventListener("click", async () => {
        await fetch(`/api/voices/saved/${v.id}`, { method: "DELETE", headers: authHeaders() });
        loadSavedVoices();
      });
      li.appendChild(del);
      list.appendChild(li);
    }
  } catch (e) {
    list.innerHTML = '<li class="muted">Saved voices load nahi hui.</li>';
  }
}

// ---- Voice cloning ----
const refEl = $("ref-audio"), cloneTextEl = $("clone-text"), langEl = $("clone-lang"),
  consentEl = $("consent"), cloneBtn = $("clone-btn"), cloneMsg = $("clone-msg"),
  clonePlayer = $("clone-player"), cloneDownload = $("clone-download"),
  cloneStatus = $("clone-status"), saveVoiceBtn = $("save-voice-btn");
let cloneUrl = null;

async function loadCloneStatus() {
  try {
    const r = await fetch("/api/clone/status");
    const d = await r.json();
    cloneStatus.textContent = d.state === "ready"
      ? "Engine ready — Qwen3-TTS 0.6B Base."
      : `Engine: ${d.state} — cloning is code-ready but the engine is not installed on this server yet (${d.setup || ""})`;
  } catch {
    cloneStatus.textContent = "Cloning engine status: unreachable.";
  }
}

cloneBtn.addEventListener("click", async () => {
  if (!token) { cloneMsg.textContent = "Cloning ke liye login zaroori hai — pehle login ya signup karein."; return; }
  const savedId = $("saved-voice").value;
  if (!savedId && (!refEl.files || !refEl.files[0])) { cloneMsg.textContent = "Pehle reference audio upload karein (3–30 second) ya saved voice chunein."; return; }
  const text = cloneTextEl.value.trim();
  if (!text) { cloneMsg.textContent = "Pehle clone ke liye text likhein."; return; }
  if (!consentEl.checked) { cloneMsg.textContent = "Consent zaroori hai — checkbox tick karein ke ye aap ki apni awaz hai ya permission hai."; return; }
  const form = new FormData();
  if (savedId) form.append("saved_voice_id", savedId);
  else form.append("reference", refEl.files[0]);
  form.append("text", text);
  form.append("language", langEl.value);
  form.append("consent", consentEl.checked ? "true" : "false");
  cloneBtn.disabled = true; saveVoiceBtn.classList.add("hidden");
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
    clonePlayer.play().catch(() => {});
    if (!savedId) saveVoiceBtn.classList.remove("hidden");
    loadHistory();
  } catch (e) {
    cloneMsg.textContent = "Error: " + e.message;
  } finally { cloneBtn.disabled = false; }
});

saveVoiceBtn.addEventListener("click", async () => {
  const name = prompt("Is voice ka naam kya rakhein?", "My voice");
  if (!name) return;
  if (!refEl.files || !refEl.files[0]) { cloneMsg.textContent = "Save karne ke liye reference audio dobara chunein."; return; }
  const form = new FormData();
  form.append("name", name);
  form.append("language", langEl.value);
  form.append("reference", refEl.files[0]);
  cloneMsg.textContent = "Voice save ho rahi hai…";
  try {
    const r = await fetch("/api/voices/save", { method: "POST", headers: authHeaders(), body: form });
    if (!r.ok) throw new Error((await r.json()).detail || "Save failed");
    cloneMsg.textContent = `Voice "${name}" save ho gayi.`;
    saveVoiceBtn.classList.add("hidden");
    loadSavedVoices();
  } catch (e) {
    cloneMsg.textContent = "Error: " + e.message;
  }
});

// ---- Speech-to-Text ----
const sttBtn = $("stt-btn"), sttMsg = $("stt-msg"), sttCopyBtn = $("stt-copy");
let lastTranscript = "";
sttBtn.addEventListener("click", async () => {
  const file = $("stt-audio").files[0];
  if (!file) { sttMsg.textContent = "Pehle audio file chunein."; return; }
  const form = new FormData();
  form.append("audio", file);
  sttBtn.disabled = true; sttMsg.textContent = "Transcribing… CPU par pehli dafa model download/load hone mein aik minute lag sakta hai.";
  try {
    const r = await fetch("/api/stt", { method: "POST", headers: authHeaders(), body: form });
    if (!r.ok) throw new Error(`(${r.status}) ${(await r.json()).detail || "STT failed"}`);
    const d = await r.json();
    lastTranscript = d.text;
    $("stt-text").textContent = d.text || "(koi speech nahi mili)";
    $("stt-meta").textContent = `Language: ${d.language} (${(d.language_probability * 100).toFixed(0)}%) · Duration: ${d.duration_seconds}s · Model: ${d.model}`;
    const segList = $("stt-segments");
    segList.innerHTML = "";
    for (const s of d.segments) {
      const li = document.createElement("li");
      li.textContent = `[${s.start}s – ${s.end}s] ${s.text}`;
      segList.appendChild(li);
    }
    $("stt-result").classList.remove("hidden");
    sttCopyBtn.classList.remove("hidden");
    sttMsg.textContent = "Ready.";
    if (token) loadHistory();
  } catch (e) {
    sttMsg.textContent = "Error: " + e.message;
  } finally { sttBtn.disabled = false; }
});
sttCopyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(lastTranscript).then(
    () => { sttMsg.textContent = "Transcript copy ho gaya."; },
    () => { sttMsg.textContent = "Copy nahi ho saka — transcript ko select karke copy karein."; });
});

// ---- Dubbing ----
const dubBtn = $("dub-btn"), dubMsg = $("dub-msg");
let dubUrl = null;
dubBtn.addEventListener("click", async () => {
  if (!token) { dubMsg.textContent = "Dubbing ke liye login zaroori hai — pehle login ya signup karein (20 credits per dub)."; return; }
  const file = $("dub-audio").files[0];
  if (!file) { dubMsg.textContent = "Pehle audio file chunein."; return; }
  const savedId = $("dub-saved-voice").value;
  if (savedId && !$("dub-consent").checked) { dubMsg.textContent = "Saved cloned voice ke liye consent checkbox zaroori hai."; return; }
  const form = new FormData();
  form.append("audio", file);
  form.append("target_language", $("dub-lang").value);
  form.append("voice", $("dub-voice").value);
  if (savedId) form.append("saved_voice_id", savedId);
  form.append("consent", $("dub-consent").checked ? "true" : "false");
  dubBtn.disabled = true; dubMsg.textContent = "Dubbing… pehle transcribe, phir re-voice — CPU par kuch minute lag sakte hain.";
  try {
    const r = await fetch("/api/dub", { method: "POST", headers: authHeaders(), body: form });
    if (r.status === 501) {
      const d = await r.json();
      $("dub-transcript").textContent = d.transcript || "(khaali)";
      $("dub-translation").textContent = "(translation nahi hui — pair installed nahi hai)";
      $("dub-result").classList.remove("hidden");
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
    player.play().catch(() => {});
    loadHistory();
  } catch (e) {
    dubMsg.textContent = "Error: " + e.message;
  } finally { dubBtn.disabled = false; }
});

// ---- Studio ----
const studioBtn = $("studio-btn"), studioMsg = $("studio-msg"),
  studioSpeedEl = $("studio-speed");
let studioUrl = null;
studioSpeedEl.addEventListener("input", () => { $("studio-speed-val").textContent = Number(studioSpeedEl.value).toFixed(1) + "×"; });
studioBtn.addEventListener("click", async () => {
  if (!token) { studioMsg.textContent = "Studio ke liye login zaroori hai — pehle login ya signup karein."; return; }
  const text = $("studio-text").value.trim();
  if (!text) { studioMsg.textContent = "Pehle Studio ke liye text likhein."; return; }
  studioBtn.disabled = true; studioMsg.textContent = "Generating Studio audio… lamba text chunks mein banta hai, CPU par kuch minute lag sakte hain.";
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
      li.textContent = `Chapter ${c.index} — starts ${c.start_seconds}s: ${c.text}`;
      list.appendChild(li);
    }
    const remaining = r.headers.get("X-Credits-Remaining");
    if (remaining !== null) setCredits(Number(remaining));
    studioMsg.textContent = `Ready — ${(blob.size / 1024).toFixed(0)} KB, ${chapters.length} chapters.`;
    player.play().catch(() => {});
    loadHistory();
  } catch (e) {
    studioMsg.textContent = "Error: " + e.message;
  } finally { studioBtn.disabled = false; }
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
// Search filters (History / My Voices) — sirf list filter karte hain, koi fake global search nahi.
function wireFilter(inputId, listId) {
  const inp = $(inputId), list = $(listId);
  if (!inp || !list) return;
  inp.addEventListener("input", () => {
    const q = inp.value.trim().toLowerCase();
    list.querySelectorAll("li").forEach((li) => {
      li.style.display = !q || li.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  });
}
wireFilter("history-search", "history-list");
wireFilter("voices-search", "voices-list");
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
    const r = await fetch("/api/update/check");
    const d = await r.json();
    if (d.error || !d.latest) {
      setUpdateMsg(`Check failed — ${d.error || "offline?"} (current v${d.current})`);
      return;
    }
    if (d.update_available) {
      pendingUpdate = d.latest;
      setUpdateMsg(`Update available: v${d.latest} (current v${d.current})`);
      setApplyVisible(true);
    } else {
      setUpdateMsg(`✓ Up to date — v${d.current}`);
    }
  } catch (e) {
    setUpdateMsg("Check failed — server se rabta nahi hua.");
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
      return;
    }
    if (r.status === 403) {
      setUpdateMsg("Update sirf is machine se (127.0.0.1) allowed hai.");
      return;
    }
    if (!d.updated) {
      setUpdateMsg(`Update fail: ${d.detail || "git pull fail hua."} Server waisa hi chal raha hai.`);
      return;
    }
    setUpdateMsg("Update ho gaya — server restart karein (Ctrl+C, phir start.bat), phir page refresh karein.");
    const ref = $("update-refresh-btn");
    if (ref) ref.classList.remove("hidden");
  } catch (e) {
    setUpdateMsg("Update fail — server se rabta nahi hua. Server waisa hi chal raha hai.");
  }
}
$("update-btn").addEventListener("click", checkUpdate);
$("update-check-btn").addEventListener("click", checkUpdate);
$("update-apply-btn").addEventListener("click", applyUpdate);
$("update-refresh-btn").addEventListener("click", () => location.reload());
// Initial page from hash (default home).
showPage((location.hash || "#home").slice(1), false);
