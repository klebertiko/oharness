"""
EXPERIMENTAL — Laya decision-node loopback process (ADR-0005, spike).

Why a separate process instead of a route on the main FastAPI sidecar
(`backend/main.py`): Laya's local HF-cached model weights are not a provider
credential — they must never be mixed into `OH_SECRETS`'s surface — and the
local GPU/CPU is shared, so at most one `Router()` may ever be loaded at a
time. A route on the sidecar would make that true only by accident; a
separate process makes it true by construction: the sidecar's own lifecycle
(reload, multiple workers, crash/restart) can never spin up a second
`Router()` alongside this one.

Non-authoritative by construction, same as `scripts/laya_issue_shadow.py`
(the CI counterpart this mirrors): every response is evidence for a
`decision` node's `node_done` in `backend/engine.py`, never a value anything
in that engine's routing/gate/HITL logic reads. This process does not know
or care what graph called it, has no notion of "pass"/"fail", and never
mutates anything outside its own stdout.

Usage (manual, not started by the sidecar or by any test):

    python -m laya_loopback.server

Env vars:
    LAYA_LOOPBACK_PORT  — default 8761. Must match the port
                          `backend/engine.py`'s "decision" node branch reads.
    LAYA_LOOPBACK_LOCK  — path to the lock file (default: a fixed path under
                          the OS temp dir, so every instance on this machine
                          contends for the same lock regardless of cwd).

Protocol: POST /predict with `{"state": {...}, "questions": {...}}` (same
shape `scripts/laya_issue_shadow.py` already sends `Router.predict`), 200
`{"schema_version", "model_result", "latency_ms"}` on success, >=400
`{"error": "..."}` on failure — the loopback never fabricates a result for a
predict() it couldn't complete. GET /health is a plain liveness probe that
doesn't touch the model.

Not production-grade: single-threaded (`http.server.HTTPServer`, not
`ThreadingHTTPServer`) is a deliberate choice, not an oversight — it
serializes `Router.predict` calls within this one process without needing a
second lock, since only one request is ever handled at a time. Good enough
for a time-boxed spike proving the mechanism; a formal story would likely
want a supervised/restartable process instead of a bare `python -m` script.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from filelock import FileLock, Timeout

DEFAULT_PORT = 8761
_DEFAULT_LOCK_PATH = Path(tempfile.gettempdir()) / "oharness-laya-loopback.lock"
_SCHEMA_VERSION = "oharness-decision-node-v1"


class _Handler(BaseHTTPRequestHandler):
    # Set once in main() before serve_forever() — a single Router shared by
    # every request this process ever handles.
    router: "object | None" = None

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 — http.server's required name
        if self.path == "/health":
            self._send_json(200, {"status": "ok"})
            return
        self._send_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802 — http.server's required name
        if self.path != "/predict":
            self._send_json(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            self._send_json(400, {"error": f"invalid JSON body: {exc}"})
            return

        state = body.get("state") or {}
        questions = body.get("questions") or {}
        if self.router is None:
            # Can't happen outside a test that pokes the handler directly
            # without going through main() — defensive, not reachable from
            # the normal startup path.
            self._send_json(503, {"error": "Router not loaded"})
            return

        started = time.perf_counter()
        try:
            result = self.router.predict(state, questions)  # type: ignore[union-attr]
        except Exception as exc:  # honest failure — never a fabricated result
            self._send_json(500, {"error": f"laya predict failed: {exc}"})
            return
        latency_ms = round((time.perf_counter() - started) * 1000, 2)
        self._send_json(
            200,
            {
                "schema_version": _SCHEMA_VERSION,
                "model_result": result,
                "latency_ms": latency_ms,
            },
        )

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002
        # Quiet by default (no per-request access log); real failures still
        # reach the client as a JSON error body above.
        pass


def main() -> None:
    port = int(os.environ.get("LAYA_LOOPBACK_PORT", str(DEFAULT_PORT)))
    lock_path = Path(os.environ.get("LAYA_LOOPBACK_LOCK", str(_DEFAULT_LOCK_PATH)))

    lock = FileLock(str(lock_path))
    try:
        lock.acquire(timeout=0)
    except Timeout:
        print(
            f"laya_loopback: another instance already holds {lock_path} -- "
            "refusing to start a second Router() against the shared local "
            "GPU/CPU. Stop that instance first if you meant to restart it.",
            file=sys.stderr,
        )
        raise SystemExit(1)

    try:
        try:
            from laya import Router
        except ImportError as exc:
            print(
                f"laya_loopback: `laya` package not installed ({exc}). "
                "See backend/laya_loopback/requirements.txt.",
                file=sys.stderr,
            )
            raise SystemExit(1)

        _Handler.router = Router(max_loaded=1)
        server = HTTPServer(("127.0.0.1", port), _Handler)
        print(
            f"laya_loopback: listening on http://127.0.0.1:{port} "
            "(advisory-shadow only -- see docs/adr/0005-laya-decision-node.md)"
        )
        try:
            server.serve_forever()
        finally:
            server.server_close()
    finally:
        lock.release()


if __name__ == "__main__":
    main()
