import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn, execFileSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const WEB_PORT = Number(process.env.PORT || 3333);
const WEB_HOST = process.env.CHATP_WEB_HOST || "127.0.0.1";
const DATA_DIR = path.join(__dirname, "data");
const CONFIG_PATH = path.join(DATA_DIR, "node-config.json");
const KEY_PATH = path.join(DATA_DIR, "private.pem");

/** Repo template merged into chatp/data/node-config.json when generating keys (default: axl/node-config-3.json). */
const CONFIG_TEMPLATE_PATH = path.resolve(
  process.env.CHATP_CONFIG_TEMPLATE || path.join(__dirname, "..", "node-config-3.json")
);

const DEFAULT_PEER_LIST = [
  "tls://34.46.48.224:9001",
  "tls://136.111.135.206:9001"
];

function defaultPeersFromEnv() {
  const raw = process.env.CHATP_DEFAULT_PEERS;
  if (!raw) return [...DEFAULT_PEER_LIST];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
  } catch {
    /* ignore */
  }
  return [...DEFAULT_PEER_LIST];
}

function defaultApiPort() {
  const n = Number(process.env.CHATP_API_PORT);
  return Number.isFinite(n) && n > 0 ? n : 9132;
}

function defaultTcpPort() {
  const n = Number(process.env.CHATP_TCP_PORT);
  return Number.isFinite(n) && n > 0 ? n : 7102;
}

function resolveAxlBin() {
  if (process.env.CHATP_AXL_NODE_BIN) return process.env.CHATP_AXL_NODE_BIN;
  const baseDir = path.join(__dirname, "..");
  const names = process.platform === "win32" ? ["node.exe", "node"] : ["node", "node.exe"];
  for (const name of names) {
    const p = path.join(baseDir, name);
    if (fs.existsSync(p)) return p;
  }
  return path.join(baseDir, process.platform === "win32" ? "node.exe" : "node");
}

let nodeChild = null;

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readConfigSafe() {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

function loadTemplateConfig() {
  if (!fs.existsSync(CONFIG_TEMPLATE_PATH)) {
    log("template.missing", CONFIG_TEMPLATE_PATH);
    return {
      PrivateKeyPath: "private.pem",
      Peers: [...DEFAULT_PEER_LIST],
      Listen: []
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_TEMPLATE_PATH, "utf8"));
    if (typeof raw !== "object" || raw === null) throw new Error("invalid json");
    return raw;
  } catch (e) {
    log("template.parse_error", String(e?.message || e));
    return {
      PrivateKeyPath: "private.pem",
      Peers: [...DEFAULT_PEER_LIST],
      Listen: []
    };
  }
}

/** Merge repo template (e.g. node-config-3.json) with chatp runtime: new key + stable bridge ports if omitted. */
function buildMergedDataConfig() {
  const t = loadTemplateConfig();
  const doc = { ...t };
  doc.PrivateKeyPath = "private.pem";
  if (!Array.isArray(doc.Peers) || doc.Peers.length === 0) {
    doc.Peers = defaultPeersFromEnv();
  }
  if (!Array.isArray(doc.Listen)) doc.Listen = [];
  if (!doc.bridge_addr) doc.bridge_addr = "127.0.0.1";
  if (!doc.api_port) doc.api_port = defaultApiPort();
  if (!doc.tcp_port) doc.tcp_port = defaultTcpPort();
  return doc;
}

function bridgeBaseFromConfig(cfg) {
  if (!cfg) return null;
  const host = cfg.bridge_addr?.trim?.() ? String(cfg.bridge_addr).trim() : "127.0.0.1";
  const port = Number(cfg.api_port) || 9002;
  return `http://${host}:${port}`;
}

async function pingTopology(cfg) {
  const base = bridgeBaseFromConfig(cfg);
  if (!base) return { ok: false };
  try {
    const r = await fetch(`${base}/topology`, { method: "GET" });
    if (!r.ok) return { ok: false, status: r.status };
    const j = await r.json();
    return { ok: true, our_public_key: j?.our_public_key || "", our_ipv6: j?.our_ipv6 || "" };
  } catch {
    return { ok: false };
  }
}

function generatePrivateKey() {
  ensureDataDir();
  execFileSync("openssl", ["genpkey", "-algorithm", "ed25519", "-out", KEY_PATH], {
    cwd: DATA_DIR,
    stdio: "pipe"
  });
  fs.chmodSync(KEY_PATH, 0o600);
}

function writeMergedNodeConfigFile() {
  const doc = buildMergedDataConfig();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(doc, null, 2), "utf8");
}

function log(...a) {
  // eslint-disable-next-line no-console
  console.log("[chatp]", ...a);
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/bootstrap", async (_req, res) => {
  const cfg = readConfigSafe();
  const ping = cfg ? await pingTopology(cfg) : { ok: false };
  const childRunning = !!(nodeChild && nodeChild.exitCode === null);
  const templateAbs = CONFIG_TEMPLATE_PATH;
  res.json({
    hasPrivateKey: fs.existsSync(KEY_PATH),
    hasConfig: !!cfg,
    config_template_path: templateAbs,
    config_template_found: fs.existsSync(templateAbs),
    bridge_url: cfg ? bridgeBaseFromConfig(cfg) : null,
    node_process_spawned_here: childRunning,
    topology_reachable: ping.ok,
    our_public_key: ping.ok ? ping.our_public_key || "" : "",
    our_ipv6: ping.ok ? ping.our_ipv6 || "" : "",
    axl_binary: resolveAxlBin(),
    binary_exists: fs.existsSync(resolveAxlBin())
  });
});

/** Lightweight poll for UI: node’s hex public key from live /topology only. */
app.get("/api/node-key", async (_req, res) => {
  const cfg = readConfigSafe();
  if (!cfg) {
    return res.status(404).json({ ok: false, error: "No data/node-config.json" });
  }
  const ping = await pingTopology(cfg);
  if (!ping.ok) {
    return res.status(503).json({ ok: false, our_public_key: "", our_ipv6: "" });
  }
  res.json({
    ok: true,
    our_public_key: ping.our_public_key || "",
    our_ipv6: ping.our_ipv6 || ""
  });
});

app.post("/api/identity", (req, res) => {
  try {
    const force = !!req.body?.force;
    if (fs.existsSync(KEY_PATH) && !force) {
      return res.status(409).json({
        error: "Identity already exists. Pass { \"force\": true } to regenerate (old key is overwritten)."
      });
    }
    ensureDataDir();

    generatePrivateKey();
    writeMergedNodeConfigFile();

    res.json({
      ok: true,
      config_path: CONFIG_PATH,
      template_path: CONFIG_TEMPLATE_PATH,
      merged_from_template: fs.existsSync(CONFIG_TEMPLATE_PATH),
      bridge_url: bridgeBaseFromConfig(readConfigSafe()),
      hint: `Start ./node · your public hex key comes from GET /topology on this bridge (${bridgeBaseFromConfig(readConfigSafe())}).`
    });
  } catch (e) {
    log("identity.error", String(e?.message || e));
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/config", (_req, res) => {
  const cfg = readConfigSafe();
  if (!cfg) return res.status(404).json({ error: "No node-config.json yet" });
  /** strip path details that point at local fs */
  const { PrivateKeyPath, Peers, Listen, api_port, tcp_port, bridge_addr, a2a_port, a2a_addr } = cfg;
  res.json({ PrivateKeyPath, Peers, Listen, api_port, tcp_port, bridge_addr, a2a_port, a2a_addr });
});

app.patch("/api/config/peers", (req, res) => {
  const peers = req.body?.peers;
  if (!Array.isArray(peers) || peers.some((p) => typeof p !== "string")) {
    return res.status(400).json({ error: "Body must include peers: string[]" });
  }
  const cfg = readConfigSafe();
  if (!cfg) return res.status(404).json({ error: "Generate identity first" });
  cfg.Peers = peers;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
  res.json({ ok: true });
});

app.post("/api/node/start", (req, res) => {
  const cfg = readConfigSafe();
  if (!cfg) return res.status(400).json({ error: "Create identity first" });
  const bin = resolveAxlBin();
  if (!fs.existsSync(bin)) {
    return res.status(500).json({
      error: `AXL node binary missing at ${bin}. Run 'make build' in the axl repo or set CHATP_AXL_NODE_BIN.`
    });
  }
  if (nodeChild && nodeChild.exitCode === null) {
    return res.status(409).json({ error: "AXL node process already spawned from this UI session." });
  }

  /** allow OS to release ports if rapid restart */
  const env = { ...process.env };

  nodeChild = spawn(bin, ["-config", "node-config.json"], {
    cwd: DATA_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });

  nodeChild.stdout?.on("data", (b) => log("node.stdout", b.toString().trimEnd()));
  nodeChild.stderr?.on("data", (b) => log("node.stderr", b.toString().trimEnd()));
  nodeChild.on("exit", (code, signal) => {
    log("node.exit", { code, signal });
    nodeChild = null;
  });

  res.json({
    ok: true,
    pid: nodeChild.pid,
    cwd: DATA_DIR,
    bridge_url: bridgeBaseFromConfig(cfg)
  });
});

app.post("/api/node/stop", (_req, res) => {
  if (!nodeChild || nodeChild.exitCode !== null) {
    return res.json({ ok: true, message: "No managed node process running from this UI." });
  }
  try {
    nodeChild.kill("SIGTERM");
    setTimeout(() => {
      try {
        if (nodeChild && !nodeChild.killed) nodeChild.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 2500).unref?.();
    res.json({ ok: true, message: "Sent SIGTERM to AXL node" });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

async function bridgeFetch(pathAndQuery, opts) {
  const cfg = readConfigSafe();
  const base = bridgeBaseFromConfig(cfg);
  if (!base) throw new Error("No config");
  const url = `${base}${pathAndQuery}`;
  return fetch(url, opts);
}

app.get("/api/topology", async (_req, res) => {
  try {
    const r = await bridgeFetch("/topology", { method: "GET" });
    const text = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(text);
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

app.post("/api/chat/send", async (req, res) => {
  try {
    const { destPeerId, message } = req.body || {};
    if (!destPeerId || typeof destPeerId !== "string") {
      return res.status(400).json({ error: "destPeerId required (64 hex chars)" });
    }
    if (typeof message !== "string") {
      return res.status(400).json({ error: "message must be a string" });
    }
    const r = await bridgeFetch("/send", {
      method: "POST",
      headers: {
        "X-Destination-Peer-Id": destPeerId.trim(),
        "Content-Type": "application/octet-stream"
      },
      body: Buffer.from(message, "utf8")
    });
    const body = await r.text();
    res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      sentBytes: r.headers.get("x-sent-bytes"),
      body
    });
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

app.get("/api/chat/recv", async (_req, res) => {
  try {
    const r = await bridgeFetch("/recv", { method: "GET" });
    if (r.status === 204) {
      return res.status(204).end();
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const fromPeerId = r.headers.get("x-from-peer-id") || "";
    res.status(r.status).json({
      fromPeerId,
      text: buf.toString("utf8")
    });
  } catch (e) {
    res.status(502).json({ error: String(e?.message || e) });
  }
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = app.listen(WEB_PORT, WEB_HOST, () => {
  log(`http://${WEB_HOST}:${WEB_PORT}`);
  log(`data directory  ${DATA_DIR}`);
  log(`config template ${CONFIG_TEMPLATE_PATH} (exists=${fs.existsSync(CONFIG_TEMPLATE_PATH)})`);
  const axl = resolveAxlBin();
  log(`AXL binary       ${axl} (exists=${fs.existsSync(axl)})`);
});

function shutdown() {
  if (nodeChild && nodeChild.exitCode === null) {
    try {
      nodeChild.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
