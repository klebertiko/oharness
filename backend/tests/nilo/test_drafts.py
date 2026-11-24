"""Sending is a human act, bound to one exact draft."""
from __future__ import annotations

from fastapi.testclient import TestClient

from main import app
from nilo.drafts import DRAFT_TOOL, routine_wants_to_send
from nilo.memory import REMEMBER_TOOL
from sandbox.schemas import TOOL_SCHEMAS

SECRET = "ghp_" + "c" * 36


def test_the_model_tools_never_include_a_send() -> None:
    names = [tool["function"]["name"] for tool in [*TOOL_SCHEMAS, REMEMBER_TOOL, DRAFT_TOOL]]
    assert "draft_message" in names
    assert not any("send" in name or name in {"post", "deliver", "publish"} for name in names)


def test_send_requires_a_fresh_approval_of_this_hash() -> None:
    with TestClient(app) as client:
        created = client.post("/nilo/drafts", json={
            "target": {"connector": "clipboard", "address": "local"},
            "body": "olá",
        })
        assert created.status_code == 201, created.text
        draft_id = created.json()["id"]
        missing = client.post(f"/nilo/drafts/{draft_id}/send", json={})
        assert missing.status_code == 409
        approval = client.post(f"/nilo/drafts/{draft_id}/approve").json()["approval_id"]
        other = client.post("/nilo/drafts", json={"target": {"connector": "clipboard", "address": "local"}, "body": "outro"}).json()
        wrong = client.post(f"/nilo/drafts/{other['id']}/send", json={"approval_id": approval})
        assert wrong.status_code == 409
        assert client.post(f"/nilo/drafts/{draft_id}/send", json={"approval_id": approval}).status_code == 200
        reused = client.post(f"/nilo/drafts/{draft_id}/send", json={"approval_id": approval})
        assert reused.status_code == 409


def test_editing_after_approval_demands_a_new_decision() -> None:
    with TestClient(app) as client:
        draft_id = client.post("/nilo/drafts", json={
            "target": {"connector": "clipboard", "address": "local"}, "body": "versão um",
        }).json()["id"]
        approval = client.post(f"/nilo/drafts/{draft_id}/approve").json()["approval_id"]
        edited = client.patch(f"/nilo/drafts/{draft_id}", json={"body": "versão dois"})
        assert edited.json()["approval_id"] is None
        assert client.post(f"/nilo/drafts/{draft_id}/send", json={"approval_id": approval}).status_code == 409


def test_a_routine_that_tries_to_send_only_makes_a_draft() -> None:
    produced = routine_wants_to_send("segue o resumo")
    assert produced["kind"] == "draft"
    assert produced["connector"] == "clipboard"


def test_a_secret_is_redacted_before_the_draft_is_shown() -> None:
    with TestClient(app) as client:
        created = client.post("/nilo/drafts", json={
            "target": {"connector": "clipboard", "address": "local"},
            "body": f"token {SECRET}",
        })
        assert created.status_code == 201
        assert SECRET not in created.json()["body"]
        assert "redacted" in created.json()["body"]
