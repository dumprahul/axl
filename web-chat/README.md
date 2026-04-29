# AXL Web Chat (two local nodes)

This is a tiny local web UI to send messages between two running AXL nodes.

It uses a local Node.js server as a proxy to avoid browser CORS issues, and then:
- sends via `POST /send` with `X-Destination-Peer-Id`
- receives via polling `GET /recv`

## Prereqs

- Node A running on `http://127.0.0.1:9002`
- Node B running on `http://127.0.0.1:9012`

## Run

```bash
cd web-chat
npm install
npm start
```

Open `http://127.0.0.1:3000`.

## Custom ports

If your nodes aren’t on 9002/9012:

```bash
AXL_NODE_A_URL=http://127.0.0.1:9002 \
AXL_NODE_B_URL=http://127.0.0.1:9012 \
PORT=3000 \
npm start
```

