"""
P2P Chat over AXL.

A simple two-way encrypted chat between two AXL nodes using /send and /recv.
Run one instance per node, each pointing at the other's public key.

Usage:
    python3 chat.py --port 9002 --peer <OTHER_NODE_PUBLIC_KEY>
    python3 chat.py --port 9002 --auto   # auto-detect first connected peer
"""

import argparse
import json
import readline
import shutil
import sys
import threading
import time
from datetime import datetime

import requests

POLL_INTERVAL = 0.2

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
CYAN = "\033[36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
WHITE = "\033[97m"
BG_DARK = "\033[48;5;236m"

RL_RESET = "\x01\033[0m\x02"
RL_CYAN = "\x01\033[36m\x02"
RL_DIM = "\x01\033[2m\x02"

PROMPT = f"  {RL_CYAN}▶{RL_RESET} {RL_DIM}you:{RL_RESET} "

# Lock so recv thread and main thread don't write to stdout simultaneously
write_lock = threading.Lock()


def term_width():
    return shutil.get_terminal_size((80, 24)).columns


def clear_screen():
    sys.stdout.write("\033[2J\033[H")
    sys.stdout.flush()


def draw_header(our_key, peer_key, port):
    w = term_width()
    lines = [
        f"{BOLD}{BG_DARK}{WHITE}" + " AXL P2P Chat ".center(w) + RESET,
        f"{DIM}{'─' * w}{RESET}",
        f"  {CYAN}⬡{RESET} {BOLD}You{RESET}   {DIM}{our_key[:16]}...{RESET}  {DIM}(port {port}){RESET}",
        f"  {GREEN}⬡{RESET} {BOLD}Peer{RESET}  {DIM}{peer_key[:16]}...{RESET}",
        f"{DIM}{'─' * w}{RESET}",
        f"  {DIM}End-to-end encrypted via Yggdrasil  •  Ctrl+C to quit{RESET}",
        f"{DIM}{'─' * w}{RESET}",
        "",
    ]
    sys.stdout.write("\n".join(lines) + "\n")
    sys.stdout.flush()


def ts():
    return datetime.now().strftime("%H:%M")


def get_topology(base_url):
    try:
        resp = requests.get(f"{base_url}/topology", timeout=5)
        if resp.status_code == 200:
            return resp.json()
    except Exception as e:
        sys.stderr.write(f"Failed to fetch topology: {e}\n")
    return None


def send_message(base_url, dest_key, text):
    payload = json.dumps({"type": "chat", "text": text}).encode()
    headers = {
        "X-Destination-Peer-Id": dest_key,
        "Content-Type": "application/octet-stream",
    }
    try:
        resp = requests.post(f"{base_url}/send", data=payload, headers=headers, timeout=10)
        return resp.status_code == 200
    except Exception:
        return False


def recv_loop(base_url, stop_event):
    while not stop_event.is_set():
        try:
            resp = requests.get(f"{base_url}/recv", timeout=5)
            if resp.status_code == 200:
                from_peer = resp.headers.get("X-From-Peer-Id", "unknown")
                short_id = from_peer[:6]
                try:
                    msg = json.loads(resp.content)
                    text = msg["text"] if msg.get("type") == "chat" else "(non-chat message)"
                except (json.JSONDecodeError, KeyError):
                    text = resp.content.decode(errors="replace")
                with write_lock:
                    sys.stdout.write(f"\r\033[K")
                    sys.stdout.write(f"  {GREEN}◀ {BOLD}{short_id}{RESET} {DIM}{ts()}{RESET}\n")
                    sys.stdout.write(f"  {WHITE}{text}{RESET}\n\n")
                    sys.stdout.write(PROMPT)
                    sys.stdout.flush()
        except requests.exceptions.Timeout:
            pass
        except Exception:
            pass
        time.sleep(POLL_INTERVAL)


def find_first_peer(topo):
    for peer in topo.get("peers", []):
        if peer.get("up") and peer.get("public_key"):
            return peer["public_key"]
    return None


def main():
    parser = argparse.ArgumentParser(description="P2P Chat over AXL")
    parser.add_argument("--port", type=int, default=9002, help="AXL node API port (default: 9002)")
    parser.add_argument("--peer", type=str, default=None, help="Target peer's public key (64-char hex)")
    parser.add_argument("--auto", action="store_true", help="Auto-detect first connected peer as target")
    args = parser.parse_args()

    base_url = f"http://127.0.0.1:{args.port}"

    topo = get_topology(base_url)
    if not topo:
        print(f"Cannot reach node at {base_url}. Is it running?")
        sys.exit(1)

    our_key = topo["our_public_key"]

    peer_key = args.peer
    if args.auto:
        peer_key = find_first_peer(topo)
        if not peer_key:
            print("No connected peers found. Cannot auto-detect target.")
            sys.exit(1)

    if not peer_key:
        print("Provide --peer <PUBLIC_KEY> or use --auto to detect.")
        sys.exit(1)

    try:
        clear_screen()
        draw_header(our_key, peer_key, args.port)

        stop_event = threading.Event()
        listener = threading.Thread(target=recv_loop, args=(base_url, stop_event), daemon=True)
        listener.start()

        while True:
            try:
                line = input(PROMPT)
            except EOFError:
                break
            if not line.strip():
                continue
            with write_lock:
                sys.stdout.write(f"\033[A\r\033[K")
                if send_message(base_url, peer_key, line):
                    sys.stdout.write(f"  {CYAN}▶ {BOLD}you{RESET} {DIM}{ts()}{RESET}\n")
                    sys.stdout.write(f"  {WHITE}{line}{RESET}\n\n")
                else:
                    sys.stdout.write(f"  {DIM}{YELLOW}⚡ message failed to send{RESET}\n")
                sys.stdout.flush()

    except KeyboardInterrupt:
        stop_event.set()
        sys.stdout.write(f"\n  {DIM}Chat ended.{RESET}\n\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
