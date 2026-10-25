"""The registry is rebuildable and tolerant, selection is limited to what the manager owns, and a half-removed workspace can be finished."""
from __future__ import annotations

import json
import os
import shutil
import sys
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from main import app
from workspaces.errors import WorkspaceError
from workspaces.paths import canonical
from workspaces_support import make_dir_link


def state_file(oh_env) -> Path:
    return oh_env.settings.state_path


def ids(svc, repo):
    return [i["id"] for i in svc.list(str(repo.path))]


def go(svc, repo, ident):
    report = svc.removal_check(str(repo.path), ident)
    return report, svc.remove(str(repo.path), ident, report["confirmation_token"])


# ----------------------------------------------------------------------- the registry is rebuilt from git (QA item)


@pytest.mark.parametrize("damage", ["delete", "corrupt"])
def test_losing_the_state_file_does_not_strand_the_managed_worktrees(svc, repo, oh_env, damage):
    a, b = svc.create(str(repo.path), "main", branch="a"), svc.create(str(repo.path), "main", branch="b")
    if damage == "delete":
        state_file(oh_env).unlink()
    else:
        state_file(oh_env).write_text("{ not json", encoding="utf-8")
    third = svc.create(str(repo.path), "main", branch="c")  # was 409 unsafe_destination for every later create
    assert third["managed"]
    listed = {i["id"]: i for i in svc.list(str(repo.path))}
    assert listed[a["id"]]["managed"] and listed[b["id"]]["managed"] and not any(i.startswith("ext-") for i in listed)
    assert listed[a["id"]]["branch"] == "a"
    go(svc, repo, a["id"])
    assert ids(svc, repo).count("main") == 1 and a["id"] not in ids(svc, repo) and b["id"] in ids(svc, repo)


def test_a_lost_selection_is_gone_but_the_workspace_stays_selectable(svc, repo, oh_env):
    info = svc.create(str(repo.path), "main")
    svc.select(str(repo.path), info["id"])
    state_file(oh_env).unlink()
    assert svc.selected()["selected"] is None
    outcome = svc.select(str(repo.path), info["id"])
    assert outcome["selected"]


def test_a_worktree_of_another_repository_is_never_adopted(svc, make_repo, oh_env):
    first, second = make_repo("first"), make_repo("second")
    other = svc.create(str(second.path), "main")
    # first's git is made to list second's managed directory as one of its own worktrees
    admin = first.path / ".git" / "worktrees" / "borrowed"
    admin.mkdir(parents=True)
    (admin / "gitdir").write_text(Path(other["path"], ".git").as_posix() + "\n", encoding="utf-8")
    (admin / "HEAD").write_text(first.out("rev-parse", "HEAD") + "\n", encoding="utf-8")
    (admin / "commondir").write_text("../..\n", encoding="utf-8")
    listed = svc.list(str(first.path))
    borrowed = [i for i in listed if canonical(i["path"]) == canonical(other["path"])]
    assert borrowed and all(not i["managed"] and i["id"].startswith("ext-") for i in borrowed)


# ----------------------------------------------------------------------- malformed records do not break the listing


MALFORMED = [
    {"id": "ws-0000000000000001"},                                                  # no path
    "just a string",
    {"id": "ws-0000000000000002", "path": 5},
    {"id": "ws-0000000000000003", "path": ["x"]},
    {"id": 7, "path": "C:/x"},
    {"id": "ws-0000000000000005", "path": "relative/dir"},
    None,
    {"id": "ws-0000000000000006", "path": "/x", "branch": {"a": 1}},
]


@pytest.mark.parametrize("bad", MALFORMED)
def test_a_malformed_registry_record_is_quarantined_not_fatal(svc, repo, oh_env, bad):
    info = svc.create(str(repo.path), "main")
    data = json.loads(state_file(oh_env).read_text(encoding="utf-8"))
    key = next(iter(data["workspaces"]))
    data["workspaces"][key]["broken"] = bad
    state_file(oh_env).write_text(json.dumps(data), encoding="utf-8")
    assert ids(svc, repo) == ["main", info["id"]]
    svc.select(str(repo.path), info["id"])
    report, result = go(svc, repo, info["id"])
    assert result["removed"]
    kept = json.loads(state_file(oh_env).read_text(encoding="utf-8"))
    assert "broken" not in kept["workspaces"].get(key, {}) and kept.get("quarantine")


@pytest.mark.parametrize("group", [[], "text", 5, None])
def test_a_registry_group_of_the_wrong_type_is_quarantined(svc, repo, oh_env, group):
    svc.create(str(repo.path), "main")
    data = json.loads(state_file(oh_env).read_text(encoding="utf-8"))
    key = next(iter(data["workspaces"]))
    data["workspaces"][key] = group
    state_file(oh_env).write_text(json.dumps(data), encoding="utf-8")
    assert ids(svc, repo)[0] == "main"
    outcome = svc.create(str(repo.path), "main")
    assert outcome["managed"]


@pytest.mark.parametrize("selected", [{"repo": 5, "repo_key": "k", "id": "x"}, {"id": "main"}, {"repo": "r", "repo_key": None, "id": "main"}])
def test_a_malformed_selection_reads_as_nothing_selected(svc, repo, oh_env, selected):
    data = {"version": 1, "workspaces": {}, "selected": selected}
    state_file(oh_env).write_text(json.dumps(data), encoding="utf-8")
    assert svc.selected() == {"selected": None, "cwd": None, "stale": None}


def test_a_malformed_record_over_http_is_not_a_500(oh_env, repo):
    client = TestClient(app)
    made = client.post("/workspaces", json={"repo": str(repo.path), "ref": "main"}).json()
    data = json.loads(state_file(oh_env).read_text(encoding="utf-8"))
    key = next(iter(data["workspaces"]))
    data["workspaces"][key]["x"] = {"id": "x"}
    state_file(oh_env).write_text(json.dumps(data), encoding="utf-8")
    listed = client.get("/workspaces", params={"repo": str(repo.path)})
    assert listed.status_code == 200 and [w["id"] for w in listed.json()["workspaces"]] == ["main", made["id"]]
    outcome = client.put("/workspaces/selected", json={"repo": str(repo.path), "id": made["id"]})
    assert outcome.status_code == 200
    outcome = client.post(f"/workspaces/{made['id']}/removal-check", json={"repo": str(repo.path)})
    assert outcome.status_code == 200


# ----------------------------------------------------------------------- selection is limited to what the manager owns


def fabricate_foreign_worktree(repo, victim: Path):
    (victim / ".git").write_text("gitdir: " + (repo.path / ".git" / "worktrees" / "evil").as_posix() + "\n", encoding="utf-8")
    admin = repo.path / ".git" / "worktrees" / "evil"
    admin.mkdir(parents=True)
    (admin / "gitdir").write_text((victim / ".git").as_posix() + "\n", encoding="utf-8")
    (admin / "HEAD").write_text(repo.out("rev-parse", "HEAD") + "\n", encoding="utf-8")
    (admin / "commondir").write_text("../..\n", encoding="utf-8")


def test_a_fabricated_worktree_entry_cannot_be_selected_as_a_cwd(svc, repo, tmp_path):
    victim = tmp_path / "victim-dir"
    victim.mkdir()
    fabricate_foreign_worktree(repo, victim)
    foreign = [i for i in svc.list(str(repo.path)) if i["id"].startswith("ext-")]
    assert foreign and not foreign[0]["managed"]
    with pytest.raises(WorkspaceError) as caught:
        svc.select(str(repo.path), foreign[0]["id"])
    assert caught.value.code == "workspace_not_selectable" and caught.value.status == 403
    assert svc.selected() == {"selected": None, "cwd": None, "stale": None}


def test_a_selection_that_stopped_being_ours_is_reported_stale_with_no_cwd(svc, repo, oh_env, tmp_path):
    victim = tmp_path / "victim-dir"
    victim.mkdir()
    fabricate_foreign_worktree(repo, victim)
    foreign = next(i for i in svc.list(str(repo.path)) if i["id"].startswith("ext-"))
    data = {"version": 1, "workspaces": {}, "selected": {"repo": str(repo.path), "repo_key": "k", "id": foreign["id"], "selected_at": "x"}}
    state_file(oh_env).write_text(json.dumps(data), encoding="utf-8")
    current = svc.selected()
    assert current["selected"] is None and current["cwd"] is None and current["stale"]["reason"] == "workspace_not_selectable"


def test_a_worktree_that_git_lists_but_the_manager_did_not_create_is_not_selectable(svc, repo, oh_env):
    outside_dir = oh_env.tmp / "hand-made"
    repo.git("worktree", "add", "--detach", "--", str(outside_dir), "HEAD")
    foreign = next(i for i in svc.list(str(repo.path)) if i["id"].startswith("ext-"))
    with pytest.raises(WorkspaceError) as caught:
        svc.select(str(repo.path), foreign["id"])
    assert caught.value.code == "workspace_not_selectable"


# ----------------------------------------------------------------------- orphaned: recorded and on disk, unknown to git


def orphan(svc, repo, *, dirty=True):
    info = svc.create(str(repo.path), "main", branch="orph")
    if dirty:
        Path(info["path"], "left-over.txt").write_text("remains\n", encoding="utf-8")
    shutil.rmtree(repo.path / ".git" / "worktrees" / Path(info["path"]).name)  # git forgot the worktree; its directory is still there
    return info


def test_an_orphaned_workspace_is_listed_and_can_be_finished_with_the_two_phase_removal(svc, repo, oh_env):
    info = orphan(svc, repo)
    listed = {i["id"]: i for i in svc.list(str(repo.path))}
    assert listed[info["id"]]["state"] == "orphaned" and listed[info["id"]]["orphaned"] and listed[info["id"]]["managed"]
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["orphaned"] and report["removable"] and report["confirmation_token"]
    assert "left-over.txt" in report["leftover"]["paths"]
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], "1.deadbeef")
    assert caught.value.code == "confirmation_invalid" and os.path.isdir(info["path"])
    result = svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert result["removed"] and result["orphaned"] and not os.path.lexists(info["path"])
    assert info["id"] not in ids(svc, repo)
    assert not any(json.loads(state_file(oh_env).read_text(encoding="utf-8"))["workspaces"].values())


def test_an_orphan_cannot_be_selected(svc, repo):
    info = orphan(svc, repo)
    with pytest.raises(WorkspaceError) as caught:
        svc.select(str(repo.path), info["id"])
    assert caught.value.code in {"workspace_missing", "workspace_not_selectable"}


def test_the_orphan_confirmation_goes_stale_when_the_leftovers_change(svc, repo):
    info = orphan(svc, repo)
    report = svc.removal_check(str(repo.path), info["id"])
    Path(info["path"], "another.txt").write_text("new\n", encoding="utf-8")
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.details["reason"] == "stale" and os.path.isdir(info["path"])


def test_cleaning_an_orphan_never_follows_a_link_inside_it(svc, repo, outside):
    info = orphan(svc, repo)
    sub = Path(info["path"], "cache")
    sub.mkdir()
    make_dir_link(sub / "linked", outside.path)
    report = svc.removal_check(str(repo.path), info["id"])
    assert [link["path"] for link in report["links"]] == ["cache/linked"]
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()
    assert not os.path.lexists(info["path"])


def test_an_orphan_directory_that_is_itself_a_link_is_unlinked_not_followed(svc, repo, outside):
    info = orphan(svc, repo, dirty=False)
    shutil.rmtree(info["path"])
    make_dir_link(info["path"], outside.path)
    report = svc.removal_check(str(repo.path), info["id"])
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()
    assert not os.path.lexists(info["path"])


def test_a_forged_record_pointing_outside_the_managed_root_is_never_offered_for_cleaning(svc, repo, oh_env, outside):
    svc.create(str(repo.path), "main")
    data = json.loads(state_file(oh_env).read_text(encoding="utf-8"))
    key = next(iter(data["workspaces"]))
    data["workspaces"][key]["ws-ffffffffffffffff"] = {"id": "ws-ffffffffffffffff", "path": str(outside.path), "branch": None}
    state_file(oh_env).write_text(json.dumps(data), encoding="utf-8")
    assert "ws-ffffffffffffffff" not in ids(svc, repo)
    with pytest.raises(WorkspaceError) as caught:
        svc.removal_check(str(repo.path), "ws-ffffffffffffffff")
    assert caught.value.code == "workspace_not_found"
    outside.assert_intact()


def test_the_orphan_is_visible_over_http(oh_env, repo):
    client = TestClient(app)
    made = client.post("/workspaces", json={"repo": str(repo.path), "ref": "main"}).json()
    shutil.rmtree(repo.path / ".git" / "worktrees" / Path(made["path"]).name)
    listed = client.get("/workspaces", params={"repo": str(repo.path)}).json()["workspaces"]
    assert [w["state"] for w in listed if w["id"] == made["id"]] == ["orphaned"]
    check = client.post(f"/workspaces/{made['id']}/removal-check", json={"repo": str(repo.path)}).json()
    done = client.post(f"/workspaces/{made['id']}/remove", json={"repo": str(repo.path), "confirmation_token": check["confirmation_token"]})
    assert done.status_code == 200 and not os.path.lexists(made["path"])


@pytest.mark.skipif(sys.platform != "win32", reason="an open file blocks deletion only on Windows")
def test_a_removal_that_fails_halfway_leaves_something_that_can_be_finished(svc, repo, runner):
    from workspaces_support import Repo
    repo.write(".gitignore", "ign/\n")
    repo.git("add", ".gitignore")
    repo.git("commit", "-q", "-m", "ignore")
    repo.write("z/keep.txt", "k\n")
    repo.git("add", "z/keep.txt")
    repo.git("commit", "-q", "-m", "z")
    info = svc.create(str(repo.path), "main", branch="halfway")
    w = Repo(Path(info["path"]), runner)
    w.write("a.txt", "changed\n")
    report = svc.removal_check(str(repo.path), info["id"])
    held = open(Path(info["path"]) / "z" / "keep.txt", "rb")  # Windows will not let git delete a file that is open
    try:
        with pytest.raises(WorkspaceError) as caught:
            svc.remove(str(repo.path), info["id"], report["confirmation_token"])
        assert caught.value.code == "remove_failed"
        later = svc.removal_check(str(repo.path), info["id"])  # was workspace_not_found: the record lingered and nothing could finish it
        assert later["removable"]
    finally:
        held.close()
    svc.remove(str(repo.path), info["id"], svc.removal_check(str(repo.path), info["id"])["confirmation_token"])
    assert not os.path.lexists(info["path"]) and info["id"] not in ids(svc, repo)
