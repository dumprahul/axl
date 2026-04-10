"""
P2P Chat over AXL — Terminal UI Edition.

Full TUI for encrypted peer-to-peer chat between AXL nodes.
Scrollable history, fixed input, pinned header, mouse & keyboard support.

Usage:
    python3 chat_tui.py --port 9002 --peer <PUBLIC_KEY>
    python3 chat_tui.py --port 9002 --auto

Dependencies:
    pip install textual requests
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime

import requests
from rich.markup import escape
from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Vertical, VerticalScroll
from textual.widgets import Footer, Input, Rule, Static


# ── Widgets ────────────────────────────────────────────────────


class HeaderPanel(Static):
    """Pinned connection-info banner at the top of the screen."""

    DEFAULT_CSS = """
    HeaderPanel {
        dock: top;
        height: auto;
        padding: 1 3;
        background: $boost;
        border-bottom: thick $primary;
    }
    """

    def __init__(self, our_key: str, peer_key: str, port: int) -> None:
        content = (
            f"[bold white] AXL P2P Chat [/bold white]\n\n"
            f"  [cyan]⬡[/cyan]  [bold]You[/bold]   "
            f"[dim]{our_key[:16]}…[/dim]  [dim]port {port}[/dim]\n"
            f"  [green]⬡[/green]  [bold]Peer[/bold]  "
            f"[dim]{peer_key[:16]}…[/dim]\n\n"
            f"  [dim italic]Encrypted via Yggdrasil  ·  "
            f"scroll ↑↓  ·  ctrl+q to quit[/dim italic]"
        )
        super().__init__(content)


class ChatLog(VerticalScroll):
    """Scrollable message history. Fills all vertical space between
    the header and the input bar."""

    DEFAULT_CSS = """
    ChatLog {
        height: 1fr;
        padding: 1 3;
    }
    """


class MessageOut(Static):
    """An outgoing (self) message bubble."""

    DEFAULT_CSS = """
    MessageOut {
        margin: 0 0 1 8;
        border-left: thick $secondary;
        padding: 0 0 0 1;
    }
    """


class MessageIn(Static):
    """An incoming (peer) message bubble."""

    DEFAULT_CSS = """
    MessageIn {
        margin: 0 8 1 0;
        border-left: thick $success;
        padding: 0 0 0 1;
    }
    """


class SystemNote(Static):
    """A centered system/status message."""

    DEFAULT_CSS = """
    SystemNote {
        text-align: center;
        color: $text-muted;
        margin: 0 0 1 0;
    }
    """


# ── App ────────────────────────────────────────────────────────


class ChatApp(App):
    """AXL P2P Chat — encrypted peer-to-peer messaging in the terminal."""

    TITLE = "AXL P2P Chat"

    CSS = """
    Screen {
        background: $surface;
    }

    #chat-input {
        dock: bottom;
        margin: 0 3 1 3;
    }

    #chat-input:focus {
        border: tall $accent;
    }
    """

    BINDINGS = [
        Binding("ctrl+q", "quit", "Quit", show=True, priority=True),
        Binding("escape", "quit", "Quit", show=False),
    ]

    def __init__(
        self,
        base_url: str,
        our_key: str,
        peer_key: str,
        port: int,
    ) -> None:
        super().__init__()
        self.base_url = base_url
        self.our_key = our_key
        self.peer_key = peer_key
        self.port = port
        self._polling = True

    # ── layout ─────────────────────────────────────────────

    def compose(self) -> ComposeResult:
        yield HeaderPanel(self.our_key, self.peer_key, self.port)
        yield ChatLog()
        yield Input(placeholder="Type a message…", id="chat-input")
        yield Footer()

    def on_mount(self) -> None:
        self._sys("Connected. All traffic is end-to-end encrypted via Yggdrasil.")
        self._start_recv()
        self.query_one("#chat-input", Input).focus()

    # ── message rendering ──────────────────────────────────

    def _scroll_to_bottom(self) -> None:
        log = self.query_one(ChatLog)
        log.scroll_end(animate=False)

    def _out(self, text: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        content = (
            f"[cyan]▶[/cyan] [bold]you[/bold]  [dim]{ts}[/dim]\n"
            f"  {escape(text)}"
        )
        self.query_one(ChatLog).mount(MessageOut(content))
        self.set_timer(0.05, self._scroll_to_bottom)

    def _in(self, text: str, sender: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        content = (
            f"[green]◀[/green] [bold]{escape(sender)}[/bold]  [dim]{ts}[/dim]\n"
            f"  {escape(text)}"
        )
        self.query_one(ChatLog).mount(MessageIn(content))
        self.set_timer(0.05, self._scroll_to_bottom)

    def _sys(self, text: str) -> None:
        content = f"[dim italic]— {escape(text)} —[/dim italic]"
        self.query_one(ChatLog).mount(SystemNote(content))
        self.set_timer(0.05, self._scroll_to_bottom)

    # ── send path ──────────────────────────────────────────

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        text = event.value.strip()
        if not text:
            return
        event.input.value = ""
        self._out(text)
        self._do_send(text)

    @work(thread=True)
    def _do_send(self, text: str) -> None:
        payload = json.dumps({"type": "chat", "text": text}).encode()
        headers = {
            "X-Destination-Peer-Id": self.peer_key,
            "Content-Type": "application/octet-stream",
        }
        try:
            resp = requests.post(
                f"{self.base_url}/send",
                data=payload,
                headers=headers,
                timeout=10,
            )
            if resp.status_code != 200:
                self.call_from_thread(self._sys, "⚡ Send failed (non-200)")
        except Exception:
            self.call_from_thread(self._sys, "⚡ Could not reach node")

    # ── recv path ──────────────────────────────────────────

    @work(thread=True, group="recv")
    def _start_recv(self) -> None:
        while self._polling:
            try:
                resp = requests.get(f"{self.base_url}/recv", timeout=5)
                if resp.status_code == 200:
                    peer_id = resp.headers.get("X-From-Peer-Id", "unknown")
                    short = peer_id[:6]
                    try:
                        msg = json.loads(resp.content)
                        text = (
                            msg["text"]
                            if msg.get("type") == "chat"
                            else "(non-chat message)"
                        )
                    except (json.JSONDecodeError, KeyError):
                        text = resp.content.decode(errors="replace")
                    self.call_from_thread(self._in, text, short)
            except requests.exceptions.Timeout:
                pass
            except Exception:
                pass
            time.sleep(0.2)

    # ── lifecycle ──────────────────────────────────────────

    def action_quit(self) -> None:
        self._polling = False
        self.exit()


# ── CLI bootstrap ──────────────────────────────────────────────


def _topology(base_url: str):
    try:
        r = requests.get(f"{base_url}/topology", timeout=5)
        return r.json() if r.status_code == 200 else None
    except Exception as e:
        print(f"Topology error: {e}")
        return None


def _first_peer(topo: dict):
    for p in topo.get("peers", []):
        if p.get("up") and p.get("public_key"):
            return p["public_key"]
    return None


def main() -> None:
    ap = argparse.ArgumentParser(description="P2P Chat over AXL (TUI)")
    ap.add_argument("--port", type=int, default=9002, help="AXL API port")
    ap.add_argument("--peer", type=str, help="Peer public key (64-char hex)")
    ap.add_argument("--auto", action="store_true", help="Auto-detect peer")
    args = ap.parse_args()

    base = f"http://127.0.0.1:{args.port}"
    topo = _topology(base)
    if not topo:
        print(f"Cannot reach node at {base}. Is it running?")
        sys.exit(1)

    our = topo["our_public_key"]
    peer = args.peer

    if args.auto:
        peer = _first_peer(topo)
        if not peer:
            print("No connected peers found.")
            sys.exit(1)

    if not peer:
        print("Provide --peer <KEY> or use --auto.")
        sys.exit(1)

    ChatApp(base, our, peer, args.port).run()


if __name__ == "__main__":
    main()
