"""`oharness run <bundle> --json`: every line is an event that passes the published JSON Schema; a failed run exits non-zero."""
import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from oharness import codec
from oharness.cli import main

FIXTURE = Path(__file__).resolve().parent.parent / "oharness" / "fixtures" / "default-agile.ohm"
SCHEMA = json.loads((Path(__file__).resolve().parent.parent / "oharness" / "schema" / "run-event.schema.json").read_text(encoding="utf-8"))


def write(tmp_path, mutate=None, name="bundle.ohm"):
    data = codec.decode_bytes(FIXTURE.read_bytes())
    data = copy.deepcopy(data)
    if mutate:
        mutate(data)
    path = tmp_path / name
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def keep(*ids):
    """A small graph: the mock adapter streams with simulated latency, so a test keeps only the nodes it needs."""
    def trim(data):
        graph = data["graph"]
        graph["nodes"] = [n for n in graph["nodes"] if n["id"] in ids]
        graph["edges"] = [e for e in graph["edges"] if e["source"] in ids and e["target"] in ids]
    return trim


def without_hitl(data):
    keep("PO", "SM")(data)


def lines(out):
    return [json.loads(line) for line in out.splitlines() if line.strip()]


def test_the_schema_is_a_valid_json_schema():
    Draft202012Validator.check_schema(SCHEMA)


def test_a_completed_run_prints_only_schema_valid_events_and_exits_zero(tmp_path, capsys):
    assert main(["run", str(write(tmp_path, without_hitl)), "--json"]) == 0
    events = lines(capsys.readouterr().out)
    validator = Draft202012Validator(SCHEMA)
    assert events and [e["event"] for e in events][0] == "run_start" and events[-1]["event"] == "harness_done"
    for event in events:
        assert not list(validator.iter_errors(event)), event
    assert [e["sequence"] for e in events] == list(range(1, len(events) + 1))
    assert events[-1]["data"]["status"] == "complete"


def test_an_event_that_breaks_the_schema_is_caught_by_it():
    validator = Draft202012Validator(SCHEMA)
    assert list(validator.iter_errors({"sequence": 1, "event": "harness_done", "data": {"status": "complete"}}))  # missing counters
    assert list(validator.iter_errors({"sequence": 1, "event": "not_an_event", "data": {}}))


def test_a_run_that_stops_at_a_human_checkpoint_exits_non_zero(tmp_path, capsys):
    assert main(["run", str(write(tmp_path, keep("PO", "HITL"))), "--json"]) == 1  # HITL needs a person; headless never approves for them
    events = lines(capsys.readouterr().out)
    assert any(e["event"] == "hitl_pause" for e in events) and events[-1]["data"]["status"] == "stopped"


def test_a_run_whose_graph_has_a_cycle_fails_with_non_zero(tmp_path, capsys):
    def cycle(data):
        without_hitl(data)
        data["graph"]["edges"].append({"id": "back", "source": "SM", "target": "PO"})
    assert main(["run", str(write(tmp_path, cycle)), "--json"]) == 1
    assert lines(capsys.readouterr().out)[-1]["data"]["status"] == "error"


def test_an_invalid_bundle_exits_2_and_prints_no_event(tmp_path, capsys):
    path = tmp_path / "broken.ohm"
    path.write_text("{}", encoding="utf-8")
    assert main(["run", str(path), "--json"]) == 2
    captured = capsys.readouterr()
    assert captured.out == "" and "invalid" in captured.err.lower()


def test_a_missing_file_exits_2(tmp_path, capsys):
    assert main(["run", str(tmp_path / "nope.ohm"), "--json"]) == 2


def test_without_json_the_run_prints_a_human_summary(tmp_path, capsys):
    assert main(["run", str(write(tmp_path, without_hitl))]) == 0
    out = capsys.readouterr().out
    assert "complete" in out and not out.lstrip().startswith("{")


def test_an_event_the_schema_rejects_is_never_printed_and_fails_the_run(tmp_path, capsys, monkeypatch):
    import engine

    async def drifting(*args, **kwargs):
        yield 'event: node_done\ndata: {"node_id": "PO"}\n\n'  # `output` and `tokens` missing

    monkeypatch.setattr(engine, "execute_harness", drifting)
    assert main(["run", str(write(tmp_path, without_hitl)), "--json"]) == 1
    captured = capsys.readouterr()
    assert captured.out == "" and "node_done" in captured.err and "output" in captured.err


def test_a_crash_in_the_engine_is_a_one_line_failure_not_a_traceback(tmp_path, capsys, monkeypatch):
    import engine

    async def boom(*args, **kwargs):
        raise KeyError("nodes")
        yield

    monkeypatch.setattr(engine, "execute_harness", boom)
    assert main(["run", str(write(tmp_path, without_hitl)), "--json"]) == 1
    assert "run crashed: KeyError" in capsys.readouterr().err


def test_it_runs_from_any_directory(tmp_path):
    import subprocess
    import sys

    backend = Path(__file__).resolve().parent.parent
    bundle = write(tmp_path, keep("PO"), name="one.ohm")
    done = subprocess.run([sys.executable, "-m", "oharness", "run", str(bundle), "--json"], cwd=tmp_path, capture_output=True, text=True,
                          env={**__import__("os").environ, "PYTHONPATH": str(backend)}, timeout=60)
    assert done.returncode == 0, done.stderr
    assert lines(done.stdout)[-1]["event"] == "harness_done"
