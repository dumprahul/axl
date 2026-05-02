const STORAGE_DEST = "chatp.destPeer";

const $ = (id) => document.getElementById(id);

function isoNow() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function show(el, text, ok) {
  el.textContent = text;
  el.classList.toggle("ok", Boolean(ok));
  if (!text) el.classList.remove("ok");
}

function validPub64(s) {
  return /^[0-9a-fA-F]{64}$/.test(String(s || "").trim());
}

function bubble(kind, subtitle, body) {
  const wrap = document.createElement("div");
  wrap.className = `bubble ${kind}`;
  wrap.innerHTML = `<div class="meta"></div><div class="body"></div>`;
  wrap.querySelector(".meta").textContent = subtitle;
  wrap.querySelector(".body").textContent = body;
  $("msgs").appendChild(wrap);
  $("msgs").scrollTop = $("msgs").scrollHeight;
}

function paintPublicKey(hex, ipv6, reachable, templatePath, templateFound) {
  const ks = $("keyState");
  const big = $("pubKeyBig");

  if (validPub64(hex) && reachable) {
    ks.textContent = templateFound
      ? `Live · merged from ${shortPath(templatePath)} + data/private.pem`
      : "Live · key from node /topology";
    ks.classList.add("ready");
    big.textContent = hex;
    $("yourKey").value = hex;
    $("ipv6").value = ipv6 || "";
    return;
  }

  ks.classList.remove("ready");

  if (!templateFound) {
    ks.textContent = templatePath
      ? `Missing template: ${shortPath(templatePath)}`
      : "Set CHATP_CONFIG_TEMPLATE or add axl/node-config-3.json beside chatp.";
    big.textContent = "—";
    $("yourKey").value = "";
    $("ipv6").value = "";
    return;
  }

  if (reachable && !validPub64(hex)) {
    ks.textContent = "/topology reachable but our_public_key missing or not 64 hex chars.";
    big.textContent = "—";
    $("yourKey").value = "";
    $("ipv6").value = "";
    return;
  }

  $("yourKey").value = "";
  $("ipv6").value = "";
  big.textContent = "—";
  ks.textContent =
    "Bridge down — click Start AXL node or run ../../node -config node-config.json from data/";
}

function shortPath(p) {
  const s = String(p || "");
  if (s.length > 56) return "…" + s.slice(-52);
  return s;
}

async function refreshNodeKeyPoll() {
  try {
    const r = await fetch("/api/node-key");
    const j = await r.json().catch(() => ({}));
    const b = window.__bootstrap_cache || {};

    const tplPath = b.config_template_path || "";
    const tplFound = Boolean(b.config_template_found);

    if (j.ok && validPub64(j.our_public_key)) {
      paintPublicKey(j.our_public_key, j.our_ipv6, true, tplPath, tplFound);
      return;
    }
    paintPublicKey("", "", false, tplPath, tplFound);
  } catch {
    const b = window.__bootstrap_cache || {};
    paintPublicKey("", "", false, b.config_template_path || "", Boolean(b.config_template_found));
  }
}

async function bootstrap() {
  const r = await fetch("/api/bootstrap");
  const j = await r.json();
  window.__bootstrap_cache = j;

  $("statusGrid").innerHTML = "";

  function row(dt, dd) {
    const dti = document.createElement("dt");
    dti.textContent = dt;
    const ddi = document.createElement("dd");
    ddi.textContent = dd;
    $("statusGrid").append(dti, ddi);
  }

  row("Private key file", String(j.hasPrivateKey));
  row("node-config.json", String(j.hasConfig));
  row("Topology reachable", String(j.topology_reachable));
  row("Spawned via UI", String(j.node_process_spawned_here));
  row("Bridge URL", j.bridge_url || "—");
  row("Go binary OK", `${j.binary_exists} (${j.axl_binary || ""})`);
  row(
    "Config template",
    `${j.config_template_found ? "found" : "MISSING"} — ${shortPath(j.config_template_path || "")}`
  );

  paintPublicKey(
    j.our_public_key || "",
    j.our_ipv6 || "",
    Boolean(j.topology_reachable),
    j.config_template_path || "",
    Boolean(j.config_template_found)
  );

  if (j.hasConfig) {
    const cr = await fetch("/api/config");
    if (cr.ok) {
      const c = await cr.json();
      $("peersTa").value = JSON.stringify(c.Peers || [], null, 2);
    }
  }

  return j;
}

async function identity() {
  const force = $("identityForce").checked;
  try {
    const r = await fetch("/api/identity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    $("identityForce").checked = false;
    show($("setupMsg"), "Identity saved under ./data/ — start node next.", true);
  } catch (e) {
    show($("setupMsg"), String(e.message || e), false);
  }
  bootstrap();
}

async function nodeStart() {
  try {
    const r = await fetch("/api/node/start", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    show($("setupMsg"), "Node spawned — polling topology…", true);

    for (let i = 0; i < 35; i++) {
      await new Promise((res) => setTimeout(res, 400));
      const b = await bootstrap();
      if (b.topology_reachable && validPub64(b.our_public_key)) {
        $("yourKey").value = b.our_public_key;
        $("ipv6").value = b.our_ipv6 || "";
        show($("setupMsg"), "Node bridge ready.", true);
        return;
      }
    }
    show(
      $("setupMsg"),
      "Still waiting for topology. Check ./data logs or ports (api/tcp). See README.",
      false
    );
  } catch (e) {
    show($("setupMsg"), String(e.message || e), false);
  }
  bootstrap();
}

async function nodeStop() {
  const r = await fetch("/api/node/stop", { method: "POST" });
  const j = await r.json().catch(() => ({}));
  show($("setupMsg"), j.message || JSON.stringify(j), r.ok && j.ok !== false);
  bootstrap();
}

async function savePeers() {
  try {
    const parsed = JSON.parse($("peersTa").value);
    if (!Array.isArray(parsed)) throw new Error("Peers must be a JSON array of strings.");
    const r = await fetch("/api/config/peers", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ peers: parsed })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.statusText);
    show($("setupMsg"), "Peers saved.", true);
  } catch (e) {
    show($("setupMsg"), String(e.message || e), false);
  }
  bootstrap();
}

async function pollRecv() {
  const destNorm = $("destPeerId").value.trim().toLowerCase();
  if (!destNorm) return;

  try {
    const r = await fetch("/api/chat/recv");
    if (r.status === 204) return;

    const j = await r.json();
    const from = (j.fromPeerId || "").toLowerCase();
    if (!from) return;
    /** One thread keyed by recipient field (strict match on sender pubkey). */
    if (from === destNorm) {
      bubble("them", `${isoNow()} · ${from.slice(0, 16)}…`, j.text ?? "");
    }
  } catch {
    /* ignore recv transport blips while node boots */
  }
}

async function sendMsg() {
  show($("chatMsg"), "");

  const dest = $("destPeerId").value.trim();
  const text = $("msgInput").value;

  if (!validPub64(dest)) {
    show($("chatMsg"), "Recipient must be 64-character hex.", false);
    return;
  }

  const my = $("yourKey").value.trim().toLowerCase();
  if (my && dest.toLowerCase() === my) {
    show($("chatMsg"), "Recipient cannot be your own public key.", false);
    return;
  }

  if (!text.trim()) return;

  const r = await fetch("/api/chat/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ destPeerId: dest, message: text })
  });

  const j = await r.json().catch(() => ({}));

  if (!r.ok || j.ok === false) {
    show(
      $("chatMsg"),
      typeof j.body === "string" && j.body ? j.body : JSON.stringify(j, null, 2),
      false
    );
    return;
  }

  bubble("me", `you → ${dest.slice(0, 14)}… · ${isoNow()}`, text);
  $("msgInput").value = "";
}

function bootUi() {
  $("destPeerId").value = localStorage.getItem(STORAGE_DEST) || "";

  $("btnIdentity").addEventListener("click", identity);
  $("btnNodeStart").addEventListener("click", nodeStart);
  $("btnNodeStop").addEventListener("click", nodeStop);
  $("btnRefresh").addEventListener("click", () => bootstrap());
  $("btnSavePeers").addEventListener("click", savePeers);

  $("btnRemember").addEventListener("click", () => {
    const v = $("destPeerId").value.trim();
    if (validPub64(v)) localStorage.setItem(STORAGE_DEST, v);
    else localStorage.removeItem(STORAGE_DEST);
  });

  $("btnCopyKey").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("yourKey").value);
      show($("setupMsg"), "Public key copied.", true);
    } catch {
      show($("setupMsg"), "Copy failed — select & copy manually.", false);
    }
  });

  $("btnSend").addEventListener("click", sendMsg);
  $("msgInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  });

  bootstrap().then(refreshNodeKeyPoll);
  setInterval(refreshNodeKeyPoll, 1200);
  setInterval(() => bootstrap().then(refreshNodeKeyPoll), 5000);
  setInterval(pollRecv, 380);
}

bootUi();
