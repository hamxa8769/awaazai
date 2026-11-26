// AwaazAI demo — calls the local FastAPI backend. No fake audio: every
// clip comes from POST /api/tts (Kokoro-82M) on this machine.
const $ = (id) => document.getElementById(id);
const voiceSel = $("voice"), textEl = $("text"), speedEl = $("speed"),
  speedVal = $("speed-val"), btn = $("generate"), msg = $("msg"),
  player = $("player"), download = $("download"), pill = $("status-pill");

let audioUrl = null;

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
  } catch (e) {
    msg.textContent = "Voices load nahi hui: " + e.message;
  }
}

speedEl.addEventListener("input", () => { speedVal.textContent = Number(speedEl.value).toFixed(1) + "×"; });

btn.addEventListener("click", async () => {
  const text = textEl.value.trim();
  if (!text) { msg.textContent = "Pehle kuch text likhein."; return; }
  btn.disabled = true; msg.textContent = "Generating… (CPU par pehli dafa model load hone mein kuch second lag sakte hain)";
  try {
    const r = await fetch("/api/tts", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: voiceSel.value, speed: Number(speedEl.value) }),
    });
    if (!r.ok) throw new Error((await r.json()).detail || "TTS failed");
    const blob = await r.blob();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(blob);
    player.src = audioUrl; player.classList.remove("hidden");
    download.href = audioUrl; download.classList.remove("hidden");
    msg.textContent = `Ready — ${(blob.size / 1024).toFixed(0)} KB, engine Kokoro-82M.`;
    player.play().catch(() => {});
  } catch (e) {
    msg.textContent = "Error: " + e.message;
  } finally { btn.disabled = false; }
});

loadHealth();
loadVoices();
