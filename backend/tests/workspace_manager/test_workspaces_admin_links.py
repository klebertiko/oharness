"""A link planted in the worktree's ADMINISTRATIVE directory (``<repo>/.git/worktrees/<id>/``) is found, reported and undone as a link.

A process inside the workspace finds that directory through the ``.git`` file, and ``git worktree remove`` deletes the admin
directory recursively, so a junction there makes git delete its target. The directory is scanned with the worktree, its links are
part of the confirmation, and a last scan right before git runs refuses the removal if a new link appeared.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from workspaces import removal as removal_module
from workspaces.errors import WorkspaceError
from workspaces_support import make_dir_link


def admin_dir(runner, worktree_path) -> Path:
    out = runner.run(worktree_path, ["rev-parse", "--absolute-git-dir"]).text().strip()
    return Path(os.path.normpath(out))


def checked(svc, repo, ident):
    return svc.removal_check(str(repo.path), ident)


@pytest.mark.parametrize("dirty", [False, True])
def test_a_link_in_the_admin_directory_is_not_followed(svc, repo, runner, outside, dirty):
    info = svc.create(str(repo.path), "main", branch="adm")
    if dirty:
        (Path(info["path"]) / "dirty.txt").write_text("w\n", encoding="utf-8")
    admin = admin_dir(runner, info["path"])
    make_dir_link(admin / "linked", outside.path)
    report = checked(svc, repo, info["id"])
    assert [link["path"] for link in report["admin_links"]] == ["linked"]
    result = svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()
    assert result["removed"] and not os.path.lexists(info["path"]) and not os.path.lexists(admin)
    assert [link["path"] for link in result["admin_links"]] == ["linked"]


def test_a_nested_link_in_the_admin_directory_is_not_followed(svc, repo, runner, outside):
    info = svc.create(str(repo.path), "main", branch="adm-deep")
    admin = admin_dir(runner, info["path"])
    (admin / "logs").mkdir(exist_ok=True)
    (admin / "logs" / "deeper").mkdir()
    make_dir_link(admin / "logs" / "deeper" / "linked", outside.path)
    report = checked(svc, repo, info["id"])
    assert [link["path"] for link in report["admin_links"]] == ["logs/deeper/linked"]
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()
    assert not os.path.lexists(info["path"])


def test_an_admin_link_planted_after_the_check_makes_the_confirmation_stale(svc, repo, runner, outside):
    info = svc.create(str(repo.path), "main", branch="adm-late")
    report = checked(svc, repo, info["id"])
    assert report["admin_links"] == []
    make_dir_link(admin_dir(runner, info["path"]) / "late", outside.path)
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "confirmation_invalid" and caught.value.details["reason"] == "stale"
    outside.assert_intact()
    assert os.path.isdir(info["path"])


def test_a_link_in_the_admin_directory_of_a_missing_worktree_is_not_followed(svc, repo, runner, outside):
    info = svc.create(str(repo.path), "main", branch="adm-missing")
    admin = admin_dir(runner, info["path"])
    make_dir_link(admin / "linked", outside.path)
    import shutil
    shutil.rmtree(info["path"])
    report = checked(svc, repo, info["id"])
    assert [link["path"] for link in report["admin_links"]] == ["linked"]
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()


def test_two_admin_directories_claiming_one_worktree_fail_closed(svc, repo, runner, outside):
    mine = svc.create(str(repo.path), "main", branch="adm-a")
    other = svc.create(str(repo.path), "main", branch="adm-b")
    # the other worktree's admin directory is rewritten to claim this worktree's path: scanning "the" admin directory would be a guess
    (admin_dir(runner, other["path"]) / "gitdir").write_text(f"{Path(mine['path']) / '.git'}" + chr(10), encoding="utf-8")
    make_dir_link(admin_dir(runner, mine["path"]) / "linked", outside.path)
    with pytest.raises(WorkspaceError) as caught:
        checked(svc, repo, mine["id"])
    assert caught.value.code == "inspection_failed"
    outside.assert_intact()


# ----------------------------------------------------------------------- the last scan, right before git runs


def test_a_link_planted_right_after_the_links_were_undone_aborts_the_removal(svc, repo, runner, outside, tmp_path, monkeypatch):
    (repo.path / ".gitignore").write_text("cache/\n", encoding="utf-8")
    repo.git("add", ".gitignore")
    repo.git("commit", "-q", "-m", "ignore")
    info = svc.create(str(repo.path), "main", branch="toctou")
    path = Path(info["path"])
    (path / "cache").mkdir()
    first = tmp_path / "first-target"
    first.mkdir()
    make_dir_link(path / "cache" / "l", first)
    report = checked(svc, repo, info["id"])
    admin = admin_dir(runner, path)
    original, planted = removal_module.unlink_link, []

    def unlink_then_plant(root, link):
        original(root, link)
        if not planted:
            planted.append(True)
            make_dir_link(admin / "late", outside.path)  # appears after the last scan, before git

    monkeypatch.setattr(removal_module, "unlink_link", unlink_then_plant)
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "unsafe_destination"
    outside.assert_intact()
    assert os.path.isdir(path)


def test_a_link_planted_while_a_locked_worktree_is_unlocked_aborts_and_relocks(svc, repo, runner, outside, monkeypatch):
    info = svc.create(str(repo.path), "main", branch="toctou-lock")
    path = Path(info["path"])
    runner.run(repo.path, ["worktree", "lock", "--reason", "keep", "--", str(path)])
    report = checked(svc, repo, info["id"])
    original = svc.runner.run

    def hook(cwd, args, **kw):
        done = original(cwd, args, **kw)
        if args[:2] == ["worktree", "unlock"]:
            make_dir_link(path / "late", outside.path)
        return done

    monkeypatch.setattr(svc.runner, "run", hook)
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"], release_lock=True)
    monkeypatch.setattr(svc.runner, "run", original)
    assert caught.value.code == "unsafe_destination"
    outside.assert_intact()
    assert os.path.isdir(path)
    assert "locked" in runner.run(repo.path, ["worktree", "list", "--porcelain"]).text()
