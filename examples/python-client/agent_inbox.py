"""
Agent inbox — test consumer for the AXL dispatcher.

Polls the dispatcher's "agent" queue and prints every message it receives.
Used to verify that the dispatcher fans out correctly: run this alongside
the group chat TUI, and both should see the same messages.

Usage:
    python3 agent_inbox.py --port 9100

Dependencies:
    pip install requests
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import requests

POLL_INTERVAL = 0.3

RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
GREEN = "\033[32m"
CYAN = "\033[36m"
YELLOW = "\033[33m"


def main() -> None:
    ap = argparse.ArgumentParser(description="AXL Dispatcher — Agent Inbox")
    ap.add_argument("--port", type=int, default=9100, help="Dispatcher port")
    ap.add_argument("--name", type=str, default="agent", help="Consumer queue name (default: agent)")
    args = ap.parse_args()

    base = f"http://127.0.0.1:{args.port}"
    recv_url = f"{base}/recv/{args.name}"

    try:
        r = requests.get(f"{base}/health", timeout=3)
        if r.status_code != 200:
            raise Exception("non-200")
    except Exception:
        print(f"Cannot reach dispatcher at {base}. Is it running?")
        sys.exit(1)

    print(f"{BOLD}Agent Inbox{RESET}")
    print(f"{DIM}Polling: {recv_url}{RESET}")
    print(f"{DIM}Ctrl+C to stop{RESET}")
    print()

    count = 0
    try:
        while True:
            try:
                resp = requests.get(recv_url, timeout=5)
                if resp.status_code == 200:
                    msg = resp.json()
                    count += 1

                    msg_type = msg.get("type", "?")
                    group = msg.get("group_id", "?")
                    sender = msg.get("from", msg.get("_from_peer", "unknown")[:8])
                    text = msg.get("text", json.dumps(msg))

                    print(
                        f"  {GREEN}#{count}{RESET} "
                        f"{DIM}[{msg_type}:{group}]{RESET} "
                        f"{CYAN}{BOLD}{sender}{RESET}: "
                        f"{text}"
                    )
            except requests.exceptions.Timeout:
                pass
            except requests.exceptions.ConnectionError:
                print(f"  {YELLOW}⚡ dispatcher unreachable, retrying…{RESET}")
                time.sleep(2)
                continue
            except Exception as e:
                print(f"  {YELLOW}⚡ {e}{RESET}")
            time.sleep(POLL_INTERVAL)
    except KeyboardInterrupt:
        print(f"\n{DIM}Agent inbox stopped. {count} messages received.{RESET}")


if __name__ == "__main__":
    main()
