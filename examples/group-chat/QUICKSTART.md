# AXL Group Chat — Quickstart

Encrypted P2P group chat with an optional AI agent (OpenClaw).
Two terminals. Five minutes.

---

## 1. Build the node

```bash
git clone https://github.com/gensyn-ai/axl.git axl
cd axl
go build -o node ./cmd/node/
```

> Go 1.26+? Prefix with `GOTOOLCHAIN=go1.25.5 go build -o node ./cmd/node/`

## 2. Generate a key and install Python deps

```bash
openssl genpkey -algorithm ed25519 -out private.pem
pip install -r examples/group-chat/requirements.txt
```

The key gives your node a persistent identity (same public key across restarts). The pip install pulls in `textual` and `requests` — nothing heavy.

## 3. Start the node

```bash
./node -config node-config.json
```

Leave this running (**Terminal 1**). The included config peers with the bootstrap nodes automatically — you'll see your public key in the output.

## 4. Join the chat

Open a second terminal (**Terminal 2**):

```bash
cd axl/examples/group-chat
python3 group_chat.py --port 9002 --group alpha --auto
```

That's it. You're in. Send a message and anyone else on the mesh with the same `--group` will see it.

### With OpenClaw (AI agent)

Add `--openclaw` and your gateway token to have your AI agent join the chat:

```bash
python3 group_chat.py --port 9002 --group alpha --auto \
    --openclaw --gateway-token YOUR_TOKEN
```

Your agent responds to every message in the group — including yours. No extra terminals needed.

---

## OpenClaw one-time setup

Skip this if you don't want an AI agent.

### Prerequisites

- **Node.js 22+** — [nodejs.org](https://nodejs.org/)

### Steps

**1. Install and onboard:**

```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
```

Follow the prompts — it asks for your AI provider API key (Anthropic, OpenAI, etc.).

**2. Enable the HTTP API.** Open `~/.openclaw/openclaw.json` and add this block:

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

If the file already has content, merge this into the existing structure — don't replace the whole file.

**3. Restart and get your token:**

```bash
openclaw restart
openclaw token
```

Copy the token. To avoid retyping it every launch, add this to your `~/.zshrc`:

```bash
export OPENCLAW_GATEWAY_TOKEN=your_token_here
```

Then just `--openclaw` works without `--gateway-token`.

---

## TL;DR

| Terminal | Command |
|----------|---------|
| 1 | `./node -config node-config.json` |
| 2 | `python3 group_chat.py --port 9002 --group alpha --auto --openclaw` |

Drop `--openclaw` if you don't want the AI.

---

## Reference

### How peering works

The `node-config.json` has bootstrap node addresses in `Peers`. Everyone points at the same bootstraps — once on the mesh, AXL routes by public key. No direct connections, no port forwarding.

### All flags

**Core:**

| Flag | Default | What it does |
|------|---------|-------------|
| `--port` | `9002` | AXL node API port |
| `--name` | *(prompted)* | Your display name |
| `--group` | `general` | Group ID (must match for all participants) |
| `--auto` | — | Auto-discover peers |
| `--members` | — | Manual peer keys (comma-separated) |

**OpenClaw:**

| Flag | Env Var | Default |
|------|---------|---------|
| `--openclaw` | — | off |
| `--gateway-token` | `OPENCLAW_GATEWAY_TOKEN` | *(required)* |
| `--agent-name` | `OPENCLAW_DISPLAY_NAME` | `OpenClaw` |
| `--gateway` | `OPENCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` |
| `--model` | `OPENCLAW_MODEL` | `openclaw/default` |
| `--system-prompt` | `OPENCLAW_SYSTEM_PROMPT` | *(none)* |

### Files in this folder

| File | What |
|------|------|
| `group_chat.py` | **Run this.** Everything else is imported automatically. |
| `group_chat_tui.py` | Chat UI |
| `dispatcher.py` | Message fan-out (multi-consumer support) |
| `openclaw_bridge.py` | AI agent bridge |
| `agent_inbox.py` | Debug utility |

### Troubleshooting

| Error | Fix |
|-------|-----|
| "Cannot reach AXL node" | Node isn't running or wrong `--port` |
| "No connected peers found" | Wait a few seconds after node startup, or check `Peers` in config |
| "Cannot reach OpenClaw gateway" | Run `openclaw start` |
| "401 (Unauthorized)" | Pass `--gateway-token` (find it with `openclaw token`) |
| "gateway returned 4xx" | Enable `chatCompletions` in `~/.openclaw/openclaw.json` |
| "address already in use" | Kill the old process: `lsof -ti :9002 \| xargs kill` |
| "urllib3 NotOpenSSLWarning" | Harmless on macOS, ignore it |
| Messages not appearing | Everyone must use the same `--group` value |
