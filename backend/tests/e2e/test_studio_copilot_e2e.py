"""BDD over real HTTP: Studio Copilot and field assist against a live-protocol model fixture.

OH_ISOLATED_E2E=1 enables this suite. Only the external model is a local fixture
(an OpenAI-compatible server); the resolver, budget gate, usage ledger, routers,
authentication and database are real.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from studio_copilot import catalog, ops

pytestmark = pytest.mark.skipif(
    os.environ.get("OH_ISOLATED_E2E") != "1", reason="requires isolated E2E checkout"
)

EXAMPLES = json.loads((Path(catalog.__file__).resolve().parent / "contract_examples.json").read_text(encoding="utf-8"))
BASE = EXAMPLES["baseGraph"]
GOOD_OPS = next(c["ops"] for c in EXAMPLES["cases"] if c["name"] == "add_and_wire")
FIXTURE_TOKENS = 42


@pytest.fixture()
def sidecar(tmp_path):
    assert (Path(__file__).resolve().parents[3] / '.git').is_file(), 'E2E requires a linked isolated worktree'
    # Refuse an occupied integration port; never stop somebody else's server.
    with socket.socket() as check:
        check.bind(("127.0.0.1", 8001))
    env = {**os.environ, "DATABASE_URL": f"sqlite+aiosqlite:///{(tmp_path / 'e2e.db').as_posix()}",
           "OH_SECRETS": "memory", "OH_SIDECAR_TOKEN": "isolated-e2e-token"}
    process = None
    log = (tmp_path / "server.log").open("w", encoding="utf-8")
    client = httpx.Client(base_url="http://127.0.0.1:8001", timeout=20,
                         headers={"Authorization": "Bearer isolated-e2e-token"})

    def stop():
        nonlocal process
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            process = None

    def start():
        nonlocal process
        # Fixed argv, trusted interpreter, shell=False (default), and an isolated
        # worktree: no external value can become a command or argument here.
        process = subprocess.Popen(  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit
            [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8001"],
            cwd=Path(__file__).resolve().parents[2], env=env, stdout=log, stderr=log,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            assert process.poll() is None, "isolated sidecar exited; inspect server.log"
            try:
                if client.get("/health").status_code == 200:
                    return
            except httpx.TransportError:
                pass
            time.sleep(0.05)
        pytest.fail("isolated sidecar did not become healthy")

    try:
        start()
        yield client
    finally:
        stop()
        client.close()
        log.close()


@pytest.fixture()
def model_server():
    seen: list[dict] = []
    mode = {"reply": None}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            assert self.path == "/v1/chat/completions"
            seen.append(payload)
            system = payload["messages"][0]["content"]
            if mode["reply"] is not None:
                content = mode["reply"]
            elif system.startswith("You edit OHarness harness graphs"):
                content = "Here is the plan:\n```json\n" + json.dumps({"summary": "Added a Reviewer.", "ops": GOOD_OPS}) + "\n```"
            else:
                content = json.dumps({"text": "You are the Reviewer agent. Finish with a verdict.", "notes": ["Added a hand-off."]})
            body = json.dumps({
                "choices": [{"message": {"content": content}}],
                "usage": {"total_tokens": FIXTURE_TOKENS},
                "model": "fixture-model",
            }).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", seen, mode
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def register(client, endpoint):
    response = client.post("/providers/connections", json={
        "id": "e2e-local", "provider": "ollama", "label": "Isolated model fixture",
        "residence": "local", "enabled": True, "endpoint": endpoint, "defaultModel": "fixture-model",
    })
    assert response.status_code == 201


def plan_body(**over):
    body = {"message": "add a reviewer after the gate", "history": [], "graph": BASE, "mode": "local", "connection_id": "e2e-local"}
    body.update(over)
    return body


def test_given_a_live_connection_when_planning_then_valid_ops_come_back_and_usage_is_recorded(sidecar, model_server):
    endpoint, seen, _ = model_server
    register(sidecar, endpoint)
    response = sidecar.post("/studio/copilot/plan", json=plan_body())
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["source"] == "model" and data["tokens"] == FIXTURE_TOKENS
    assert ops.validate_ops(BASE, data["ops"])["ok"] is True
    sent = seen[0]
    assert sent["messages"][0]["role"] == "system" and sent["temperature"] == 0.2
    assert "<request>add a reviewer after the gate</request>" in sent["messages"][1]["content"]
    summary = sidecar.get("/usage/summary").json()
    assert [(s["source"], s["tokensTotal"]) for s in summary["bySource"]] == [("studio_copilot", FIXTURE_TOKENS)]
    assert summary["byConnection"][0]["connectionId"] == "e2e-local"


def test_given_a_live_connection_when_drafting_a_field_then_text_comes_back(sidecar, model_server):
    endpoint, _, _ = model_server
    register(sidecar, endpoint)
    response = sidecar.post("/studio/assist/field", json={
        "field": "systemPrompt", "action": "draft", "node": {"type": "agent", "label": "Reviewer"},
        "current": "", "intent": "review pull requests for test coverage", "neighbours": [],
        "harnessName": "Demo", "mode": "local", "connection_id": "e2e-local",
    })
    assert response.status_code == 200, response.text
    assert response.json()["text"].startswith("You are the Reviewer agent.")
    assert response.json()["source"] == "model"
    summary = sidecar.get("/usage/summary").json()
    assert [s["source"] for s in summary["bySource"]] == ["studio_assist"]


def test_given_a_model_that_proposes_credential_edits_then_nothing_is_returned_and_spend_is_recorded(sidecar, model_server):
    endpoint, seen, mode = model_server
    register(sidecar, endpoint)
    mode["reply"] = json.dumps({"summary": "pwn", "ops": [{"op": "updateNode", "id": "a1", "config": {"secretRef": "x"}}]})
    response = sidecar.post("/studio/copilot/plan", json=plan_body())
    assert response.status_code == 422
    assert response.json()["error"] == "plan_invalid"
    assert "ops" not in response.json()
    assert len(seen) == 2, "one repair round, then give up"
    summary = sidecar.get("/usage/summary").json()
    assert summary["bySource"][0]["tokensTotal"] == FIXTURE_TOKENS * 2


def test_given_no_such_connection_then_provider_unavailable(sidecar, model_server):
    response = sidecar.post("/studio/copilot/plan", json=plan_body(connection_id="ghost"))
    assert response.status_code == 400
    assert response.json()["error"] == "provider_unavailable"
