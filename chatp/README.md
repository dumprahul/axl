# chatp

**chatp** is a small **standalone** web app in this folder. It helps you run the **AXL Go `node`**, create a **local identity** (Ed25519 private key + `node-config.json`), and **chat** with another peer over the network using the node’s HTTP APIs:

- **`POST /send`** — send bytes to a destination **hex public key** (64 characters).
- **`GET /recv`** — poll for inbound messages (raw queue; not A2A/MCP envelopes).

Your **browser** only talks to **chatp’s Express server** on `127.0.0.1`. That server runs **OpenSSL** to create keys, optionally **starts `./node`**, and **proxies** traffic to the node’s local bridge (e.g. `http://127.0.0.1:9132`).

---

## Repository layout (important)

`chatp` sits **inside** the AXL repo. From this README’s perspective:

```text
<axl-repo-root>/          ← directory with go.mod, Makefile, `node` binary after build
├── Makefile
├── go.mod
├── node                    ← created by: make build
├── node-config-3.json      ← default template merged into chatp when you generate identity
├── cmd/
└── chatp/                  ← this folder
    ├── package.json
    ├── server.js
    ├── public/             ← web UI
    └── data/               ← created at runtime (private key + config) — gitignored
```

All shell examples below assume:

- **`<axl-repo-root>`** = the folder that contains **`go.mod`** and **`Makefile`** (parent of **`chatp/`**).

---

## Prerequisites (from scratch)

| Requirement | Notes |
|-------------|--------|
| **Go toolchain** | Used by `make build` in the AXL repo (see upstream `README.md` for Go version). |
| **Node.js** | **18+** recommended (uses global `fetch`). |
| **npm** | Comes with Node. |
| **OpenSSL** | `openssl` on `PATH` — standard on macOS/Linux. |
| **Network** | Outbound access to the **`Peers`** in your config (defaults use public bootstrap nodes from the main AXL docs). |

---

## Part A — Build the AXL `node` binary (once)

From **`<axl-repo-root>`**:

```bash
cd <axl-repo-root>
make build
```

Confirm the binary exists:

```bash
ls -la node
# On Windows (if you build there), the file may be node.exe
```

If `make build` fails, fix your Go version / toolchain per the main **[axl README](../README.md)** and **[docs/configuration.md](../docs/configuration.md)**.

---

## Part B — Install and start chatp

```bash
cd <axl-repo-root>/chatp
npm install
npm start
```

You should see a line like:

```text
[chatp] http://127.0.0.1:3333
```

Open in your browser:

**http://127.0.0.1:3333**

Use another port if needed:

```bash
PORT=4000 npm start
```

---

## Part C — Create identity and config (first time)

In the **chatp** web UI:

1. **Optional:** check **Regenerate** if `data/` already exists and you want a **new** key (this overwrites `private.pem` and rebuilds `node-config.json`).
2. Click **Generate identity & config**.

What this does:

- Runs **`openssl genpkey -algorithm ed25519`** → writes **`chatp/data/private.pem`** (**secret; never share**).
- Reads the template **`../node-config-3.json`** (override with **`CHATP_CONFIG_TEMPLATE`**) and merges it into **`chatp/data/node-config.json`**, with:
  - **`PrivateKeyPath`**: `"private.pem"` (relative to `data/` when you run `./node`),
  - **`Peers` / `Listen`** from the template,
  - **`bridge_addr`**, **`api_port`**, **`tcp_port`** added **only if missing** in the template (defaults: `127.0.0.1`, **9132**, **7102** — avoids clashing with another local node on 9002).

The top of the page shows **Your node’s public key** once the bridge is up (from **`GET /topology`** → **`our_public_key`**).

---

## Part D — Start the AXL node (required for chat)

You need **exactly one** running bridge using **`chatp/data/node-config.json`**.

### Option 1 — From the UI (easiest)

Click **Start AXL node**. chatp spawns:

```text
<axl-repo-root>/node -config node-config.json
```

with **`cwd`** = **`chatp/data/`**, so **`private.pem`** resolves correctly.

### Option 2 — Manual terminal

```bash
cd <axl-repo-root>/chatp/data
../../node -config node-config.json
```

Leave this process running while you chat.

Successful startup usually logs something like **Listening on 127.0.0.1:&lt;api_port&gt;** and connects to **`Peers`** over time.

To stop:

- UI: **Stop AXL node**, or  
- Terminal: **Ctrl+C** where `./node` is running.

---

## Part E — Chat with someone else

Both sides must:

1. Have built **`node`** and be running **`chatp`** (or another client) **or** speak to the bridge API directly.
2. Run their own `./node` with their own **`data/private.pem`** and **`data/node-config.json`** (or equivalent).
3. Be able to route to each other (same **`Peers` / bootstrap** pattern as usual for AXL; see main docs).

**In the UI:**

1. Wait until **Your node’s public key** appears (topology reachable).
2. Send your **hex public key** to your peer **out of band** (message, DM, etc.).
3. Paste their **hex public key** (64 chars) into **Recipient**.
4. Type a message · **Enter** sends (Shift+Enter = newline).

Inbound lines from **that** sender appear when **`GET /recv`** returns **`200`**; the UI polls automatically.

---

## Environment variables

| Variable | Purpose |
|---------|---------|
| `PORT` | Web server port (**default `3333`**). |
| `CHATP_AXL_NODE_BIN` | Full path to the Go **`node`** binary if not **`<axl-repo-root>/node`**. |
| `CHATP_WEB_HOST` | Bind address for Express (**default `127.0.0.1`**). Do not expose to the internet without understanding the risk: this app can start processes and write under **`./data/`**. |
| `CHATP_CONFIG_TEMPLATE` | Path to JSON template (**default** resolves to **`<axl-repo-root>/node-config-3.json`**). |
| `CHATP_API_PORT` | Default **HTTP bridge** port written into **`data/node-config.json`** when **`api_port`** is omitted in the template (**default `9132`**). |
| `CHATP_TCP_PORT` | Default **TCP** port for the userspace listener when **`tcp_port`** is omitted (**default `7102`**). |
| `CHATP_DEFAULT_PEERS` | JSON array of peer URIs; only used if the template has **no** `Peers` (rare). |

Set **`CHATP_API_PORT`** / **`CHATP_TCP_PORT`** **before** clicking **Generate identity & config** if **9132** / **7102** are already in use.

---

## Files under `chatp/data/` (gitignored)

| File | Role |
|------|------|
| **`private.pem`** | **Your secret key.** Back it up if you care about this identity; never commit it. |
| **`node-config.json`** | Yggdrasil + bridge settings used by **`./node`**. |

---

## Troubleshooting

| Symptom | What to do |
|---------|------------|
| **`node binary not found`** | Run **Part A** from **`<axl-repo-root>`** or set **`CHATP_AXL_NODE_BIN`**. |
| **`open … node-config.json: no such file`** | Run **Generate identity & config** in the UI (creates **`data/`**). |
| **`listen tcp … bind: address already in use`** | Another **`node`** (or app) already uses **`api_port`** or **`tcp_port`**. Stop it, or set **`CHATP_API_PORT`** / **`CHATP_TCP_PORT`** and **regenerate** identity. |
| **Public key stays empty** | Bridge not running or not reachable at the URL in **`data/node-config.json`** (`bridge_addr` + `api_port`). Start **`./node`** and check logs. |
| **Send returns 502 / failed to reach peer** | Wrong recipient key, peer offline, no route, or TCP path not open between nodes; verify **`Peers`** and that the other side’s node is running. |
| **`openssl` not found** | Install OpenSSL and ensure it is on **`PATH`**. |

---

## Security notes

- **`chatp`** is meant for **local development**: it binds to **127.0.0.1** by default and manages files under **`./data/`**.
- Treat **`private.pem`** like a password.
- For production or multi-user hosts, run the Go **`node`** under your own process manager and only expose what you intend.

---

## See also

- Main AXL overview: **[README.md](../README.md)**
- HTTP API details: **[docs/api.md](../docs/api.md)**
- Configuration: **[docs/configuration.md](../docs/configuration.md)**
