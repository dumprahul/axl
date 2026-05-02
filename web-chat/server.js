import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.text({ type: ["text/*", "application/octet-stream"], limit: "1mb" }));

const NODE_A_URL = process.env.AXL_NODE_A_URL || "http://127.0.0.1:9002";
const NODE_B_URL = process.env.AXL_NODE_B_URL || "http://127.0.0.1:9012";

/** Bridge used by /pchat (single local node identity). Override if your node listens elsewhere. */
const PCHAT_NODE_URL = (process.env.AXL_PCHAT_NODE_URL || NODE_A_URL).replace(/\/$/, "");

/** Minimal A2A inbox server (run `node pchat/a2a-chat-backend.js`). Proxied so the browser avoids CORS. */
const PCHAT_A2A_BACKEND_URL = (process.env.AXL_PCHAT_A2A_BACKEND_URL || "http://127.0.0.1:9044").replace(/\/$/, "");

const PCHAT_PUBLIC_DIR = path.join(__dirname, "..", "pchat", "public");

function log(...args) {
  // eslint-disable-next-line no-console
  console.log("[web-chat]", ...args);
}

function nodeUrl(which) {
  if (which === "A") return NODE_A_URL;
  if (which === "B") return NODE_B_URL;
  throw new Error(`Invalid node "${which}" (expected "A" or "B")`);
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    nodeA: NODE_A_URL,
    nodeB: NODE_B_URL,
    pchatNode: PCHAT_NODE_URL,
    pchatA2aBackend: PCHAT_A2A_BACKEND_URL
  });
});

app.get("/api/topology", async (req, res) => {
  try {
    const which = String(req.query.node || "");
    const url = `${nodeUrl(which)}/topology`;
    const r = await fetch(url, { method: "GET" });
    const text = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(text);
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.post("/api/send", async (req, res) => {
  try {
    const { node, destPeerId, message } = req.body || {};
    if (!node || (node !== "A" && node !== "B")) {
      return res.status(400).json({ error: 'Missing/invalid "node" (use "A" or "B")' });
    }
    if (!destPeerId || typeof destPeerId !== "string") {
      return res.status(400).json({ error: 'Missing/invalid "destPeerId"' });
    }
    if (typeof message !== "string") {
      return res.status(400).json({ error: 'Missing/invalid "message" (string)' });
    }

    const url = `${nodeUrl(node)}/send`;
    log("send", { node, destPeerId: String(destPeerId).slice(0, 12) + "…", bytes: Buffer.byteLength(message, "utf8") });
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "X-Destination-Peer-Id": destPeerId,
        "Content-Type": "application/octet-stream"
      },
      body: Buffer.from(message, "utf8")
    });

    const body = await r.text();
    log("send.result", { node, status: r.status, sentBytes: r.headers.get("x-sent-bytes") });
    res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      sentBytes: r.headers.get("x-sent-bytes"),
      body
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/recv", async (req, res) => {
  try {
    const which = String(req.query.node || "");
    const url = `${nodeUrl(which)}/recv`;
    const r = await fetch(url, { method: "GET" });

    if (r.status === 204) {
      return res.status(204).end();
    }

    const buf = Buffer.from(await r.arrayBuffer());
    const fromPeerId = r.headers.get("x-from-peer-id") || "";
    log("recv", { node: which, status: r.status, fromPeerId: fromPeerId.slice(0, 12) + "…", bytes: buf.length });

    // Interpret as UTF-8 for chat UI; keep base64 too for debugging.
    res.status(r.status).json({
      fromPeerId,
      text: buf.toString("utf8"),
      base64: buf.toString("base64")
    });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

// --- /pchat: public-key A2A chat UI (live in ../pchat/public)

app.get(["/pchat", "/pchat/"], (_req, res) => {
  res.sendFile(path.join(PCHAT_PUBLIC_DIR, "index.html"));
});

app.use("/pchat", express.static(PCHAT_PUBLIC_DIR));

app.get("/api/pchat/info", (_req, res) => {
  res.json({ nodeUrl: PCHAT_NODE_URL, inboxProxyTarget: PCHAT_A2A_BACKEND_URL });
});

app.get("/api/pchat/topology", async (_req, res) => {
  try {
    const url = `${PCHAT_NODE_URL}/topology`;
    const r = await fetch(url, { method: "GET" });
    const text = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(text);
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.post("/api/pchat/send", async (req, res) => {
  try {
    const { destPeerId, message } = req.body || {};
    if (!destPeerId || typeof destPeerId !== "string") {
      return res.status(400).json({ error: 'Missing/invalid "destPeerId"' });
    }
    if (typeof message !== "string") {
      return res.status(400).json({ error: 'Missing/invalid "message" (string)' });
    }

    const url = `${PCHAT_NODE_URL}/send`;
    log("pchat.send", { destPeerId: String(destPeerId).slice(0, 12) + "…", bytes: Buffer.byteLength(message, "utf8") });
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "X-Destination-Peer-Id": destPeerId.trim(),
        "Content-Type": "application/octet-stream"
      },
      body: Buffer.from(message, "utf8")
    });

    const body = await r.text();
    log("pchat.send.result", { status: r.status });
    res.status(r.status).json({
      ok: r.ok,
      status: r.status,
      sentBytes: r.headers.get("x-sent-bytes"),
      body
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/pchat/recv", async (_req, res) => {
  try {
    const url = `${PCHAT_NODE_URL}/recv`;
    const r = await fetch(url, { method: "GET" });

    if (r.status === 204) {
      return res.status(204).end();
    }

    const buf = Buffer.from(await r.arrayBuffer());
    const fromPeerId = r.headers.get("x-from-peer-id") || "";
    log("pchat.recv", { status: r.status, fromPeerId: fromPeerId.slice(0, 12) + "…", bytes: buf.length });

    res.status(r.status).json({
      fromPeerId,
      text: buf.toString("utf8"),
      base64: buf.toString("base64")
    });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

/**
 * Proxies POST /a2a/{peer} on the local node. Works only when the remote peer routes A2A
 * to an A2A server (configure a2a_addr in node-config.json). Request body is forwarded as-is.
 */
app.post("/api/pchat/a2a", async (req, res) => {
  try {
    const { destPeerId, jsonrpcBody } = req.body || {};
    if (!destPeerId || typeof destPeerId !== "string") {
      return res.status(400).json({ error: 'Missing/invalid "destPeerId"' });
    }
    if (jsonrpcBody === undefined || jsonrpcBody === null) {
      return res.status(400).json({ error: 'Missing "jsonrpcBody" (object or JSON string)' });
    }

    const body =
      typeof jsonrpcBody === "string" ? jsonrpcBody : JSON.stringify(jsonrpcBody);

    const url = `${PCHAT_NODE_URL}/a2a/${encodeURIComponent(destPeerId.trim())}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body
    });

    const text = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(text);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/** GET /.well-known/agent-card on remote peer via local node's /a2a/{peer} */
app.get("/api/pchat/agent-card", async (req, res) => {
  try {
    const destPeerId = String(req.query.destPeerId || "").trim();
    if (!destPeerId) {
      return res.status(400).json({ error: "Query destPeerId is required" });
    }
    const url = `${PCHAT_NODE_URL}/a2a/${encodeURIComponent(destPeerId)}`;
    const r = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
    const text = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(text);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get("/api/pchat/inbox", async (req, res) => {
  try {
    const since = String(req.query.since || "").trim();
    const url = new URL(`${PCHAT_A2A_BACKEND_URL}/internal/inbox`);
    if (since) url.searchParams.set("since", since);
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const text = await r.text();
    res.status(r.status).type(r.headers.get("content-type") || "application/json").send(text);
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e?.message || e) });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (req, res) => {
  if (req.path.startsWith("/pchat")) {
    res.status(404).type("text/plain").send("Not found");
    return;
  }
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "127.0.0.1", () => {
  log(`http://127.0.0.1:${port}`);
  log(`NODE_A_URL=${NODE_A_URL}`);
  log(`NODE_B_URL=${NODE_B_URL}`);
  log(`PCHAT_NODE_URL=${PCHAT_NODE_URL}`);
  log(`PCHAT_A2A_BACKEND_URL=${PCHAT_A2A_BACKEND_URL}`);
});

