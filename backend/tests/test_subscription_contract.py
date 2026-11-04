"""
Subscription-path contract (R-PRV-00): pins invariants I1..I10, I12 and I13 of
the `credential.kind=cli` connections (Claude, Codex/ChatGPT, Cursor).

Nothing here changes behaviour — it fixes today's behaviour so every later
Providers change must keep the subscription path as it is. No process is
spawned: each adapter takes an injectable ``runner``.

I11 (subscription never invents USD) stays pending until the budget wiring in
R-PRV-06 lands; it is deliberately neither a red test nor a skip.
"""
from __future__ import annotations

import asyncio
import json

import pytest

from adapters import get_adapter
from adapters.base import AdapterConfig
from adapters.catalog import PROVIDERS
from adapters.cli_claude import ClaudeCliAdapter
from adapters.cli_codex import CodexCliAdapter
from adapters.cli_cursor import CursorCliAdapter
from adapters.cli_shared import CliRunResult
from providers.resolution import resolve_node_provider
from secret_store.memory import MemorySecrets
from test_execution_provider_resolution import client, _sse_events  # noqa: F401

# (provider id, adapter class, module that owns `find_cli`)
VIA = [
    ("anthropic", ClaudeCliAdapter, "adapters.cli_claude"),
    ("openai", CodexCliAdapter, "adapters.cli_codex"),
    ("cursor", CursorCliAdapter, "adapters.cli_cursor"),
]
CRED_VARS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CURSOR_API_KEY", "GITHUB_TOKEN")
PROMPT = "contract-prompt ; rm -rf / && echo pwned"
CANARY = "CANARY-STDERR-5f1c9a"


@pytest.fixture(autouse=True)
def _linux_cli(monkeypatch: pytest.MonkeyPatch) -> None:
    # The contract is about the shape of what would be spawned, not the host OS.
    for _pid, _cls, module in VIA:
        monkeypatch.setattr(f"{module}.find_cli", lambda name: f"/usr/local/bin/{name}")
    # Each adapter gates on its own platform check: Codex only runs on Windows (SEC-6),
    # Cursor only off Windows (SEC-2). Pin both so the contract is host-independent.
    monkeypatch.setattr("adapters.cli_shared.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_cursor.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_codex.is_windows", lambda: True)
    for var in CRED_VARS:
        monkeypatch.setenv(var, f"leak-{var}")


def _config() -> AdapterConfig:
    return AdapterConfig(adapter="", model="", extra={})


def _recording(captured: list[dict], result: CliRunResult):
    async def runner(argv, *, cwd, env, timeout, stdin=None):
        captured.append({"argv": list(argv), "env": dict(env), "stdin": stdin, "timeout": timeout})
        return result

    return runner


@pytest.mark.parametrize("pid,cls,_module", VIA)
def test_i3_i4_i5_i12_invoke_shape(pid, cls, _module) -> None:
    captured: list[dict] = []
    adapter = cls(runner=_recording(captured, CliRunResult(returncode=0, stdout="{}", stderr="")))
    asyncio.run(adapter.invoke(PROMPT, _config()))
    call = captured[0]
    assert isinstance(call["argv"], list) and all(isinstance(a, str) for a in call["argv"])  # I3
    assert PROMPT not in " ".join(call["argv"])  # I4
    assert call["stdin"] == PROMPT  # I4
    assert not any(var in call["env"] for var in CRED_VARS)  # I5
    assert call["timeout"] > 0  # I12


@pytest.mark.parametrize("pid,cls,_module", VIA)
def test_i7_probe_only_runs_a_status_command(pid, cls, _module) -> None:
    captured: list[dict] = []
    adapter = cls(runner=_recording(captured, CliRunResult(returncode=0, stdout="{}", stderr="")))
    asyncio.run(adapter.probe(_config()))
    assert len(captured) == 1  # a probe is exactly one command
    argv = captured[0]["argv"]
    assert argv[-1] in {"status", "json"} and "status" in argv  # `auth status`, `login status` or `status --format json`
    assert PROMPT not in " ".join(argv)
    assert captured[0]["stdin"] is None  # a probe never sends a prompt
    assert not any(var in captured[0]["env"] for var in CRED_VARS)  # I5 on the probe too


def test_i9_cursor_keeps_the_sandbox_flag() -> None:
    argv = CursorCliAdapter().build_argv(_config())
    assert argv[argv.index("--sandbox") + 1] == "enabled"


@pytest.mark.parametrize("pid,cls,_module", VIA)
def test_i13_ids_stay_cli_backed(pid, cls, _module) -> None:
    assert PROVIDERS[pid]["credential"]["kind"] == "cli"
    assert isinstance(get_adapter({"anthropic": "claude", "openai": "codex", "cursor": "cursor"}[pid]), cls)


# Cursor runs agents, not chat turns, so it never resolves through an llm node: its adapter
# receives no credential at all (env allowlist in the invoke test, adapter wiring in the I13 test).
@pytest.mark.parametrize("pid", ["anthropic", "openai"])
def test_i1_i8_a_secret_ref_on_a_cli_connection_is_ignored(pid) -> None:
    store = MemorySecrets()
    store.put(f"oharness/{pid}", "canary-secret-7d3e")
    connections = {pid: {
        "id": pid, "provider": pid, "label": pid, "residence": "cloud", "enabled": True,
        "secretRef": f"oharness/{pid}", "endpoint": "", "credential": {"kind": "cli"},
    }}
    resolved = resolve_node_provider(
        {"providerIds": [pid], "model": "m"}, "llm", "Node", connections=connections, secrets_store=store,
    )
    assert resolved.config.api_key == ""


def test_i8_positive_control_a_key_connection_does_read_its_secret() -> None:
    # Guards the test above against passing vacuously: for a kind=api connection the same
    # store DOES produce a key, so an empty key on kind=cli is the invariant at work.
    store = MemorySecrets()
    store.put("oharness/openrouter", "canary-secret-7d3e")
    connections = {"openrouter": {
        "id": "openrouter", "provider": "openrouter", "label": "OpenRouter", "residence": "cloud",
        "enabled": True, "secretRef": "oharness/openrouter", "endpoint": "https://openrouter.ai/api/v1",
        "credential": {"kind": "key"},
    }}
    resolved = resolve_node_provider(
        {"providerIds": ["openrouter"], "model": "m"}, "llm", "Node", connections=connections, secrets_store=store,
    )
    assert resolved.config.api_key == "canary-secret-7d3e"


def test_i10_cli_stderr_never_arrives_in_the_run_response(client, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    captured: list[dict] = []
    failing = ClaudeCliAdapter(runner=_recording(captured, CliRunResult(returncode=1, stdout="", stderr=f"boom {CANARY}")))
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: failing)
    response = client.post("/execute/direct", json={"instruction": "hello", "mode": "live", "connection_id": "anthropic"})
    assert captured, "the failing CLI was never invoked"
    assert CANARY not in response.text
    error = next((d for n, d in _sse_events(response.text) if n == "node_error"), None)
    # Today the run answers with fixed text; the closed failure class arrives with R-PRV-03.
    assert error is not None and CANARY not in json.dumps(error)


# I11 (subscription never invents USD): pending until R-PRV-06 — tracked in the issue, no test here.
