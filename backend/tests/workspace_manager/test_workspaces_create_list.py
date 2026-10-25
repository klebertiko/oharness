"""Creating a worktree from a chosen ref, and listing every workspace of a repository in every state."""
from __future__ import annotations

import os
import shutil
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest

from workspaces.errors import WorkspaceError
from workspaces.gitrun import GitFailure
from workspaces.paths import canonical
from workspaces.service import WorkspaceService
from workspaces.store import StateStore
from workspaces_support import Repo


@pytest.fixture
def svc(oh_env, runner):
    return WorkspaceService(oh_env.settings, runner)


def by_id(infos, ident):
    return next(i for i in infos if i["id"] == ident)


def managed_dirs(oh_env):
    root = oh_env.settings.managed_root
    return [p for repo_dir in root.iterdir() for p in repo_dir.iterdir()] if root.exists() else []


# --------------------------------------------------------------------------- create


def test_create_from_a_branch_makes_a_detached_worktree_outside_the_repo(svc, repo, oh_env):
    info = svc.create(str(repo.path), "main")
    head = repo.out("rev-parse", "HEAD")
    assert info["head"] == head and info["detached"] and info["branch"] is None
    assert info["managed"] and info["kind"] == "linked" and info["id"].startswith("ws-")
    path = info["path"]
    assert os.path.isfile(os.path.join(path, "README.md"))
    assert canonical(path).startswith(canonical(oh_env.settings.managed_root) + os.sep)
    assert not canonical(path).startswith(canonical(repo.path) + os.sep)


def test_create_from_a_tag(svc, repo):
    first = repo.out("rev-parse", "HEAD")
    repo.git("tag", "v1")
    repo.commit("later.txt")
    info = svc.create(str(repo.path), "v1")
    assert info["head"] == first and not os.path.exists(os.path.join(info["path"], "later.txt"))


def test_create_from_a_commit_id_full_or_abbreviated(svc, repo):
    first = repo.out("rev-parse", "HEAD")
    repo.commit("later.txt")
    outcome = svc.create(str(repo.path), first)
    assert outcome["head"] == first
    outcome = svc.create(str(repo.path), first[:9])
    assert outcome["head"] == first


def test_create_with_a_new_branch(svc, repo):
    info = svc.create(str(repo.path), "main", branch="feature/x")
    assert info["branch"] == "feature/x" and not info["detached"]
    assert repo.out("rev-parse", "refs/heads/feature/x") == info["head"]


def test_a_missing_ref_is_not_found_and_leaves_nothing_behind(svc, repo, oh_env):
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(repo.path), "no-such-ref")
    assert caught.value.code == "ref_not_found" and caught.value.status == 404
    assert managed_dirs(oh_env) == [] and StateStore(oh_env.settings.state_path).read()["workspaces"] == {}


@pytest.mark.parametrize("ref", [
    "--upload-pack=touch pwned", "-x", "--force", "--end-of-options", "a;touch pwned", "$(touch pwned)", "`touch pwned`",
    "main;touch pwned", "main\ntouch pwned", "ração", "💥", "main^{tree}", "HEAD~1", "refs/heads/..",
])
def test_hostile_refs_never_reach_git_as_options_or_commands(svc, repo, oh_env, ref):
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(repo.path), ref)
    assert caught.value.code in {"invalid_ref", "ref_not_found"}
    assert not (repo.path / "pwned").exists() and not (oh_env.tmp / "pwned").exists()
    assert managed_dirs(oh_env) == []


@pytest.mark.parametrize("branch", ["-x", "--force", "--orphan", "a;b", "$(touch pwned)", "a b", "a..b", "x@{u}", "HEAD", ""])
def test_hostile_branch_names_are_refused(svc, repo, branch):
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(repo.path), "main", branch=branch)
    assert caught.value.code == "invalid_branch"


def test_unicode_branch_name_is_data(svc, repo):
    info = svc.create(str(repo.path), "main", branch="ração-é")
    assert info["branch"] == "ração-é"


def test_an_existing_branch_is_a_conflict(svc, repo, oh_env):
    repo.git("branch", "taken")
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(repo.path), "main", branch="taken")
    assert caught.value.code == "branch_exists" and caught.value.status == 409
    assert managed_dirs(oh_env) == []


def test_an_id_collision_is_retried_and_then_reported(svc, repo, monkeypatch):
    first = svc.create(str(repo.path), "main")
    monkeypatch.setattr(svc, "_new_id", lambda: first["id"])
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(repo.path), "main")
    assert caught.value.code == "id_collision" and caught.value.status == 409
    ids = iter([first["id"], first["id"], "ws-00000000000000aa"])
    monkeypatch.setattr(svc, "_new_id", lambda: next(ids))
    outcome = svc.create(str(repo.path), "main")
    assert outcome["id"] == "ws-00000000000000aa"


@pytest.mark.parametrize("bad", ["", "relative/path", "\\\\server\\share\\r", "x\0y", "C:", "missing-dir"])
def test_the_source_repository_must_be_a_real_absolute_directory(svc, oh_env, bad):
    target = str(oh_env.tmp / "missing-dir") if bad == "missing-dir" else bad
    with pytest.raises(WorkspaceError) as caught:
        svc.create(target, "main")
    assert caught.value.code in {"invalid_repo", "not_a_repository"}


def test_a_directory_that_is_not_a_repository_is_refused(svc, oh_env):
    plain = oh_env.tmp / "plain"
    plain.mkdir()
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(plain), "main")
    assert caught.value.code == "not_a_repository"


def test_a_managed_root_inside_the_repository_is_refused(runner, repo, monkeypatch):
    inside = repo.path / "ws-data"
    monkeypatch.setenv("OH_WORKSPACES_HOME", str(inside))
    from workspaces.config import Settings
    with pytest.raises(WorkspaceError) as caught:
        WorkspaceService(Settings.from_env(), runner).create(str(repo.path), "main")
    assert caught.value.code == "unsafe_destination"
    assert not (repo.path / "ws-data" / "worktrees").exists() or not any((repo.path / "ws-data" / "worktrees").iterdir())


def test_a_source_repository_inside_the_managed_root_is_refused(runner, oh_env):
    from workspaces.service import WorkspaceService as S
    nested = oh_env.settings.managed_root / "somewhere" / "clone"
    nested.mkdir(parents=True)
    clone = Repo(nested, runner)
    clone.git("init", "-q", "-b", "main")
    clone.commit("a.txt")
    with pytest.raises(WorkspaceError) as caught:
        S(oh_env.settings, runner).create(str(nested), "main")
    assert caught.value.code == "unsafe_destination"


def test_a_repository_that_defines_filters_and_hooks_cannot_run_them_on_create(svc, repo, marker_bench):
    repo.write(".gitattributes", "* filter=evil\n")
    repo.git("add", ".gitattributes")
    repo.git("commit", "-q", "-m", "attrs")
    for name in ("smudge", "clean", "process"):
        repo.git("config", f"filter.evil.{name}", marker_bench.command(name))
    hook = repo.path / ".git" / "hooks" / "post-checkout"
    hook.write_text(f"#!/bin/sh\n{marker_bench.command('hook')}\n", encoding="utf-8", newline="\n")
    hook.chmod(0o755)
    info = svc.create(str(repo.path), "main")
    assert os.path.isfile(os.path.join(info["path"], "README.md"))
    assert marker_bench.ran() == []


def test_a_failed_registration_rolls_everything_back(svc, repo, oh_env, monkeypatch):
    def broken(self, change):
        raise OSError("disk full")

    monkeypatch.setattr(StateStore, "mutate", broken)
    with pytest.raises(OSError):
        svc.create(str(repo.path), "main", branch="rollback-me")
    monkeypatch.undo()
    assert len([l for l in repo.out("worktree", "list", "--porcelain").splitlines() if l.startswith("worktree ")]) == 1
    assert repo.git("rev-parse", "--verify", "--quiet", "refs/heads/rollback-me", check=False).returncode != 0
    assert managed_dirs(oh_env) == []
    root = oh_env.settings.managed_root
    assert not root.exists() or list(root.iterdir()) == []


def test_a_failed_worktree_add_cleans_up_and_registers_nothing(svc, repo, oh_env, runner, monkeypatch):
    real = runner.run

    def failing(cwd, args, **kw):
        if list(args[:2]) == ["worktree", "add"]:
            raise GitFailure(list(args), 128, "fatal: simulated checkout failure")
        return real(cwd, args, **kw)

    monkeypatch.setattr(runner, "run", failing)
    with pytest.raises(WorkspaceError) as caught:
        svc.create(str(repo.path), "main", branch="never-made")
    assert caught.value.code == "worktree_add_failed"
    monkeypatch.undo()
    assert repo.git("rev-parse", "--verify", "--quiet", "refs/heads/never-made", check=False).returncode != 0
    assert StateStore(oh_env.settings.state_path).read()["workspaces"] == {}
    root = oh_env.settings.managed_root
    assert not root.exists() or list(root.iterdir()) == []


def test_concurrent_creates_for_distinct_workspaces_all_succeed(svc, repo, oh_env):
    with ThreadPoolExecutor(6) as pool:
        infos = list(pool.map(lambda n: svc.create(str(repo.path), "main"), range(6)))
    assert len({i["id"] for i in infos}) == 6 and len({i["path"] for i in infos}) == 6
    listed = svc.list(str(repo.path))
    assert len(listed) == 7
    registry = StateStore(oh_env.settings.state_path).read()["workspaces"]
    assert sum(len(group) for group in registry.values()) == 6


def test_concurrent_creates_of_the_same_branch_yield_exactly_one_winner(svc, repo):
    results, barrier = [], threading.Barrier(2)

    def attempt(_):
        barrier.wait()
        try:
            return svc.create(str(repo.path), "main", branch="contended")
        except WorkspaceError as exc:
            return exc

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(attempt, range(2)))
    assert sum(isinstance(r, dict) for r in results) == 1
    loser = next(r for r in results if isinstance(r, WorkspaceError))
    assert loser.code == "branch_exists"


# --------------------------------------------------------------------------- list


def test_the_principal_worktree_is_listed_first_and_clean(svc, repo):
    (main,) = svc.list(str(repo.path))
    assert main["id"] == "main" and main["kind"] == "main" and not main["managed"]
    assert main["branch"] == "main" and main["head"] == repo.out("rev-parse", "HEAD")
    assert main["state"] == "clean" and not main["dirty"] and main["changes"] == {"modified": 0, "staged": 0, "untracked": 0, "conflicted": 0}
    assert not main["locked"] and not main["prunable"] and not main["missing"] and not main["selected"]
    assert canonical(main["path"]) == canonical(repo.path)


def test_listing_from_a_linked_worktree_or_a_subdirectory_resolves_the_same_repository(svc, repo):
    info = svc.create(str(repo.path), "main")
    (repo.path / "sub").mkdir()
    assert {i["id"] for i in svc.list(info["path"])} == {i["id"] for i in svc.list(str(repo.path / "sub"))} == {"main", info["id"]}


def test_modified_staged_and_untracked_are_counted_per_workspace(svc, repo):
    info = svc.create(str(repo.path), "main")
    wt = info["path"]
    with open(os.path.join(wt, "README.md"), "a", encoding="utf-8") as handle:
        handle.write("edit\n")
    with open(os.path.join(wt, "staged.txt"), "w", encoding="utf-8") as handle:
        handle.write("s\n")
    repo.git("add", "staged.txt", cwd=wt)
    with open(os.path.join(wt, "new.txt"), "w", encoding="utf-8") as handle:
        handle.write("u\n")
    listed = svc.list(str(repo.path))
    entry = by_id(listed, info["id"])
    assert entry["state"] == "dirty" and entry["dirty"]
    assert entry["changes"] == {"modified": 1, "staged": 1, "untracked": 1, "conflicted": 0}
    assert by_id(listed, "main")["state"] == "clean"


def test_a_detached_worktree_reports_no_branch(svc, repo):
    info = svc.create(str(repo.path), "main")
    entry = by_id(svc.list(str(repo.path)), info["id"])
    assert entry["detached"] and entry["branch"] is None and entry["head"] == info["head"]


def test_a_locked_worktree_is_reported_with_its_reason(svc, repo):
    info = svc.create(str(repo.path), "main")
    repo.git("worktree", "lock", "--reason", "on a usb stick", "--", info["path"])
    entry = by_id(svc.list(str(repo.path)), info["id"])
    assert entry["locked"] and entry["lock_reason"] == "on a usb stick"


def test_a_directory_deleted_behind_our_back_is_missing_and_prunable(svc, repo):
    info = svc.create(str(repo.path), "main")
    shutil.rmtree(info["path"])
    entry = by_id(svc.list(str(repo.path)), info["id"])
    assert entry["missing"] and entry["prunable"] and entry["state"] == "missing" and entry["managed"]
    assert entry["changes"] is None


def test_registry_entries_for_pruned_worktrees_are_garbage_collected(svc, repo, oh_env):
    info = svc.create(str(repo.path), "main")
    shutil.rmtree(info["path"])
    repo.git("worktree", "prune")
    assert [i["id"] for i in svc.list(str(repo.path))] == ["main"]
    state = StateStore(oh_env.settings.state_path).read()
    assert all(not group for group in state["workspaces"].values())


def test_worktrees_made_outside_the_manager_are_listed_but_not_managed(svc, repo, oh_env):
    other = oh_env.tmp / "hand-made"
    repo.git("worktree", "add", "--detach", "--", str(other))
    entry = next(i for i in svc.list(str(repo.path)) if i["kind"] == "linked")
    assert entry["id"].startswith("ext-") and not entry["managed"]
    assert canonical(entry["path"]) == canonical(other)


def test_a_generated_id_worktree_of_this_repository_is_adopted_when_the_registry_is_empty(svc, repo, oh_env):
    created = svc.create(str(repo.path), "main")
    StateStore(oh_env.settings.state_path).mutate(lambda s: s["workspaces"].clear())
    entry = next(i for i in svc.list(str(repo.path)) if i["kind"] == "linked")
    assert entry["managed"] and entry["id"] == created["id"]


def test_a_hand_made_worktree_under_the_managed_root_is_not_managed(svc, repo, oh_env):
    svc.create(str(repo.path), "main")  # makes the repository directory under the root
    repo_dir = next(p for p in oh_env.settings.managed_root.iterdir())
    repo.git("worktree", "add", "--detach", "--", str(repo_dir / "hand-made"), "HEAD")
    entry = next(i for i in svc.list(str(repo.path)) if i["path"].endswith("hand-made"))
    assert not entry["managed"] and entry["id"].startswith("ext-")
