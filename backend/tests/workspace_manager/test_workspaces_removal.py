"""Two-phase removal: a report and a state-bound token first, a confirmed removal that preserves pending work second."""
from __future__ import annotations

import os
import shutil
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from workspaces import removal as removal_module
from workspaces.errors import WorkspaceError
from workspaces.paths import canonical
from workspaces.service import WorkspaceService
from workspaces.store import StateStore
from workspaces_support import Repo


@pytest.fixture
def svc(oh_env, runner):
    return WorkspaceService(oh_env.settings, runner)


@pytest.fixture
def wt(svc, repo, runner):
    """A managed worktree on a new branch, plus a handle to drive git inside it."""
    info = svc.create(str(repo.path), "main", branch="work")
    return info, Repo(Path(info["path"]), runner)


def listed_ids(svc, repo):
    return [i["id"] for i in svc.list(str(repo.path))]


def ref_exists(repo, ref):
    return repo.git("rev-parse", "--verify", "--quiet", ref, check=False).returncode == 0


def tree_files(repo, ref):
    names = repo.git("ls-tree", "-r", "-z", "--name-only", ref).stdout.decode("utf-8").split("\0")
    return {n for n in names if n}


def blob(repo, ref, path) -> bytes:
    return repo.git("cat-file", "blob", f"{ref}:{path}").stdout


def go(svc, repo, ident, **kw):
    report = svc.removal_check(str(repo.path), ident)
    return report, svc.remove(str(repo.path), ident, report["confirmation_token"], **kw)


# ----------------------------------------------------------------------- clean worktrees


def test_a_clean_worktree_is_removed_directly_after_confirmation(svc, repo, wt):
    info, _ = wt
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["removable"] and not report["pending_work"] and not report["will_preserve"] and report["rescue_ref"] is None
    assert report["changes"]["modified"] == report["changes"]["staged"] == report["changes"]["untracked"] == 0
    assert report["unpushed"]["count"] == 0 and not report["locked"] and report["confirmation_token"]
    result = svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert result["removed"] and result["rescue"] is None and result["branch_kept"] == "work"
    assert listed_ids(svc, repo) == ["main"] and not os.path.exists(info["path"])
    assert ref_exists(repo, "refs/heads/work")
    assert not any(StateStore(svc.settings.state_path).read()["workspaces"].values())
    assert not any(ref.startswith("refs/openharness/rescue/") for ref in repo.out("for-each-ref", "--format=%(refname)").splitlines())


def test_ignored_files_are_reported_but_do_not_block_a_clean_removal(svc, repo):
    repo.write(".gitignore", "*.log\n")
    repo.git("add", ".gitignore")
    repo.git("commit", "-q", "-m", "ignore")
    info = svc.create(str(repo.path), "main")
    Path(info["path"], "build.log").write_text("noise", encoding="utf-8")
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["changes"]["ignored_entries"] == 1 and not report["pending_work"]
    outcome = svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert outcome["removed"]
    assert not os.path.exists(info["path"])


def test_removing_the_selected_workspace_clears_the_selection_but_not_others(svc, repo):
    a, b = svc.create(str(repo.path), "main"), svc.create(str(repo.path), "main")
    svc.select(str(repo.path), a["id"])
    go(svc, repo, b["id"])
    assert svc.selected()["selected"]["id"] == a["id"]
    go(svc, repo, a["id"])
    assert svc.selected() == {"selected": None, "cwd": None, "stale": None}


def test_a_worktree_whose_directory_vanished_is_removable_and_forgotten(svc, repo):
    info = svc.create(str(repo.path), "main")
    shutil.rmtree(info["path"])
    report, result = go(svc, repo, info["id"])
    assert report["removable"] and not report["pending_work"] and result["removed"]
    assert listed_ids(svc, repo) == ["main"]


# ----------------------------------------------------------------------- pending work is preserved


def make_dirty(wt_handle):
    info, w = wt_handle
    w.write("README.md", "hello\nedited\n")                    # modified
    w.write("staged.txt", "staged only\n")
    w.git("add", "staged.txt")                                  # staged
    w.write("untracked/new file.txt", "untracked body\n")       # untracked
    w.write("gone.txt", "will be staged then deleted\n")
    w.git("add", "gone.txt")
    os.remove(os.path.join(info["path"], "gone.txt"))           # staged content no longer in the work tree
    return w


def test_dirty_worktree_report_counts_everything_and_promises_a_rescue(svc, repo, wt):
    make_dirty(wt)
    report = svc.removal_check(str(repo.path), wt[0]["id"])
    changes = report["changes"]
    assert (changes["modified"], changes["untracked"]) == (2, 1) and changes["staged"] == 2
    assert report["pending_work"] and report["will_preserve"] and report["rescue_ref"] == f"refs/openharness/rescue/{wt[0]['id']}"
    assert {p["path"] for p in changes["paths"]} >= {"README.md", "staged.txt", "untracked/new file.txt"}


def test_confirmed_removal_keeps_modified_staged_and_untracked_work_on_a_rescue_ref(svc, repo, wt):
    info, w = wt
    make_dirty(wt)
    _, result = go(svc, repo, info["id"])
    ref = result["rescue"]["ref"]
    assert ref == f"refs/openharness/rescue/{info['id']}" and not os.path.exists(info["path"])
    assert blob(repo, ref, "README.md") == b"hello\nedited\n"
    assert blob(repo, ref, "untracked/new file.txt") == b"untracked body\n"
    assert blob(repo, ref, "staged.txt") == b"staged only\n"
    assert blob(repo, f"{ref}^", "gone.txt") == b"will be staged then deleted\n"   # the index snapshot keeps what was only staged
    assert any("git" in line and ref in line for line in result["rescue"]["recover"])
    assert result["rescue"]["verified_paths"] >= 3
    assert listed_ids(svc, repo) == ["main"]


def test_the_rescue_is_made_without_touching_the_users_index_or_files(svc, repo, wt):
    info, w = wt
    make_dirty(wt)
    ctx = svc._open(str(repo.path))
    entry = next(e for e in svc._worktrees(ctx) if canonical(e.path) == canonical(info["path"]))
    index = Path(w.out("rev-parse", "--path-format=absolute", "--git-path", "index"))
    before = (index.read_bytes(), w.git("status", "--porcelain=v2", "-z").stdout)
    svc._create_rescue(ctx, entry, svc._inspect(ctx, entry)["state"], info["id"])
    assert (index.read_bytes(), w.git("status", "--porcelain=v2", "-z").stdout) == before


def test_the_rescue_keeps_file_bytes_exactly_even_with_eol_attributes(svc, repo, wt):
    info, w = wt
    w.write(".gitattributes", "* text eol=lf\n")
    crlf = b"line one\r\nline two\r\n"
    Path(info["path"], "crlf.txt").write_bytes(crlf)
    _, result = go(svc, repo, info["id"])
    assert blob(repo, result["rescue"]["ref"], "crlf.txt") == crlf


def test_removal_is_refused_when_the_work_cannot_be_preserved(svc, repo, wt, monkeypatch):
    info, w = wt
    make_dirty(wt)
    monkeypatch.setattr(svc, "_create_rescue", lambda *a, **k: (_ for _ in ()).throw(WorkspaceError("preservation_failed", "no", 409)))
    report = svc.removal_check(str(repo.path), info["id"])
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "preservation_failed" and caught.value.status == 409
    assert os.path.isfile(os.path.join(info["path"], "README.md")) and os.path.isfile(os.path.join(info["path"], "untracked", "new file.txt"))
    assert info["id"] in listed_ids(svc, repo)


def test_removal_is_refused_when_the_rescue_does_not_contain_a_changed_file(svc, repo, wt, monkeypatch):
    info, w = wt
    make_dirty(wt)
    monkeypatch.setattr(svc, "_snapshot", lambda ctx, entry, ident, links=None: (repo.out("rev-parse", "main"), None))   # a snapshot that lost the work
    report = svc.removal_check(str(repo.path), info["id"])
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "preservation_failed"
    assert os.path.isfile(os.path.join(info["path"], "untracked", "new file.txt"))
    assert not any(r.startswith("refs/openharness/rescue/") for r in repo.out("for-each-ref", "--format=%(refname)").splitlines())


def test_commits_that_exist_only_in_the_worktree_are_reported_and_preserved(svc, repo, wt):
    info, w = wt
    sha = w.commit("feature.txt", "work\n", "feature work")
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["unpushed"]["count"] == 1 and report["unpushed"]["commits"][0]["sha"] == sha
    assert report["unpushed"]["commits"][0]["subject"] == "feature work" and not report["unpushed"]["has_upstream"]
    assert report["pending_work"] and report["will_preserve"] and report["changes"]["modified"] == 0
    _, result = go(svc, repo, info["id"])
    assert repo.out("rev-parse", result["rescue"]["ref"]) == sha and ref_exists(repo, "refs/heads/work")


def test_commits_made_on_a_detached_head_are_preserved(svc, repo):
    info = svc.create(str(repo.path), "main")
    w = Repo(Path(info["path"]), repo.runner)
    sha = w.commit("loose.txt", "only here\n", "detached work")
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["unpushed"]["count"] == 1 and report["unpushed"]["branch"] is None
    _, result = go(svc, repo, info["id"])
    assert repo.out("rev-parse", result["rescue"]["ref"]) == sha
    assert blob(repo, result["rescue"]["ref"], "loose.txt") == b"only here\n"


def test_commits_already_on_an_upstream_or_another_branch_are_not_unpushed(svc, repo, wt):
    info, w = wt
    sha = w.commit("shared.txt", "x\n")
    repo.git("config", "remote.origin.url", "https://example.invalid/r.git")
    repo.git("config", "remote.origin.fetch", "+refs/heads/*:refs/remotes/origin/*")
    repo.git("config", "branch.work.remote", "origin")
    repo.git("config", "branch.work.merge", "refs/heads/work")
    repo.git("update-ref", "refs/remotes/origin/work", sha)
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["unpushed"]["count"] == 0 and report["unpushed"]["has_upstream"] and not report["pending_work"]
    w.commit("ahead.txt", "y\n")
    assert svc.removal_check(str(repo.path), info["id"])["unpushed"]["count"] == 1


def test_an_existing_rescue_ref_is_never_overwritten(svc, repo, wt):
    info, w = wt
    marker = repo.out("rev-parse", "main")
    repo.git("update-ref", f"refs/openharness/rescue/{info['id']}", marker)
    w.write("untracked.txt", "u\n")
    _, result = go(svc, repo, info["id"])
    assert result["rescue"]["ref"] != f"refs/openharness/rescue/{info['id']}"
    assert repo.out("rev-parse", f"refs/openharness/rescue/{info['id']}") == marker


# ----------------------------------------------------------------------- the confirmation token


def test_a_token_goes_stale_when_the_work_tree_changes_between_the_phases(svc, repo, wt):
    info, w = wt
    w.write("README.md", "first edit\n")
    report = svc.removal_check(str(repo.path), info["id"])
    w.write("another.txt", "appeared after the check\n")
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.status == 409 and caught.value.code == "confirmation_invalid" and caught.value.details["reason"] == "stale"
    assert os.path.isfile(os.path.join(info["path"], "another.txt"))


def test_re_editing_an_already_modified_file_also_stales_the_token(svc, repo, wt):
    info, w = wt
    w.write("README.md", "edit one\n")
    report = svc.removal_check(str(repo.path), info["id"])
    time.sleep(0.05)
    w.write("README.md", "edit two, longer than before\n")
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "confirmation_invalid"


def test_a_new_commit_or_lock_between_the_phases_stales_the_token(svc, repo, wt):
    info, w = wt
    report = svc.removal_check(str(repo.path), info["id"])
    w.commit("late.txt")
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "confirmation_invalid"
    fresh = svc.removal_check(str(repo.path), info["id"])
    repo.git("worktree", "lock", "--", info["path"])
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], fresh["confirmation_token"], release_lock=True)
    assert caught.value.code == "confirmation_invalid"


@pytest.mark.parametrize("token", ["", "garbage", "1.2", "9999999999.deadbeef", "0." + "0" * 64])
def test_forged_or_malformed_tokens_are_refused(svc, repo, wt, token):
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), wt[0]["id"], token)
    assert caught.value.status == 409 and caught.value.code == "confirmation_invalid"
    assert os.path.isdir(wt[0]["path"])


def test_a_token_from_another_workspace_does_not_work(svc, repo):
    a, b = svc.create(str(repo.path), "main"), svc.create(str(repo.path), "main")
    token = svc.removal_check(str(repo.path), a["id"])["confirmation_token"]
    with pytest.raises(WorkspaceError):
        svc.remove(str(repo.path), b["id"], token)
    assert os.path.isdir(b["path"])


def test_an_expired_token_is_refused(svc, repo, wt, monkeypatch):
    report = svc.removal_check(str(repo.path), wt[0]["id"])
    real = time.time
    monkeypatch.setattr(removal_module.time, "time", lambda: real() + 3600)
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), wt[0]["id"], report["confirmation_token"])
    assert caught.value.code == "confirmation_invalid" and caught.value.details["reason"] == "expired"


def test_a_token_is_single_use(svc, repo, wt):
    report, _ = go(svc, repo, wt[0]["id"])
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), wt[0]["id"], report["confirmation_token"])
    assert caught.value.code == "workspace_not_found"


# ----------------------------------------------------------------------- what may never be removed


def test_the_principal_worktree_is_protected(svc, repo):
    report = svc.removal_check(str(repo.path), "main")
    assert not report["removable"] and report["blockers"] == ["principal"] and report["confirmation_token"] is None
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), "main", "anything")
    assert caught.value.status == 403 and caught.value.code == "protected_workspace"
    assert (repo.path / "README.md").is_file()


def test_a_worktree_outside_the_managed_root_is_protected(svc, repo, oh_env):
    other = oh_env.tmp / "hand-made"
    repo.git("worktree", "add", "--detach", "--", str(other))
    ident = next(i["id"] for i in svc.list(str(repo.path)) if i["kind"] == "linked")
    report = svc.removal_check(str(repo.path), ident)
    assert not report["removable"] and "not_managed" in report["blockers"]
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), ident, "anything")
    assert caught.value.status == 403 and (other / "README.md").is_file()


def test_a_forged_registry_entry_pointing_outside_the_root_does_not_make_a_worktree_managed(svc, repo, oh_env):
    other = oh_env.tmp / "outside-tree"
    repo.git("worktree", "add", "--detach", "--", str(other))
    key = svc._open(str(repo.path)).key
    forged = {"id": "ws-0123456789abcdef", "path": str(other), "branch": None, "base_ref": "main", "base_commit": "0" * 40, "created_at": "x"}
    StateStore(svc.settings.state_path).mutate(lambda s: s["workspaces"].setdefault(key, {}).update({forged["id"]: forged}))
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), forged["id"], "anything")
    assert caught.value.code in {"workspace_not_found", "protected_workspace"} and (other / "README.md").is_file()


def test_a_managed_path_replaced_by_a_junction_is_never_followed(svc, repo, oh_env):
    info = svc.create(str(repo.path), "main")
    outside = oh_env.tmp / "precious"
    outside.mkdir()
    (outside / "keep.txt").write_text("keep", encoding="utf-8")
    shutil.rmtree(info["path"])
    if sys.platform == "win32":
        import _winapi
        _winapi.CreateJunction(str(outside), info["path"])
    else:
        try:
            os.symlink(outside, info["path"], target_is_directory=True)
        except OSError:
            pytest.skip("cannot create links here")
    with pytest.raises(WorkspaceError) as caught:
        go(svc, repo, info["id"])
    assert caught.value.code in {"unsafe_destination", "protected_workspace", "workspace_not_found"}
    assert (outside / "keep.txt").read_text(encoding="utf-8") == "keep"


def test_a_locked_worktree_needs_an_explicit_release(svc, repo, wt):
    info, _ = wt
    repo.git("worktree", "lock", "--reason", "keep me", "--", info["path"])
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["locked"] and report["lock_reason"] == "keep me" and report["needs_lock_release"]
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "workspace_locked" and caught.value.status == 409
    assert os.path.isdir(info["path"])
    outcome = svc.remove(str(repo.path), info["id"], report["confirmation_token"], release_lock=True)
    assert outcome["removed"]
    assert not os.path.exists(info["path"])


def test_removing_an_unknown_workspace_is_not_found(svc, repo):
    with pytest.raises(WorkspaceError) as caught:
        svc.removal_check(str(repo.path), "ws-0000000000000000")
    assert caught.value.code == "workspace_not_found"


def test_two_simultaneous_removals_of_the_same_workspace_remove_it_once(svc, repo):
    info = svc.create(str(repo.path), "main")
    token = svc.removal_check(str(repo.path), info["id"])["confirmation_token"]

    def attempt(_):
        try:
            return svc.remove(str(repo.path), info["id"], token)
        except WorkspaceError as exc:
            return exc

    with ThreadPoolExecutor(2) as pool:
        outcomes = list(pool.map(attempt, range(2)))
    assert sum(isinstance(o, dict) for o in outcomes) == 1
    assert listed_ids(svc, repo) == ["main"]


# ----------------------------------------------------------------------- content git cannot carry into a rescue


def test_an_untracked_nested_repository_blocks_removal_because_a_rescue_cannot_hold_its_history(svc, repo, wt):
    info, w = wt
    nested = Path(info["path"]) / "vendor-clone"
    nested.mkdir()
    inner = Repo(nested, w.runner)
    inner.git("init", "-q", "-b", "main")
    inner.commit("inner.txt", "their work\n")
    report = svc.removal_check(str(repo.path), info["id"])
    assert not report["removable"] and "nested_repository" in report["blockers"] and report["confirmation_token"] is None
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], "anything")
    assert caught.value.status == 403 and (nested / "inner.txt").is_file()


def test_an_initialized_submodule_blocks_removal(svc, repo, runner):
    repo.git("update-index", "--add", "--cacheinfo", f"160000,{repo.out('rev-parse', 'HEAD')},sub")
    repo.git("commit", "-q", "-m", "gitlink")
    info = svc.create(str(repo.path), "main")
    sub = Path(info["path"]) / "sub"
    sub.mkdir(exist_ok=True)
    inner = Repo(sub, runner)
    inner.git("init", "-q", "-b", "main")
    inner.commit("work.txt", "uncommitted elsewhere\n")
    report = svc.removal_check(str(repo.path), info["id"])
    assert not report["removable"] and "submodules" in report["blockers"]
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], "anything")
    assert caught.value.status == 403 and (sub / "work.txt").is_file()


def test_the_administrative_directory_is_reconfirmed_before_it_is_deleted(svc, repo, monkeypatch):
    """Between deleting the worktree and deleting its administrative directory, the directory's ``gitdir`` is repointed (as if
    the entry had been swapped): the second deletion must refuse, leaving that directory and the neighbour's untouched."""
    info = svc.create(str(repo.path), "main", branch="swap")
    neighbour = svc.create(str(repo.path), "main", branch="neighbour")
    admin = Path(repo.out("rev-parse", "--absolute-git-dir", cwd=info["path"]))
    neighbour_admin = Path(repo.out("rev-parse", "--absolute-git-dir", cwd=neighbour["path"]))
    report = svc.removal_check(str(repo.path), info["id"])
    real = removal_module.remove_tree
    calls: list[str] = []

    def swapping(path):
        calls.append(os.fspath(path))
        real(path)
        if len(calls) == 1:  # the worktree directory is gone; its administrative directory now claims another worktree
            (admin / "gitdir").write_text(str(Path(neighbour["path"]) / ".git") + "\n", encoding="utf-8")

    monkeypatch.setattr(removal_module, "remove_tree", swapping)
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "inspection_failed"
    assert len(calls) == 1 and admin.is_dir() and neighbour_admin.is_dir() and Path(neighbour["path"]).is_dir()
