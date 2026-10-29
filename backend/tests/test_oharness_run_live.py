"""`oharness run --mode live`: a real-provider run from the terminal, with the sidecar's safety rules and no secret on the output."""
import copy
import json
from pathlib import Path

import pytest

from adapters.base import AdapterConfig, AdapterResult, AgentAdapter
from oharness import codec
from oharness.cli import main
from secret_store.memory import MemorySecrets

FIXTURE = Path(__file__).resolve().parent.parent / "oharness" / "fixtures" / "default-agile.ohm"
KEY = "sk-ant-" + "A1b2C3d4E5f6G7h8I9j0"  # gitleaks:allow


class LeakyAdapter(AgentAdapter):
    """Answers with the credential it was handed, the way a misbehaving provider or tool could echo it."""

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        return AdapterResult(content=self._answer(config), tokens_used=3)

    async def stream(self, prompt: str, config: AdapterConfig):
        yield self._answer(config)

    @staticmethod
    def _answer(config: AdapterConfig) -> str:
        return f"the key is {config.api_key}"


CONNECTIONS = {"router": {"id": "router", "provider": "openrouter", "label": "OpenRouter", "residence": "cloud",
                          "endpoint": "https://openrouter.ai/api/v1", "enabled": True, "defaultModel": "some/model",
                          "secretRef": "oharness/router"}}  # gitleaks:allow


def bundle(tmp_path, nodes=None, edges=None):
    data = copy.deepcopy(codec.decode_bytes(FIXTURE.read_bytes()))
    data["graph"] = {
        "nodes": nodes or [{"id": "in", "type": "input", "data": {"prompt": "hi"}},
                           {"id": "draft", "type": "llm", "data": {"label": "Draft", "providerIds": ["router"]}}],
        "edges": edges if edges is not None else [{"id": "e", "source": "in", "target": "draft"}],
    }
    path = tmp_path / "live.ohm"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


@pytest.fixture
def runtime(monkeypatch):
    store = MemorySecrets()
    store.put("oharness/router", KEY)
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: LeakyAdapter())
    from oharness import headless

    async def load():
        return dict(CONNECTIONS), store

    monkeypatch.setattr(headless, "load_runtime", load)
    return store


def events(out):
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def test_a_live_run_uses_the_stored_provider_and_never_prints_the_key(tmp_path, capsys, runtime):
    code = main(["run", str(bundle(tmp_path)), "--json", "--mode", "live"])
    captured = capsys.readouterr()
    assert code == 0
    assert KEY not in captured.out and KEY not in captured.err
    done = next(e for e in events(captured.out) if e["event"] == "node_done" and e["data"]["node_id"] == "draft")
    assert "redacted" in done["data"]["output"] and done["data"]["output"].startswith("the key is")


def test_a_live_run_with_no_connection_for_the_node_fails_cleanly(tmp_path, capsys, monkeypatch):
    from oharness import headless

    async def load():
        return {}, MemorySecrets()

    monkeypatch.setattr(headless, "load_runtime", load)
    code = main(["run", str(bundle(tmp_path)), "--json", "--mode", "live"])
    captured = capsys.readouterr()
    assert code == 1 and "Traceback" not in captured.err
    assert any(e["event"] == "node_error" for e in events(captured.out))


def test_a_live_run_stops_at_a_human_checkpoint_instead_of_approving_it(tmp_path, capsys, runtime):
    nodes = [{"id": "in", "type": "input", "data": {"prompt": "hi"}}, {"id": "gate", "type": "hitl", "data": {"label": "Approve"}},
             {"id": "draft", "type": "llm", "data": {"label": "Draft", "providerIds": ["router"]}}]
    edges = [{"id": "e1", "source": "in", "target": "gate"}, {"id": "e2", "source": "gate", "target": "draft"}]
    code = main(["run", str(bundle(tmp_path, nodes, edges)), "--json", "--mode", "live"])
    seen = [e["event"] for e in events(capsys.readouterr().out)]
    assert code == 1 and "hitl_pause" in seen and "node_start" in seen
    assert not any(e == "node_done" for e in seen[seen.index("hitl_pause"):])  # the run never went past the gate


def test_an_exhausted_budget_refuses_the_run_with_a_message_and_exit_1(tmp_path, capsys, runtime, monkeypatch):
    from usage_tracking import BudgetExceededError

    async def refuse(db):
        raise BudgetExceededError("budget exhausted")

    monkeypatch.setattr("usage_tracking.enforce_budget_or_raise", refuse)
    code = main(["run", str(bundle(tmp_path)), "--json", "--mode", "live"])
    captured = capsys.readouterr()
    assert code == 1 and captured.out == "" and "budget" in captured.err.lower()


def test_a_workspace_that_is_not_a_registered_project_is_refused(tmp_path, capsys, runtime):
    code = main(["run", str(bundle(tmp_path)), "--json", "--mode", "live", "--workspace", str(tmp_path), "--worktree"])
    captured = capsys.readouterr()
    assert code == 2 and "workspace" in captured.err.lower() and captured.out == ""


def test_mock_stays_the_default_and_needs_no_database(tmp_path, capsys, monkeypatch):
    from oharness import headless

    async def load():
        raise AssertionError("mock must not read providers or secrets")

    monkeypatch.setattr(headless, "load_runtime", load)
    nodes = [{"id": "in", "type": "input", "data": {"prompt": "hi"}}]
    code = main(["run", str(bundle(tmp_path, nodes, [])), "--json"])
    assert code == 0


@pytest.mark.parametrize("event,data", [
    ("error", {"error": "Provider execution failed."}),
    ("worktree_ready", {"workspace_id": "ws-0000000000000001"}),
    ("worktree_closed", {"workspace_id": "ws-0000000000000001", "rescue_ref": None}),
    ("route_decision", {"source": "model", "reason": "plain chat", "engage_harness": False}),
    ("budget_warning", {"state": "warning", "message": "80% of the budget is used"}),
])
def test_every_event_a_live_run_can_emit_is_in_the_published_schema(event, data):
    from jsonschema import Draft202012Validator

    schema = json.loads((Path(__file__).resolve().parent.parent / "oharness" / "schema" / "run-event.schema.json").read_text(encoding="utf-8"))
    assert not list(Draft202012Validator(schema).iter_errors({"sequence": 1, "event": event, "data": data}))
    assert list(Draft202012Validator(schema).iter_errors({"sequence": 1, "event": event, "data": "not an object"}))


def test_a_registered_workspace_becomes_the_folder_the_node_runs_in(tmp_path, capsys, runtime, monkeypatch):
    import anyio

    from database import SessionLocal, init_db
    from models import CoworkProject

    seen = {}

    class CwdAdapter(LeakyAdapter):
        async def stream(self, prompt, config):
            seen["cwd"] = config.extra.get("cwd")
            yield "ok"

        async def invoke(self, prompt, config):
            seen["cwd"] = config.extra.get("cwd")
            return AdapterResult(content="ok", tokens_used=1)

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: CwdAdapter())
    folder = tmp_path / "project"
    folder.mkdir()

    async def register():
        await init_db()
        async with SessionLocal() as db:
            db.add(CoworkProject(name="p", root_path=str(folder)))
            await db.commit()

    anyio.run(register)
    code = main(["run", str(bundle(tmp_path)), "--json", "--mode", "live", "--workspace", str(folder)])
    assert code == 0 and seen["cwd"] == str(folder.resolve())
