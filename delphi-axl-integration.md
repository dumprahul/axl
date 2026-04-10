# Delphi x AXL: Distributed Agent Intelligence for Prediction Markets

## The Idea

A peer-to-peer network of Delphi trading agents, each with a different research specialty, sharing market intelligence over AXL's encrypted mesh. Every agent contributes a unique signal. Every agent makes its own trading decisions locally. No central server sees your strategy, your queries, or your positions.

---

## Why This Makes Sense

Prediction markets are fundamentally about **information aggregation** — the market price reflects the crowd's collective knowledge. But right now, each Delphi agent operates in isolation. It only knows what its operator sets up: the SDK's market data, maybe a news API, maybe some on-chain queries. It has no way to tap into what other agents are seeing.

AXL solves this by letting agents talk to each other directly. Each agent exposes a research capability as an MCP service on its node. Other agents query it, get a signal, and fold that into their own decision-making. The result is a distributed research network where:

- Each participant brings one specialty and benefits from everyone else's
- Intelligence is shared, but strategy stays private
- No central server aggregates or controls the information flow
- The encrypted P2P layer means even the network infrastructure can't read the signals

This is aligned with the ethos of prediction markets themselves — decentralized, permissionless information discovery.

---

## The Security Boundary

This only works if the boundary between "what's shared" and "what's local" is airtight.

### What travels over AXL (safe)

- Market analysis and research summaries
- Signals: "I think market X resolves YES, here's supporting data"
- On-chain data summaries (whale movements, liquidity, related positions)
- Sentiment scores from social media or news analysis
- Price alerts and cross-market arbitrage opportunities
- Resolution criteria monitoring ("the event this market tracks just happened")

### What NEVER travels over AXL (strict)

- Private keys or wallet credentials
- Signing authority or transaction payloads
- Token approvals
- "Execute this trade on my behalf" requests
- Portfolio details or position sizes (unless you explicitly choose to share)

**No node ever has write access to another node's wallet.** The AXL layer is strictly an information network. Agents share what they *know*, not what they *control*. Every trade execution happens locally through the Delphi SDK on the machine that owns the keys.

**Worst-case scenario if compromised:** an attacker who breaks the encryption learns what research questions you asked and what analysis you received. They learn your *interests*, not your *positions or keys*. That's a meaningful difference.

> **Note on encryption claims:** The "encrypted end-to-end" property comes from Yggdrasil's protocol design, which encrypts payloads between source and destination nodes independent of hop-by-hop TLS. This means intermediate routing nodes in the mesh cannot read message content. However, before using this as a security selling point in any public-facing materials, this should be **confirmed with the AXL/Gensyn team** — specifically that Yggdrasil's E2E encryption is active and unmodified in AXL, and that no application-layer metadata leaks outside the encrypted envelope. See the "Encryption: Two Layers" section in `for_documentation.md` for the full action item.

---

## How It Would Work

### The network

Each participant runs:
1. An **AXL node** — handles P2P networking, encryption, routing
2. A **Delphi agent** — the agentic trading toolkit with SDK access
3. One or more **MCP research services** — their specialty, exposed to the network

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│  Your Machine               │     │  Someone Else's Machine     │
│                             │     │                             │
│  ┌───────────────────────┐  │     │  ┌───────────────────────┐  │
│  │  Delphi Agent         │  │     │  │  Delphi Agent         │  │
│  │  (decision-making,    │  │     │  │  (decision-making,    │  │
│  │   trade execution)    │  │     │  │   trade execution)    │  │
│  └──────────┬────────────┘  │     │  └──────────┬────────────┘  │
│             │ localhost      │     │             │ localhost      │
│  ┌──────────▼────────────┐  │     │  ┌──────────▼────────────┐  │
│  │  AXL Node             │◄─┼─────┼─►│  AXL Node             │  │
│  │  (port 9002)          │  │     │  │  (port 9002)          │  │
│  └──────────┬────────────┘  │     │  └──────────┬────────────┘  │
│             │ localhost      │     │             │ localhost      │
│  ┌──────────▼────────────┐  │     │  ┌──────────▼────────────┐  │
│  │  MCP Research Service │  │     │  │  MCP Research Service │  │
│  │  (your specialty)     │  │     │  │  (their specialty)    │  │
│  └───────────────────────┘  │     │  └───────────────────────┘  │
└─────────────────────────────┘     └─────────────────────────────┘
          encrypted P2P link
```

### Example specialties

| Node | Specialty | MCP Service | What it returns |
|------|-----------|-------------|-----------------|
| A | News & events | `resolution_monitor` | "The event for market 0x3f just occurred — Reuters confirmed at 2:31pm" |
| B | Social sentiment | `sentiment` | `{"market": "0x3f", "signal": "bullish", "confidence": 0.82, "sources": 1400}` |
| C | On-chain analysis | `onchain_intel` | "3 wallets with >$50k positions just bought YES on market 0x3f in the last hour" |
| D | Cross-market arbitrage | `arb_scanner` | "Market 0x3f and 0xa1 are correlated but priced 12% apart — possible arb" |

### The flow

**Scenario:** You want to decide whether to buy YES on a specific Delphi market.

```
Your Delphi Agent
    │
    ├── POST /mcp/{nodeA}/resolution_monitor
    │   body: {"method": "check", "params": {"market": "0x3f"}}
    │   ← "No resolution event detected yet. Next check: earnings report Thu 4pm ET"
    │
    ├── POST /mcp/{nodeB}/sentiment
    │   body: {"method": "analyze", "params": {"market": "0x3f"}}
    │   ← {"signal": "bullish", "confidence": 0.82, "tweet_volume": "3x average"}
    │
    ├── POST /mcp/{nodeC}/onchain_intel
    │   body: {"method": "activity", "params": {"market": "0x3f"}}
    │   ← {"large_buys_24h": 3, "net_flow": "+$142k YES", "whale_sentiment": "bullish"}
    │
    │  (Your agent synthesizes all three signals locally)
    │  Decision: BUY — sentiment is bullish, smart money is buying, resolution event approaching
    │
    └── Execute locally via Delphi SDK
        delphi.buy({market: "0x3f", outcome: "YES", shares: 10})
        (uses YOUR keys, YOUR wallet, on YOUR machine)
```

No other node knows you decided to buy. No other node knows your position size. They only know you asked about market 0x3f — and even that is encrypted end-to-end, invisible to routing nodes.

---

## How You'd Build It

### Step 1: Define the MCP service interface

Each research specialty is a JSON-RPC service. The interface is simple — a method name and parameters in, structured data out.

Example for a sentiment analysis service:

```python
# sentiment_service.py — runs on your machine, exposed via MCP

from flask import Flask, request, jsonify
import your_sentiment_library  # whatever you use

app = Flask(__name__)

@app.route("/route", methods=["POST"])
def handle():
    req = request.json
    method = req.get("method")

    if method == "analyze":
        market_id = req["params"]["market"]
        # Run your sentiment analysis (scrape Twitter, Reddit, news, etc.)
        result = your_sentiment_library.analyze(market_id)
        return jsonify({"result": result})

    return jsonify({"error": "unknown method"}), 400

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=9003)
```

### Step 2: Configure your node to route MCP to your service

In `node-config.json`:
```json
{
  "PrivateKeyPath": "private.pem",
  "Peers": ["tls://34.46.48.224:9001", "tls://136.111.135.206:9001"],
  "router_addr": "http://127.0.0.1",
  "router_port": 9003
}
```

Now when any node on the network calls `POST /mcp/{your_key}/sentiment`, AXL routes the request to your local Flask service.

### Step 3: Build the coordinator agent

This is the Delphi agent on your node that gathers intelligence from the network and decides what to trade. It could be a Python script, a LangChain agent, or anything that can make HTTP calls.

```python
# coordinator.py — your trading agent

import requests
import json

AXL_API = "http://127.0.0.1:9002"

# Public keys of agents you know about (exchanged out-of-band)
AGENTS = {
    "sentiment": "37227e7e39d6c21fa0fe1dc6803d478ff627c2e21951c155deae5438c2857de7",
    "onchain": "1ee862344fb283395143ac9775150d2e5936efd6e78ed0db83e3f290d3d539ef",
    "resolution": "34ddb6c97d8ba0c849d332b220ba23018f67836fee160aa0cfeeb3c664722e92",
}

def query_agent(agent_name, service, method, params):
    """Call a remote agent's MCP service via AXL."""
    peer_key = AGENTS[agent_name]
    url = f"{AXL_API}/mcp/{peer_key}/{service}"
    payload = {"method": method, "params": params}
    resp = requests.post(url, json=payload, timeout=30)
    return resp.json()

def evaluate_market(market_id):
    """Gather intelligence from the network and make a decision."""

    sentiment = query_agent("sentiment", "sentiment", "analyze", {"market": market_id})
    onchain = query_agent("onchain", "onchain_intel", "activity", {"market": market_id})
    resolution = query_agent("resolution", "resolution_monitor", "check", {"market": market_id})

    print(f"Sentiment: {sentiment}")
    print(f"On-chain:  {onchain}")
    print(f"Resolution: {resolution}")

    # Your decision logic here — this is where your edge lives
    # This part never leaves your machine
    if sentiment["result"]["confidence"] > 0.7 and onchain["result"]["net_flow"].startswith("+"):
        print("Signal: BUY YES")
        # execute_trade_locally(market_id, "YES", shares=10)
    else:
        print("Signal: HOLD")

evaluate_market("0x3f")
```

### Step 4: Share your public key and specialty

Tell other participants: "I'm `37227e...` and I run a `sentiment` MCP service. Query me at `/mcp/{my_key}/sentiment`."

They do the same. Everyone adds each other's keys and service names to their coordinator. The network grows organically.

---

## What Makes This a Good Demo

1. **It's real.** Delphi markets exist. The SDK works. AXL works. This isn't theoretical — you could run this today across two laptops.

2. **The security model matters.** Prediction market trading strategies are genuinely sensitive. A system where intelligence is shared but strategy stays private is not a gimmick — it's a real requirement.

3. **It's composable.** One person builds sentiment analysis. Another builds on-chain tracking. A third builds news monitoring. Each is useful alone, but together they create something none could build individually. That's the P2P value proposition.

4. **It's a Gensyn showcase.** Both products (AXL and Delphi) are Gensyn-built. Showing them working together demonstrates a coherent platform story: Delphi for prediction markets, AXL for the agent communication layer.

5. **It scales naturally.** Start with 2 agents sharing signals. Add a third, a fourth. Each new agent on the network increases the value for everyone. That's a network effect demo.

---

## Open Questions

- **Incentives:** Should agents charge for their signals? Could you price intelligence in Delphi tokens? A "signal marketplace" where good analysts earn from their research.
- **Trust:** How do you know a signal is accurate? A node could feed you bad data to manipulate your trades. Reputation tracking (on-chain?) could help.
- **Latency:** MCP calls have a 30-second timeout. For fast-moving markets, is that enough? For prediction markets with longer time horizons, probably yes.
- **Discovery:** How do agents find each other's specialties? A registry service or announcement protocol would help bootstrap the network.

---

*Last updated: 2026-04-08*
