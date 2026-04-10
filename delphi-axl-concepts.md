# Delphi x AXL: Two Concepts

There are two distinct ways AXL and Delphi fit together. They aren't competing ideas — they're different layers that could coexist.

---

## Concept 1: AXL over Delphi

**What it is:** AXL as the communication layer for a distributed trading intelligence network. Delphi is the application. AXL is the pipe.

### The idea

Agents on different nodes use the Delphi SDK / Agentic Trading Toolkit to research active markets. Each agent has a specialty — sentiment analysis, on-chain tracking, news monitoring, cross-market analysis. They share signals with each other over AXL's encrypted P2P mesh.

Those signals feed into a decision-making agent (Claude or another LLM with the trading skills from the Toolkit) that has autonomy to act: increasing or decreasing positions in specific markets based on the aggregated intelligence.

**Or, even more simply:** agents pipe research and sentiment data to the user. No autonomous trading — just a distributed research feed delivered to a human who makes their own calls. This already exists in agentic form through the Toolkit, but running it over a decentralized P2P network of specialized agents is a step up from a single agent on one machine.

### How it works

```
Node A (sentiment agent)  ──┐
                             │
Node B (on-chain agent)   ──┼──► Your Node (aggregator / trading agent)
                             │       │
Node C (news agent)       ──┘       ▼
                              Decision: buy/sell/hold
                              Executed locally via Delphi SDK
                              (your keys, your wallet, your machine)
```

- Each node exposes an MCP research service over AXL
- Your aggregator agent queries them, synthesizes signals, decides what to do
- Trade execution stays strictly local — no keys or wallet access crosses the network
- Worst case if the network is compromised: someone learns what markets you asked about, not your positions or credentials

### What it demonstrates

- AXL carrying real, useful data between agents
- Composable agent specialization — each participant brings one skill, everyone benefits
- Privacy-preserving: strategy stays local, intelligence is shared
- Both Gensyn products working together (AXL as transport, Delphi as application)

### Complexity

Moderate. You need the Delphi SDK, a few MCP research services, and a coordinator agent. Could be built in a hackathon.

---

## Concept 2: AXL in Delphi

**What it is:** AXL nodes as core infrastructure inside Delphi itself. Not just agents using Delphi — the network IS part of how Delphi works. Specifically: decentralized, autonomous market settlement.

### The idea

When a Delphi prediction market needs to be settled (e.g., "Did BTC close above $90k on April 15?"), instead of a centralized oracle or a single authority determining the outcome:

1. **A set of nodes are randomly selected** from the Gensyn network to act as **evidence gatherers**. These agents independently research the answer — checking price feeds, scraping data sources, verifying on-chain records.

2. **Another set of nodes are randomly selected** to act as **settlement nodes**. They receive the evidence, evaluate it, and vote on the outcome.

3. **The market resolves by consensus** — majority vote or an agreed-upon threshold among the settlement nodes.

4. **Participating nodes are paid** for their work — a slice of that market's trading fees, transaction fees, or a dedicated settlement reward.

### How it works

```
Market "BTC > $90k on April 15?" needs settlement
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
 Node X      Node Y      Node Z        ← randomly selected evidence gatherers
 (checks     (checks     (checks          (don't know each other, can't collude
  Binance)    CoinGecko)   on-chain)       because selection is random)
    │           │           │
    └───────────┼───────────┘
                ▼
        Evidence submitted
                │
    ┌───────────┼───────────┐
    ▼           ▼           ▼
 Node P      Node Q      Node R        ← randomly selected settlement nodes
 (reviews    (reviews    (reviews
  evidence)   evidence)   evidence)
    │           │           │
    └───────────┼───────────┘
                ▼
         Consensus: YES
         Market resolves
         Winning shares pay out
         Nodes X,Y,Z,P,Q,R get paid
```

### Why random selection is the key property

- You don't know which nodes will be picked for any given market until settlement time
- To game the outcome, you'd need to control a majority of ALL nodes in the network, not just a few
- The more nodes in the network, the harder this gets
- This is the same principle behind proof-of-stake validator selection — the randomness is the security

### Why REE matters here

The trust question: what if a node operator gives their agent biased instructions? "Always vote YES on markets where wallet 0xABC holds positions."

**Without REE:** You're trusting that node operators run honest agents. Some might not. The random selection helps (you'd need to corrupt many nodes), but it's not airtight.

**With REE (Remote Execution Environment):** The evidence-gathering and settlement code runs inside a secure enclave on the node. Even the person operating the node cannot tamper with what the code does. The results are verifiable — other participants trust the output because the execution environment is tamper-proof, not because they trust the operator.

REE isn't a nice-to-have in this model. It's what makes the trust guarantee real. Nodes could use hosted REE so they don't need local hardware support for it.

### The economic flywheel

```
Traders pay fees to trade on Delphi markets
        │
        ▼
Fees fund evidence-gathering & settlement rewards
        │
        ▼
Node operators earn by running nodes on the Gensyn network
(randomly selected for research / settlement roles)
        │
        ▼
More nodes → harder to game → more trustworthy outcomes
        │
        ▼
More trust → more traders → more volume → more fees
        │
        ▼
More fees → more rewards → more nodes join
        └──────────────────────────────────┘
```

### What this solves

| Problem | How this addresses it |
|---------|----------------------|
| Who settles markets? | Randomly selected nodes, not a single authority |
| How do you prevent gaming? | Random selection + REE = can't pre-corrupt and can't tamper |
| Why would anyone run a node? | You get paid for participating in settlement |
| Does the system get more trustworthy over time? | Yes — more nodes = harder to corrupt a majority |
| Why does the "Gensyn Network" exist? | Your node runs models that participate in market settlement and earns from it |

### What it demonstrates

- AXL as infrastructure, not just a communication tool
- A concrete economic reason to run Gensyn nodes (incentive-driven participation)
- Distributed, decentralized research + consensus machine
- Inherently trustworthy from a user perspective — trust comes from the system design, not from trusting any individual party
- REE as a natural extension that makes the trust model cryptographically sound
- Network effects: the system gets more secure as it grows

### Complexity

High. This is a protocol-level integration, not a hackathon project. It requires:
- A node selection/randomization mechanism
- A consensus protocol for settlement
- Integration with Delphi's market lifecycle (when does settlement trigger, how are results submitted on-chain)
- REE integration for tamper-proof execution
- An economic model for fee distribution

---

## How They Relate

These aren't competing concepts. They're layers:

**Concept 1 (AXL over Delphi)** is something you can build today. It demonstrates the value of agents sharing intelligence over a P2P network. It's a compelling hackathon demo and a useful product on its own.

**Concept 2 (AXL in Delphi)** is the longer-term vision. It makes the Gensyn network a structural part of how prediction markets work. It requires more engineering but creates a much stronger product story:

- **Delphi** = the market
- **AXL** = the network
- **REE** = the trust layer
- **Node operators** = paid participants who make the system work

Concept 1 can exist without Concept 2. Concept 2 would naturally include Concept 1 (settlement nodes could also share research intelligence). Building Concept 1 first gives you a working demo, a developer community, and real-world feedback — all of which inform how you'd design Concept 2.

---

*Last updated: 2026-04-08*
