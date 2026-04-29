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

function nodeUrl(which) {
  if (which === "A") return NODE_A_URL;
  if (which === "B") return NODE_B_URL;
  throw new Error(`Invalid node "${which}" (expected "A" or "B")`);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, nodeA: NODE_A_URL, nodeB: NODE_B_URL });
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
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "X-Destination-Peer-Id": destPeerId,
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

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const port = Number(process.env.PORT || 3000);
app.listen(port, "127.0.0.1", () => {
  // eslint-disable-next-line no-console
  console.log(`[web-chat] http://127.0.0.1:${port}`);
  // eslint-disable-next-line no-console
  console.log(`[web-chat] NODE_A_URL=${NODE_A_URL}`);
  // eslint-disable-next-line no-console
  console.log(`[web-chat] NODE_B_URL=${NODE_B_URL}`);
});

