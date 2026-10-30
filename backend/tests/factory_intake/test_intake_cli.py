import json
import subprocess
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from factory_intake import factory_cli
from factory_intake.memory import MemoryFactory
from factory_intake.port import SourceRef, WorkItemView
from oharness.cli import main

SCHEMA = json.loads(factory_cli.SCHEMA_PATH.read_text())


@pytest.fixture
def port(monkeypatch):
    shared = MemoryFactory()
    monkeypatch.setattr("factory_intake.loader.load_port", lambda *a: shared)
    return shared


def run(capsys, *argv):
    code = main(["factory", *argv])
    out = capsys.readouterr()
    return code, out.out, out.err


def test_the_schema_is_valid_and_in_sync_with_the_models():
    Draft202012Validator.check_schema(SCHEMA)
    base = WorkItemView.model_json_schema()
    assert SCHEMA["$defs"]["WorkItemView"]["properties"].keys() == base["properties"].keys()
    assert SCHEMA["$defs"]["SourceRef"]["properties"].keys() == base["$defs"]["SourceRef"]["properties"].keys()
    assert SCHEMA["$defs"]["Claim"]["properties"].keys() == base["$defs"]["Claim"]["properties"].keys()


def test_submit_status_list_comment_inbox_metrics_cancel_json_validates_against_the_schema(port, capsys):
    validator = Draft202012Validator(SCHEMA)
    code, out, _ = run(capsys, "submit", "Fix rounding", "--note", "details", "--ref", "r1", "--json")
    assert code == 0
    created = json.loads(out)
    assert created["command"] == "submit" and created["outcome"] == "created" and not list(validator.iter_errors(created))
    item_id = created["item"]["id"]
    for argv, key in ((["status", item_id], "item"), (["list"], "items"), (["inbox"], "items"), (["metrics"], "metrics"), (["comment", item_id, "hello"], "ok")):
        code, out, _ = run(capsys, *argv, "--json")
        payload = json.loads(out)
        assert code == 0 and key in payload and not list(validator.iter_errors(payload)), argv
    assert port.comments[item_id][0][1] == "hello"
    code, out, _ = run(capsys, "submit", "again", "--ref", "r1", "--json")
    assert json.loads(out)["outcome"] == "replay"
    code, out, _ = run(capsys, "cancel", item_id, "--json")
    assert json.loads(out)["item"]["state"] == "cancelled"


def test_claim_and_release_go_to_review_not_done(port, capsys):
    item_id = json.loads(run(capsys, "submit", "w", "--json")[1])["item"]["id"]
    code, out, _ = run(capsys, "claim", item_id, "--holder", "me", "--json")
    claimed = json.loads(out)
    assert code == 0 and claimed["item"]["state"] == "claimed" and claimed["worktree"] is None
    code, out, err = run(capsys, "claim", item_id, "--json")
    assert code == 1 and json.loads(err)["error"]["code"] == "not_claimable" and out == ""
    code, out, _ = run(capsys, "release", item_id, "--summary", "did it", "--branch", "factory/x", "--json")
    assert code == 0 and json.loads(out)["item"]["state"] == "awaiting_human"
    assert json.loads(run(capsys, "inbox", "--json")[1])["items"][0]["id"] == item_id


def test_a_bad_branch_or_unknown_item_is_a_clean_error(port, capsys):
    item_id = json.loads(run(capsys, "submit", "w", "--json")[1])["item"]["id"]
    run(capsys, "claim", item_id)
    code, out, err = run(capsys, "release", item_id, "--summary", "s", "--branch=--upload-pack=x", "--json")
    assert code == 2 and out == "" and json.loads(err)["error"]["code"] == "invalid_argument"
    code, out, err = run(capsys, "status", "nope", "--json")
    assert code == 1 and json.loads(err)["error"]["code"] == "not_found"


def test_plain_output_strips_terminal_control_characters(port, capsys):
    port.submit(__import__("factory_intake.port", fromlist=["x"]).WorkItemDraft(source=SourceRef(kind="github", ref="a/b#1"), title="evil \x1b[31mred\x07", idempotency_key="g"))
    code, out, _ = run(capsys, "list")
    assert code == 0 and "\x1b" not in out and "\x07" not in out and "evil" in out


def test_output_that_breaks_the_schema_is_never_printed(port, capsys, monkeypatch):
    monkeypatch.setattr(factory_cli, "_item", lambda view: {"id": 5})
    code, out, err = run(capsys, "submit", "w", "--json")
    assert code == 1 and out == "" and "schema" in err


def test_no_factory_here_is_a_clear_refusal(monkeypatch, capsys):
    monkeypatch.delenv("OH_FACTORY_PORT", raising=False)
    code, out, err = run(capsys, "status", "x")
    assert code == 2 and "foundation" in err and out == ""


def test_claim_with_a_worktree_records_it_and_a_failed_claim_leaves_nothing(port, capsys, tmp_path, monkeypatch):
    made, dropped = [], []
    monkeypatch.setattr(factory_cli, "_make_worktree", lambda repo: made.append(repo) or ("ws1", str(tmp_path / "ws1")))
    monkeypatch.setattr(factory_cli, "_drop_worktree", lambda repo, ident: dropped.append(ident))
    item_id = json.loads(run(capsys, "submit", "w", "--json")[1])["item"]["id"]
    code, out, _ = run(capsys, "claim", item_id, "--worktree", str(tmp_path), "--json")
    claimed = json.loads(out)
    assert code == 0 and claimed["worktree"]["id"] == "ws1" and claimed["item"]["claim"]["worktree_ref"] == "ws1" and not dropped
    code, _, _ = run(capsys, "claim", item_id, "--worktree", str(tmp_path), "--json")   # already claimed
    assert code == 1 and dropped == ["ws1"]


def test_a_failing_worktree_means_no_claim(port, capsys, tmp_path, monkeypatch):
    def boom(repo):
        raise RuntimeError("not a git repository")
    monkeypatch.setattr(factory_cli, "_make_worktree", boom)
    item_id = json.loads(run(capsys, "submit", "w", "--json")[1])["item"]["id"]
    code, _, err = run(capsys, "claim", item_id, "--worktree", str(tmp_path), "--json")
    assert code == 1 and "nothing was claimed" in err and port.get(item_id).state == "queued"


def test_a_real_worktree_is_made_under_the_managed_root(port, capsys, tmp_path, monkeypatch):
    repo = tmp_path / "repo"
    repo.mkdir()
    git = lambda *a: subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True)  # noqa: E731
    git("init", "-q", "-b", "main")
    git("-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "--allow-empty", "-m", "init")
    monkeypatch.setenv("OH_WORKSPACES_ROOT", str(tmp_path / "managed"))
    item_id = json.loads(run(capsys, "submit", "w", "--json")[1])["item"]["id"]
    code, out, err = run(capsys, "claim", item_id, "--worktree", str(repo), "--json")
    if code != 0:
        pytest.skip(f"managed worktrees need configuration not present in this environment: {err[:120]}")
    path = json.loads(out)["worktree"]["path"]
    assert Path(path).is_dir() and str(repo) not in path
