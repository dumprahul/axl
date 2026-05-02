# chatp · standalone AXL chat

Tiny **standalone** web shell around the **AXL Go `node`** binary: generate a **local ED25519 key + `node-config.json`**, start your node from the UI, paste a **recipient’s hex public key** (64 chars), then chat using the node’s **`/send`** and **`/recv`** HTTP APIs (same behavior as `web-chat`, one peer at a time in the transcript).

Nothing here runs blockchain-in-browser; your browser talks to **`chatp`’s Express server**, which talks to **`./node`** on `127.0.0.1`.

## Prerequisites

1. **Build the AXL node** (repository root):

   ```bash
   cd /path/to/axl
   make build
   ```

   Confirm `node` exists next to `cmd/` (`axl/node`).

2. **OpenSSL** on `PATH` (for `openssl genpkey`), standard on macOS/Linux.

## Install & run (`chatp` only needs Express)

From this folder (example on macOS):

```bash
cd /Users/apple/axl/axl/chatp
npm install
npm start
```

Open **http://127.0.0.1:3333** (or set `PORT`).

Identity generation **merges the repo template** **`../node-config-3.json`** into **`./data/node-config.json`** next to **`./data/private.pem`**. Ports (`api_port`, `tcp_port`, `bridge_addr`) are filled from defaults **only when missing** in that template — see **`CHATP_API_PORT` / `CHATP_TCP_PORT`**. Override the template path with **`CHATP_CONFIG_TEMPLATE`** if needed.

## Typical flow In the UI

1. Click **Generate new identity & config** — creates `./data/private.pem` and `./data/node-config.json` (default bootstrap peers aligned with upstream examples).
2. Click **Start AXL node** — runs the Go `./node -config node-config.json` with working directory `./data/` (paths in config stay stable).
3. Copy **Your public key** (from `GET /topology` once the node is up).
4. Paste **Recipient public key**.
5. Type messages · **Enter** sends; inbound lines are polled automatically.

Stop the node from the UI with **Stop AXL node** before switching ports or regenerating identity.

## Environment

| Variable | Purpose |
|---------|---------|
| `PORT` | Web UI + API (default **3333**). |
| `CHATP_AXL_NODE_BIN` | Absolute path to the `node` binary. Default: parent directory `../node` (i.e. `axl/node` when `cwd` is `axl/chatp`). |
| `CHATP_WEB_HOST` | Bind address for Express (default **127.0.0.1**). Only widen if you trust your network; this server can start processes and touches your filesystem under `./data/`). |
| `CHATP_DEFAULT_PEERS` | Optional JSON array of peer URIs, e.g. `["tls://1.2.3.4:9001"]`. If unset, packaged defaults match the upstream README examples. |
| `CHATP_API_PORT` | HTTP bridge port written into `./data/node-config.json` when creating identity (default **9132**). |
| `CHATP_TCP_PORT` | TCP port for the userspace listener (default **7102**) — change if occupied. |
| `CHATP_CONFIG_TEMPLATE` | Absolute path to a JSON template (default **`../node-config-3.json`** relative to `chatp/`). Used when clicking **Generate identity & config**. |

## Data layout

- `./data/private.pem` — **keep secret**.
- `./data/node-config.json` — Yggdrasil + bridge settings referenced by `./node`.

## Troubleshooting

- **“node binary not found”** — build with `make build` or set `CHATP_AXL_NODE_BIN`.
- **`listen tcp … bind: address already in use`** — another process uses `api_port` / `tcp_port`; edit `node-config.json` or set `CHATP_API_PORT` / `CHATP_TCP_PORT` **before** generating a new identity.
- **Outbound send fails (`502`)** — recipient offline, wrong key, routing/peers unreachable, or their TCP listener not reachable; check both sides’ **`Peers`** and network.
