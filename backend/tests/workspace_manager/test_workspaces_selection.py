"""Selecting the workspace to run in: persisted on the server, verified on every read."""
from __future__ import annotations

import shutil

import pytest

from workspaces.errors import WorkspaceError
from workspaces.paths import canonical
from workspaces.service import WorkspaceService


@pytest.fixture
def svc(oh_env, runner):
    return WorkspaceService(oh_env.settings, runner)


def test_nothing_is_selected_by_default(svc):
    assert svc.selected() == {"selected": None, "cwd": None, "stale": None}


def test_selection_is_persisted_and_flagged_in_the_listing(svc, repo, oh_env, runner):
    info = svc.create(str(repo.path), "main")
    picked = svc.select(str(repo.path), info["id"])
    assert picked["selected"] and picked["id"] == info["id"]
    again = WorkspaceService(oh_env.settings, runner)  # a new instance, as after a restart
    current = again.selected()
    assert current["selected"]["id"] == info["id"] and canonical(current["cwd"]) == canonical(info["path"])
    listed = {i["id"]: i["selected"] for i in again.list(str(repo.path))}
    assert listed == {"main": False, info["id"]: True}


def test_the_principal_worktree_can_be_selected(svc, repo):
    outcome = svc.select(str(repo.path), "main")
    assert outcome["selected"]
    assert canonical(svc.selected()["cwd"]) == canonical(repo.path)


def test_selecting_replaces_the_previous_selection(svc, repo):
    a, b = svc.create(str(repo.path), "main"), svc.create(str(repo.path), "main")
    svc.select(str(repo.path), a["id"])
    svc.select(str(repo.path), b["id"])
    assert svc.selected()["selected"]["id"] == b["id"]
    assert [i["id"] for i in svc.list(str(repo.path)) if i["selected"]] == [b["id"]]


@pytest.mark.parametrize("ident", ["ws-0000000000000000", "nope", "../../etc", "", "NUL", "ext-000"])
def test_selecting_an_unknown_id_is_not_found_and_changes_nothing(svc, repo, ident):
    info = svc.create(str(repo.path), "main")
    svc.select(str(repo.path), info["id"])
    with pytest.raises(WorkspaceError) as caught:
        svc.select(str(repo.path), ident)
    assert caught.value.code == "workspace_not_found" and caught.value.status == 404
    assert svc.selected()["selected"]["id"] == info["id"]


def test_a_workspace_whose_directory_is_gone_cannot_be_selected(svc, repo):
    info = svc.create(str(repo.path), "main")
    shutil.rmtree(info["path"])
    with pytest.raises(WorkspaceError) as caught:
        svc.select(str(repo.path), info["id"])
    assert caught.value.code == "workspace_missing"


def test_a_selection_whose_directory_vanishes_is_reported_stale_not_returned(svc, repo):
    info = svc.create(str(repo.path), "main")
    svc.select(str(repo.path), info["id"])
    shutil.rmtree(info["path"])
    current = svc.selected()
    assert current["selected"] is None and current["cwd"] is None
    assert current["stale"]["id"] == info["id"] and current["stale"]["reason"] == "workspace_missing"


def test_a_selection_whose_repository_vanishes_is_reported_stale(svc, make_repo):
    gone = make_repo("will-vanish")
    svc.select(str(gone.path), "main")
    shutil.rmtree(gone.path, ignore_errors=True)
    assert svc.selected()["stale"]["reason"] in {"invalid_repo", "not_a_repository"}


def test_clearing_the_selection(svc, repo):
    svc.select(str(repo.path), "main")
    svc.clear_selection()
    assert svc.selected()["selected"] is None
