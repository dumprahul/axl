const $ = (id) => document.getElementById(id);

function now() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function addMsg(logEl, { dir, fromPeerId, text, ok = true }) {
  const wrap = document.createElement("div");
  wrap.className = "msg";
  wrap.innerHTML = `
    <div class="meta">
      <div>${dir}</div>
      <div>${ok ? "" : "<span style='color: var(--bad)'>error</span>"} ${now()}</div>
    </div>
    <div class="meta" style="margin-top:6px;">
      <div>from: <code>${(fromPeerId || "").slice(0, 32)}${fromPeerId && fromPeerId.length > 32 ? "…" : ""}</code></div>
      <div></div>
    </div>
    <div class="body"></div>
  `;
  wrap.querySelector(".body").textContent = text;
  logEl.appendChild(wrap);
  logEl.scrollTop = logEl.scrollHeight;
}

async function api(path, opts) {
  const r = await fetch(path, opts);
  if (r.status === 204) return { status: 204, ok: true, json: null };
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await r.json() : await r.text();
  return { status: r.status, ok: r.ok, json: body };
}

function setStatus(which, { ok, text }) {
  const dot = $(which === "A" ? "dotA" : "dotB");
  const status = $(which === "A" ? "statusA" : "statusB");
  dot.classList.toggle("ok", Boolean(ok));
  status.textContent = text;
}

async function refreshTopology(which) {
  try {
    const r = await api(`/api/topology?node=${encodeURIComponent(which)}`);
    if (!r.ok) {
      setStatus(which, { ok: false, text: `topology ${r.status}` });
      return;
    }
    const topo = r.json;
    const ourKeyEl = $(which === "A" ? "ourA" : "ourB");
    if (topo?.our_public_key) ourKeyEl.value = topo.our_public_key;
    setStatus(which, { ok: true, text: "ok" });
  } catch (e) {
    setStatus(which, { ok: false, text: "error" });
  }
}

async function sendFrom(which) {
  const destEl = $(which === "A" ? "destA" : "destB");
  const textEl = $(which === "A" ? "textA" : "textB");
  const ourEl = $(which === "A" ? "ourA" : "ourB");
  const logEl = $(which === "A" ? "logA" : "logB");

  const destPeerId = destEl.value.trim();
  const message = textEl.value;
  if (!destPeerId) {
    addMsg(logEl, { dir: `${which} → ?`, fromPeerId: "", text: "Set 'Send to' peer id first.", ok: false });
    return;
  }
  if (!message.trim()) return;

  const payload = { node: which, destPeerId, message };
  const r = await api("/api/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (r.ok && r.json?.ok) {
    addMsg(logEl, {
      dir: `${which} → ${destPeerId.slice(0, 10)}…`,
      fromPeerId: ourEl.value || "",
      text: message,
      ok: true
    });
    textEl.value = "";
  } else {
    addMsg(logEl, {
      dir: `${which} → ${destPeerId.slice(0, 10)}…`,
      fromPeerId: ourEl.value || "",
      text: `Send failed (${r.status}): ${typeof r.json === "string" ? r.json : (r.json?.body || JSON.stringify(r.json))}`,
      ok: false
    });
  }
}

function startPolling(which) {
  const logEl = $(which === "A" ? "logA" : "logB");
  const pollEl = $(which === "A" ? "pollA" : "pollB");
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const r = await fetch(`/api/recv?node=${encodeURIComponent(which)}`, { method: "GET" });
      if (r.status === 200) {
        const msg = await r.json();
        addMsg(logEl, {
          dir: `${which} recv`,
          fromPeerId: msg.fromPeerId,
          text: msg.text
        });
      }
      // 204 is expected when no messages are queued.
    } catch {
      // ignore transient errors
    } finally {
      setTimeout(tick, 150);
    }
  }

  pollEl.textContent = "on";
  tick();
  return () => {
    stopped = true;
    pollEl.textContent = "off";
  };
}

// Wire up UI
let stopPollA = null;
let stopPollB = null;

$("sendA").addEventListener("click", () => sendFrom("A"));
$("sendB").addEventListener("click", () => sendFrom("B"));

$("refreshA").addEventListener("click", () => refreshTopology("A"));
$("refreshB").addEventListener("click", () => refreshTopology("B"));

$("clearA").addEventListener("click", () => ($("logA").innerHTML = ""));
$("clearB").addEventListener("click", () => ($("logB").innerHTML = ""));

// Enter-to-send (Cmd/Ctrl+Enter)
for (const which of ["A", "B"]) {
  const el = $(which === "A" ? "textA" : "textB");
  el.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") sendFrom(which);
  });
}

async function boot() {
  await refreshTopology("A");
  await refreshTopology("B");

  // Auto-fill dests if blank.
  if (!$("destA").value.trim() && $("ourB").value.trim()) $("destA").value = $("ourB").value.trim();
  if (!$("destB").value.trim() && $("ourA").value.trim()) $("destB").value = $("ourA").value.trim();

  stopPollA = startPolling("A");
  stopPollB = startPolling("B");
}

boot();

