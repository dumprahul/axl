# AXL Group Chat + OpenClaw — Quickstart

Encrypted group chat over AXL with an optional AI agent (OpenClaw) as a participant. One command spins up the chat UI, message dispatcher, and AI bridge together.

## Prerequisites

| Tool | Install | Notes |
|------|---------|-------|
| **Go** | [go.dev](https://go.dev/dl/) | 1.25.x recommended. If you have Go 1.26+, prefix build commands with `GOTOOLCHAIN=go1.25.5` |
| **Python 3.9+** | Usually pre-installed on macOS/Linux | |
| **pip packages** | `pip install textual requests` | |
| **OpenClaw** *(optional)* | `npm install -g openclaw@latest` | Only needed if you want an AI agent in the chat |

## Step 1 — Build the AXL node

```bash
git clone <repo-url> axl
cd axl
go build -o node ./cmd/node/
```

> **Go 1.26+ users:** `GOTOOLCHAIN=go1.25.5 go build -o node ./cmd/node/`

## Step 2 — Configure your node

Create a `node-config.json` in the repo root. Replace the peer address with the address given to you by the person hosting the group:

```json
{
  "Peers": ["tls://THEIR_IP:9001"]
}
```

That one field is all you need. The node generates an ephemeral identity automatically. For a persistent identity, add:

```json
{
  "PrivateKeyPath": "private.pem",
  "Peers": ["tls://THEIR_IP:9001"]
}
```

Then generate the key: `openssl genpkey -algorithm ed25519 -out private.pem`

### If you're the host

The host's config needs `Listen` so others can connect:

```json
{
  "PrivateKeyPath": "private.pem",
  "Peers": [],
  "Listen": ["tls://0.0.0.0:9001"]
}
```

Give your participants: **your public IP** and **port 9001** (or whatever you set). They'll use `tls://YOUR_IP:9001` in their `Peers` array.

## Step 3 — Start the node

```bash
./node -config node-config.json
```

Leave this running (Terminal 1). Your node will connect to the peer and establish an encrypted tunnel.

## Step 4 — Join the group chat

In a second terminal:

```bash
cd examples/python-client
python3 group_chat.py --port 9002 --group alpha --auto
```

That's it. You're in the group chat. The TUI will prompt for a display name.

### With OpenClaw (AI agent)

If you have OpenClaw installed and want your agent in the chat:

#### One-time setup

1. Onboard OpenClaw if you haven't: `openclaw onboard --install-daemon`
2. Enable the Chat Completions endpoint. Add this to `~/.openclaw/openclaw.json`:

```json5
{
  gateway: {
    http: {
      endpoints: {
        chatCompletions: { enabled: true },
      },
    },
  },
}
```

3. Restart the gateway: `openclaw restart`

#### Run with the agent

```bash
python3 group_chat.py --port 9002 --group alpha --auto --openclaw
```

The `--openclaw` flag automatically spins up a dispatcher and bridge in the background. Your OpenClaw agent appears as a participant in the group chat — no extra terminals needed.

## That's the whole flow

| Terminal | What's running |
|----------|---------------|
| 1 | `./node -config node-config.json` |
| 2 | `python3 group_chat.py --port 9002 --group alpha --auto --openclaw` |

Two terminals. Everyone in the group runs the same two commands (with their own peer address and optionally `--openclaw`).

## All flags

```
python3 group_chat.py [options]
```

**Core:**

| Flag | Default | Description |
|------|---------|-------------|
| `--port` | `9002` | AXL node API port |
| `--name` | *(prompted)* | Your display name |
| `--group` | `general` | Group ID (everyone must use the same one) |
| `--members` | — | Comma-separated peer public keys |
| `--auto` | — | Auto-discover peers from topology |

**OpenClaw (only matter when `--openclaw` is set):**

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--openclaw` | — | off | Enable AI agent |
| `--agent-name` | `OPENCLAW_DISPLAY_NAME` | `OpenClaw` | Agent's name in chat |
| `--gateway` | `OPENCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` | Gateway URL |
| `--gateway-token` | `OPENCLAW_GATEWAY_TOKEN` | *(none)* | Auth token |
| `--model` | `OPENCLAW_MODEL` | `openclaw/default` | Model/agent target |
| `--system-prompt` | `OPENCLAW_SYSTEM_PROMPT` | *(none)* | System prompt for agent |

## Troubleshooting

**"Cannot reach AXL node"** — The node isn't running, or you're using the wrong `--port`. Default is `9002`.

**"No connected peers found"** — Your node hasn't connected to any peers yet. Check that the `Peers` address in your config is correct and reachable.

**"Cannot reach OpenClaw gateway"** — OpenClaw isn't running. Start it with `openclaw onboard --install-daemon` or `openclaw start`.

**"OpenClaw gateway returned 4xx"** — The chatCompletions endpoint isn't enabled. See the one-time setup above.

**urllib3 NotOpenSSLWarning** — Harmless on macOS. LibreSSL vs OpenSSL mismatch. Everything still works.
