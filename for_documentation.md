# Documentation Notes

Running log of findings, fixes, and context gathered during development. Use this to inform official docs.

---

## Setup & Build

- **Go is required.** Install via `brew install go`. The project currently requires Go 1.25; a `toolchain go1.25.5` directive in `go.mod` ensures the correct version is used automatically even if a newer Go is installed.
- **Build the binary:** `go build -o node ./cmd/node/`
- **Run the node:** `./node -config node-config.json`
- **Go 1.26 incompatibility:** The `gvisor.dev/gvisor` dependency has build tag conflicts with Go 1.26. The `toolchain go1.25.5` directive in `go.mod` works around this. Do not remove it until gvisor upstream fixes their Go 1.26 support.
- **Python dependencies live in a subdirectory.** The Python examples have their own `requirements.txt` at `examples/python-client/requirements.txt`. This won't be auto-installed — users (and tools like Cursor) need to install them explicitly: `pip3 install -r examples/python-client/requirements.txt`. If someone imports the Python client as a module rather than running it directly, they'll hit `ModuleNotFoundError` for `requests` and other packages unless they've done this step. This should be called out in the README or quickstart.

## Key Generation

- The node needs an ed25519 private key at the path specified by `PrivateKeyPath` in `node-config.json` (default: `private.pem`).
- **macOS ships with LibreSSL**, which does **not** support ed25519. The default `openssl` command will fail.
- Use Homebrew's OpenSSL instead: `/opt/homebrew/opt/openssl/bin/openssl genpkey -algorithm ed25519 -out private.pem`
- Install it with `brew install openssl` if not already present.
- Alternatively, omit `PrivateKeyPath` from the config entirely — the node will generate an ephemeral identity on each startup (no persistent key).

## Configuration (`node-config.json`)

- `PrivateKeyPath` — path to ed25519 PEM key. Omit for ephemeral identity.
- `Peers` — list of bootstrap peer URIs to connect to on startup.
- `Listen` — addresses this node listens on for inbound peer connections.
- API defaults to `127.0.0.1:9002`. TCP listener defaults to port `7000`.

## Network Architecture

- The node uses **Yggdrasil**, an encrypted IPv6 overlay network, for all peer-to-peer transport.
- Peers form a **spanning tree** for routing. Each node gets a deterministic IPv6 address derived from its public key.
- **Bootstrap peers** (the IPs in `Peers`) are nodes that your node connects to on startup in order to join the network. They are entry points, not controllers. The current ones in the default config are developer nodes (see Bootstrap Peers section) — not permanent infrastructure.
- All connections are encrypted and authenticated via ed25519. Bootstrap nodes route traffic but cannot read message contents.
- Nodes are identified by their **64-character hex-encoded ed25519 public key**, not by IP or hostname.

### Encryption: Two Layers

There are two distinct layers of encryption in the network. This distinction matters and should be documented clearly so users don't have to read Yggdrasil's own docs to understand the security model.

**Layer 1 — Peering transport (TLS).** The `tls://` URIs in the config establish encrypted links between directly connected peers. This is hop-by-hop encryption — it secures the connection between your node and the peer it's directly connected to (e.g. a bootstrap node). This is standard TLS.

**Layer 2 — End-to-end payload encryption (Yggdrasil).** Separately from the peering TLS, Yggdrasil encrypts all traffic between source and destination nodes using cryptographic keys derived from both nodes' ed25519 key pairs. This is end-to-end — if Node A sends a message to Node C and it routes through Node B, Node B sees only ciphertext it cannot decrypt. This is a core design property of Yggdrasil's protocol, not a side effect of TLS.

**Why this matters:** in a mesh network, your traffic may pass through nodes you don't control. Layer 1 (TLS) protects the link. Layer 2 (Yggdrasil E2E) protects the payload across the entire path, regardless of how many hops it takes.

> **ACTION REQUIRED:** This two-layer encryption model is based on Yggdrasil's documented design. Before using "end-to-end encrypted" as a selling point in any public materials, hackathon docs, or use-case examples (e.g. Delphi integration), **confirm with the AXL/Gensyn team** that:
> 1. Yggdrasil's end-to-end encryption is active and unmodified in AXL's usage of the library
> 2. No application-layer data is exposed outside the Yggdrasil encryption envelope (e.g. stream metadata, routing headers)
> 3. The claim "intermediate routing nodes cannot read message payloads" is accurate as implemented, not just as designed
>
> Once confirmed, this section can be cited directly in security claims and the Delphi integration doc.

## Security & Privacy Model

When two nodes communicate, three types of participant are involved: the **sending node**, the **receiving node**, and any **routing nodes** in between (including bootstrap peers). Here's what each can and cannot see.

### What is encrypted

- All traffic between nodes is encrypted at two layers (see "Encryption: Two Layers" in Network Architecture above): TLS secures the direct peering link, and Yggdrasil's end-to-end encryption secures the payload across the full path.
- Each node authenticates via its ed25519 key pair — both sides prove ownership of their public key before any data flows.
- Message content (your payload — whatever your application sends) is encrypted end-to-end between source and destination. Intermediate routing nodes carry ciphertext they cannot decrypt. *(Pending team confirmation — see action item in Network Architecture.)*

### What routing nodes (including bootstrap peers) CAN see

- That your node exists and your IP address (you connected to them directly).
- That two nodes are communicating — source and destination public keys.
- Traffic patterns: when communication happens, how frequently, approximate message sizes.

### What routing nodes CANNOT see

- Message content. They route encrypted bytes with no ability to decrypt.
- What your application does, what services you expose, or what commands are being sent.
- Any application-level metadata (JSON fields, headers, etc.) — that's all inside the encrypted payload.

### What is NOT stored

- Messages are held in an **in-memory queue** on the receiving node. Once read via `/recv`, they're gone.
- There is no persistent message log, no database, no server-side storage anywhere in the network.
- If a node is offline, messages to it simply fail — there is no store-and-forward.

### Limitations to be aware of

- **Not onion-routed.** There is no traffic obfuscation like Tor. Routing nodes can perform traffic analysis (who talks to whom, when, how much).
- **IP is visible to direct connections.** Bootstrap peers and any node you peer with directly can see your real IP address.
- **No formal security audit.** Yggdrasil is open source and uses standard cryptographic primitives (ed25519, TLS), but it has not been through a formal third-party security audit.
- **Key compromise is total.** If someone obtains your private key, they can impersonate your node and potentially decrypt captured past traffic. Protect your `private.pem` file.

### Summary

The sending and receiving nodes can read everything. Anything in between — bootstrap peers, intermediate routing nodes — sees only encrypted bytes and metadata about who is talking to whom. No messages are stored anywhere in the network. Your node's local API (`127.0.0.1`) is not exposed to the internet; only you can access it.

## Bootstrap Peers (Current)

- `tls://34.46.48.224:9001` — development node (GCP)
- `tls://136.111.135.206:9001` — development node
- **These are development nodes that will be shut down before public release.** They are not permanent infrastructure.
- **There will be no public Gensyn-hosted nodes for the public release** — running public nodes exposes remote code execution risk, so the recommended approach for users is local testing with two nodes on the same machine (see "Testing Locally with Two Nodes" below).
- For the public release, the `Peers` list in the default config will need to be updated or emptied. Users will either peer with each other directly or use community-run bootstrap nodes.

### LAN vs Internet Peering

- **On a local network (LAN):** peering between two machines is trivial. Both nodes just need each other's LAN IP and listen port.
- **Over the internet:** the node operator must expose their machine's TCP port (default `7000`) to the internet (port forwarding, firewall rules, etc.) for other nodes to connect inbound.
- For local development and testing, the two-node setup on a single machine avoids this entirely.

## API Basics

- All application communication goes through the HTTP API on localhost. Applications never touch the network directly.
- `GET /topology` — returns this node's IPv6, public key, connected peers, and spanning tree.
- `POST /send` — fire-and-forget message to a peer (set `X-Destination-Peer-Id` header).
- `GET /recv` — poll for inbound messages (dequeues one per call).
- `POST /mcp/{peer_id}/{service}` — JSON-RPC request/response to a remote MCP service (30s timeout).
- `POST /a2a/{peer_id}` — JSON-RPC request/response to a remote A2A server (30s timeout).

## Hackathon Guide

### How It Works for Participants

1. **Clone the repo, build, run the node** — you're now on the network with a public key.
2. **Another participant does the same thing** — they're also on the network with their own public key.
3. **Exchange public keys** (Slack, Discord, whatever) — now you can address each other.
4. **Build your application on top of the local HTTP API** — your app talks to `localhost:9002`, never to the network directly.

### Key Concepts to Communicate

- **There is no separate "server" to deploy.** Your node IS your presence on the network. It runs on your laptop, and the bootstrap peers handle routing messages between all participants' nodes.
- **Your "service" is just a regular application** (Python, JS, whatever) running on your own machine, talking to your local node over HTTP. You don't deploy anything to the cloud.
- **Other participants reach you by your public key.** The Yggdrasil network + bootstrap peers route messages to your laptop automatically.
- **The node is application-agnostic.** It doesn't care what you send — JSON, protobuf, raw bytes, tensors. You pick the serialization.

### Your Application Is Always Local

This is the single most important mental model for AXL development and it must be documented clearly, because it's counterintuitive coming from traditional client-server architecture.

**Your application code never touches the network.** It runs on your machine and only ever talks to `http://127.0.0.1:9002` — the local HTTP API exposed by your AXL node. Your node handles all peer-to-peer transport, encryption, and routing behind the scenes. Your code never opens a socket to a remote machine.

**Both sides run the full stack independently.** If two people want to chat, each person runs:
1. Their own AXL node (the Go binary)
2. Their own copy of the application (e.g. the chat script)

Nobody "connects to" the other person's application. Each application talks only to its own local node. The nodes talk to each other over the Yggdrasil network.

```
Person A's machine:                     Person B's machine:
┌──────────────────────┐                ┌──────────────────────┐
│  [chat_tui.py]       │                │  [chat_tui.py]       │
│       ↕ HTTP         │                │       ↕ HTTP         │
│  [AXL node :9002]    │ ◄── network ──►│  [AXL node :9002]    │
└──────────────────────┘                └──────────────────────┘
```

**"Exposing a service" doesn't mean what it usually means.** In traditional web development, exposing a service means binding to a port and accepting remote connections. In AXL, it means: your node is running, your application is running locally and polling `/recv` (or listening on `/mcp` or `/a2a`), and remote nodes send messages to your public key. The Yggdrasil network routes those messages to your node, which queues them for your application to pick up. Your application is never directly reachable from the outside — the node is the only thing with a network presence.

This means there's nothing to "deploy." You don't push your service to a cloud server. You run it on your laptop, and as long as your node is up and connected to the network, other nodes can reach you by your public key.

### What Building an App Looks Like

A participant writes a service (in any language) that:
- Calls `GET /topology` to learn their own public key
- Calls `POST /send` to push messages to other participants' nodes
- Polls `GET /recv` to pick up messages sent to them
- Or uses `/mcp/{peer_id}/{service}` or `/a2a/{peer_id}` for structured request/response (MCP tools, A2A agents)

### Sharing Your Public Key (How Real People Connect)

Your public key is your address on the network. To connect with another person, you need to exchange keys — like trading phone numbers. Here's how that works in practice:

**Step 1: Find your own public key.** Each person runs this on their own machine:
```bash
curl -s http://127.0.0.1:9002/topology | python3 -c "import sys,json; print(json.load(sys.stdin)['our_public_key'])"
```
This only works locally — your API is bound to `127.0.0.1` and is not visible to anyone else on the internet.

**Step 2: Share it out-of-band.** Copy the 64-character hex string and send it to the other person via Slack, Discord, email, text, etc. They do the same for you.

**Step 3: Use their key to send messages.** Once you have someone's public key, you can send to them:
```bash
curl -X POST http://127.0.0.1:9002/send \
  -H "X-Destination-Peer-Id: <THEIR_PUBLIC_KEY>" \
  -d "your message here"
```

**Important:** There is no way to "look up" another node's public key from the network. The `/topology` endpoint does show public keys of nodes in the spanning tree, but that only includes nodes your node has routing knowledge of — and it doesn't tell you who owns them or what services they run. Public keys must be exchanged directly between people.

### Discovery Gap

- There is currently no built-in registry of "here are all the nodes and what services they offer."
- Participants need to share public keys manually as described above.
- A service registry built on top of send/recv could itself be a hackathon project — nodes could announce themselves and their capabilities to a known registry node, and others could query it.

### Potential Hackathon Pitfalls

- macOS users will hit the LibreSSL/ed25519 key generation issue (see Key Generation section above).
- Go 1.26 users will hit the gvisor build tag issue (see Setup & Build section above).
- Both nodes must be running for send to work — there is no store-and-forward. If someone's laptop is closed, messages to them will fail.

### Testing Locally with Two Nodes

**This is the recommended way to test.** Since there are no public Gensyn-hosted nodes for demos (due to remote code execution concerns), testing locally with two nodes on your own machine is the standard development workflow. Each node gets its own identity, ports, and config.

#### Setup

1. **You already have Node A running** (your main node on port 9002).

2. **Create a second config** (`node-config-2.json`) with different ports and a different key. Use the same `Peers` list as your main config (whatever bootstrap peers are available at the time):
   ```json
   {
     "PrivateKeyPath": "private-2.pem",
     "Peers": [],
     "Listen": [],
     "api_port": 9012,
     "tcp_port": 7001
   }
   ```
   > **Note:** The `Peers` list here is empty because the current bootstrap peers (Johnny's dev nodes) will be shut down before public release. For local testing on the same machine, both nodes can discover each other through the same bootstrap peers — or, if no bootstrap peers are available, you can peer them directly with each other.

3. **Generate a separate private key** for the second node:
   ```bash
   /opt/homebrew/opt/openssl/bin/openssl genpkey -algorithm ed25519 -out private-2.pem
   ```

4. **Open a new terminal** and start the second node:
   ```bash
   ./node -config node-config-2.json
   ```

You now have two nodes running, each with its own identity, both connected to the same network.

#### Send a message and receive it

In a free terminal, run the following. The commands capture each node's public key automatically — no manual copy-pasting needed:

```bash
# Grab both public keys into shell variables
NODE_A_KEY=$(curl -s http://127.0.0.1:9002/topology | python3 -c "import sys,json; print(json.load(sys.stdin)['our_public_key'])")
NODE_B_KEY=$(curl -s http://127.0.0.1:9012/topology | python3 -c "import sys,json; print(json.load(sys.stdin)['our_public_key'])")

echo "Node A: $NODE_A_KEY"
echo "Node B: $NODE_B_KEY"

# Send a message from Node B → Node A
curl -X POST http://127.0.0.1:9012/send \
  -H "X-Destination-Peer-Id: $NODE_A_KEY" \
  -d "hello from node B"

# Receive it on Node A (may need a moment to arrive)
sleep 1
curl -v http://127.0.0.1:9002/recv
```

The response body should contain `hello from node B`, and the `X-From-Peer-Id` response header should match `$NODE_B_KEY`.

You can also send in the other direction:

```bash
# Send from Node A → Node B
curl -X POST http://127.0.0.1:9002/send \
  -H "X-Destination-Peer-Id: $NODE_B_KEY" \
  -d "hello back from node A"

# Receive on Node B
sleep 1
curl -v http://127.0.0.1:9012/recv
```

#### What this simulates

- **Terminal 1** = Person A's laptop running their node
- **Terminal 2** = Person B's laptop running their node
- **Terminal 3** = Either person's application/client talking to their own node's API

This is the exact same flow two real people on different machines would follow — the only difference is they wouldn't need different port numbers since they'd each be on their own machine.

### Example: P2P Chat

A working encrypted chat demo is included at `examples/python-client/chat.py`. It uses the send/recv endpoints to create a two-way chat between two nodes with a terminal UI.

**Dependencies:** `pip3 install requests` (only dependency beyond Python stdlib).

**To run it** (assuming both nodes are already up from the two-node setup above):

Terminal 3 — chatting as Node A:
```bash
cd examples/python-client
python3 chat.py --port 9002 --auto
```

Terminal 4 — chatting as Node B:
```bash
cd examples/python-client
python3 chat.py --port 9012 --auto
```

Type a message in one terminal, it appears in the other. Both sides are encrypted over the P2P network.

The `--auto` flag auto-detects the first connected peer. You can also specify a peer explicitly with `--peer <PUBLIC_KEY>`.

**How it works under the hood:**
- On startup, calls `GET /topology` to learn its own public key and find the peer
- Spawns a background thread that polls `GET /recv` every 200ms and prints incoming messages
- Main thread reads stdin and sends each line via `POST /send` with the peer's public key
- Messages are JSON-encoded: `{"type": "chat", "text": "..."}`

This is a good first project to understand the AXL send/recv flow. Everything more complex (MCP services, A2A agents, distributed systems) builds on the same primitives.

**Important config note:** Both nodes must use the same `tcp_port` value (default: 7000). The TCP port is used for dialing remote nodes, so if Node B has a different `tcp_port` than Node A, it will try to connect to Node A on the wrong port. Only `api_port` should differ between local nodes.

### Example: P2P Chat — Full TUI Version

A more polished TUI version of the chat is available at `examples/python-client/chat_tui.py`. It uses the [Textual](https://github.com/Textualize/textual) framework to provide a proper terminal application with:

- **Scrollable chat history** — mousewheel and Page Up/Down work naturally within a managed scroll container; unlimited history preserved in the session.
- **Fixed input bar** — always visible at the bottom, never mixed into the chat stream. Enter to send, auto-clears after submission.
- **Pinned header** — connection info (your key, peer key, port, encryption status) stays visible at all times.
- **Thread-safe message rendering** — incoming messages from the recv worker are marshalled to the UI thread via Textual's `call_from_thread`, eliminating the race conditions and write-lock hacks in the lightweight version.
- **Automatic terminal restore** — Textual manages the alternate screen buffer and terminal state; no manual ANSI cleanup needed on exit.
- **Keyboard shortcuts** — `ctrl+q` to quit (shown in footer), with proper keybinding infrastructure for future additions.

**Additional dependency:** `pip3 install textual` (pulls in `rich` as a transitive dependency). Already listed in `examples/python-client/requirements.txt`.

**To run it** (same two-node setup as above):

Terminal 3 — chatting as Node A:
```bash
cd examples/python-client
python3 chat_tui.py --port 9002 --auto
```

Terminal 4 — chatting as Node B:
```bash
cd examples/python-client
python3 chat_tui.py --port 9012 --auto
```

The lightweight `chat.py` remains available for environments where installing Textual isn't practical or when a simpler example is preferred for learning purposes.

### Example: P2P Group Chat

A group chat version is available at `examples/python-client/group_chat_tui.py`. It extends the 1-on-1 chat with multi-party messaging — the same AXL transport primitives, with group logic at the application layer.

**What it adds over the 1-on-1 chat:**

- **Group membership** — a group has an ID and a list of member public keys. Members are specified via `--members KEY1,KEY2` or auto-detected with `--auto`.
- **Fan-out send** — when you send a message, the app loops over all member keys and calls `POST /send` individually for each one. Same transport, just repeated per member.
- **Sender identity** — messages carry `from` (display name), `from_key` (public key), and `group_id` fields so receivers know who said what and which group it belongs to.
- **Per-sender coloring** — each group member gets a distinct color in the chat log for visual clarity.
- **Group filtering** — the recv loop only displays messages matching the current `group_id`, so multiple groups can coexist without interference.

**Message format on the wire:**
```json
{
    "type": "group_chat",
    "group_id": "alpha-research",
    "from": "Judson",
    "from_key": "abc123...",
    "text": "Hello everyone!"
}
```

**To run it** (same two-node setup):

Terminal 3 — Node A joins the group:
```bash
cd examples/python-client
python3 group_chat_tui.py --port 9002 --name Alice --group alpha --auto
```

Terminal 4 — Node B joins the same group:
```bash
cd examples/python-client
python3 group_chat_tui.py --port 9012 --name Bob --group alpha --auto
```

Both must use the same `--group` value to see each other's messages. The `--auto` flag discovers all connected peers and adds them as group members.

**Note on `/recv` queue:** AXL's `/recv` is a single-consumer queue — each message is dequeued by whoever reads it first. If you run multiple consumers on the same node, use the **dispatcher** (below) so every consumer sees every message.

## Dispatcher — Multi-Consumer Fan-Out

AXL's `/recv` endpoint is a destructive queue: once a message is read, it's gone. If you need multiple consumers on the same node (e.g. a chat TUI *and* an AI agent), the **dispatcher** sits between the node and all consumers.

```
AXL node /recv ──▶ Dispatcher ──▶ queue "chat"   ──▶ Group Chat TUI
                              └──▶ queue "agent"  ──▶ OpenClaw Bridge
                              └──▶ queue "foo"    ──▶ (any other consumer)
```

Run the dispatcher:
```bash
cd examples/python-client
python3 dispatcher.py --node-port 9002 --port 9100
```

Then point consumers at it:
```bash
# Group Chat TUI reads from the "chat" queue
python3 group_chat_tui.py --port 9002 --group alpha --auto --dispatcher 9100

# Agent inbox reads from the "agent" queue
python3 agent_inbox.py --port 9100 --name agent
```

Queues are created on demand when a consumer first polls `GET /recv/<name>`. Every message from the AXL node is copied to every registered queue.

## Example: OpenClaw Bridge — AI Agent in the Group Chat

The bridge script connects the dispatcher's agent inbox to a local [OpenClaw](https://docs.openclaw.ai) gateway. Incoming group messages are forwarded to OpenClaw as chat prompts; responses are fan-out sent back to the group so the agent appears as a normal participant.

### Prerequisites

- AXL node running
- Dispatcher running (sole consumer of the node's `/recv`)
- OpenClaw installed and gateway running (`openclaw onboard --install-daemon`)
- OpenClaw's Chat Completions endpoint enabled in `~/.openclaw/openclaw.json`:

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

### Full Stack (6 Terminals)

Terminal 1 — AXL Node A:
```bash
./node -config node-config.json
```

Terminal 2 — AXL Node B:
```bash
./node -config node-config-2.json
```

Terminal 3 — Dispatcher (sole consumer of Node A's `/recv`):
```bash
cd examples/python-client
python3 dispatcher.py --node-port 9002 --port 9100
```

Terminal 4 — Group Chat TUI (reads from dispatcher):
```bash
cd examples/python-client
python3 group_chat_tui.py --port 9002 --group alpha --auto --dispatcher 9100
```

Terminal 5 — OpenClaw Bridge (reads agent queue, talks to OpenClaw, sends replies to group):
```bash
cd examples/python-client
python3 openclaw_bridge.py \
    --node-port 9002 \
    --dispatcher-port 9100 \
    --gateway http://127.0.0.1:18789 \
    --group alpha \
    --name "My OpenClaw" \
    --auto
```

Terminal 6 — Human on Node B:
```bash
cd examples/python-client
python3 group_chat_tui.py --port 9012 --group alpha --auto
```

When someone in the group sends a message, the bridge picks it up from the dispatcher, sends it to OpenClaw, and posts the AI response back to the group. Both humans and the AI appear as named participants in the TUI.

### Configuration Reference

All values are configurable via CLI args or environment variables — no code edits needed:

| Flag | Env Var | Default | Purpose |
|------|---------|---------|---------|
| `--node-port` | `AXL_NODE_PORT` | `9002` | AXL node API port |
| `--dispatcher-port` | `AXL_DISPATCHER_PORT` | `9100` | Dispatcher HTTP port |
| `--dispatcher-queue` | `AXL_DISPATCHER_QUEUE` | `agent` | Queue name to poll |
| `--gateway` | `OPENCLAW_GATEWAY_URL` | `http://127.0.0.1:18789` | OpenClaw gateway URL |
| `--gateway-token` | `OPENCLAW_GATEWAY_TOKEN` | _(empty)_ | Gateway auth token |
| `--model` | `OPENCLAW_MODEL` | `openclaw/default` | Model/agent target |
| `--name` | `OPENCLAW_DISPLAY_NAME` | `OpenClaw` | Display name in group |
| `--system-prompt` | `OPENCLAW_SYSTEM_PROMPT` | _(empty)_ | System prompt prefix |
| `--group` | — | _(required)_ | Group ID |
| `--members` | — | — | Explicit peer keys |
| `--auto` | — | — | Discover peers from topology |

### Multi-User Setup

Anyone can bring their own agent into the group. The steps:

1. Install AXL, build the node binary
2. Install OpenClaw (`npm install -g openclaw@latest && openclaw onboard`)
3. Enable the Chat Completions endpoint in `~/.openclaw/openclaw.json`
4. Peer with the group (configure `Peers` in `node-config.json` to point at a bootstrap node)
5. Run: dispatcher → bridge → group chat TUI

No code edits. All configuration is via CLI flags and env vars.

## Public Release Considerations

- The current bootstrap peers in the config are Johnny's personal dev nodes and **will be shut down before public release**. The default config will need to be updated.
- **No public Gensyn-hosted nodes are planned** due to remote code execution risk. The docs should guide users to test locally with two nodes, or peer directly on LAN.
- Hardcoded bootstrap peers are a standard pattern (Bitcoin, IPFS, Ethereum all do this), but someone needs to run them. Options: community-run nodes, or Gensyn-hosted nodes with RCE mitigations.
- Let power users run their own bootstrap peers and add them to their config.
- Johnny has already put examples in the README — the docs should complement, not duplicate, those examples.
- Document clearly that bootstrap peers are routing infrastructure, not data collectors.

---

*Last updated: 2026-04-10*
