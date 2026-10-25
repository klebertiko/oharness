"""Links inside a worktree (junctions, symlinks) are found, reported, left out of the rescue and undone without ever being followed.

``git worktree remove`` follows a junction or symlink it finds inside the worktree and deletes the target's contents, and
``git add --all`` embeds the target's files in the rescue. Every test here ends by proving the outside directory is untouched.
"""
from __future__ import annotations

import os
from pathlib import Path

import pytest

from workspaces import removal as removal_module
from workspaces.errors import WorkspaceError
from workspaces.removal import RemovalMixin
from workspaces_support import Repo, make_dir_link, make_symlink, remove_dir_link

LEAKED_NAMES = {"secret.txt", "victim.txt", "deep.txt"}


def tree_files(repo, ref):
    names = repo.git("ls-tree", "-r", "-z", "--name-only", ref).stdout.decode("utf-8").split("\0")
    return {n for n in names if n}


def rescue_refs(repo):
    return [r for r in repo.out("for-each-ref", "--format=%(refname)").splitlines() if r.startswith("refs/openharness/rescue/")]


def go(svc, repo, ident, **kw):
    report = svc.removal_check(str(repo.path), ident)
    return report, svc.remove(str(repo.path), ident, report["confirmation_token"], **kw)


def ignore(repo, pattern):
    repo.write(".gitignore", pattern)
    repo.git("add", ".gitignore")
    repo.git("commit", "-q", "-m", "ignore")


def assert_nothing_outside_in_the_rescue(repo, result):
    leaked = {f for f in tree_files(repo, result["rescue"]["ref"]) if f.rsplit("/", 1)[-1] in LEAKED_NAMES}
    assert not leaked, leaked


# ----------------------------------------------------------------------- an untracked link, dirty worktree


def test_an_untracked_link_is_neither_followed_nor_embedded_and_is_recorded(svc, repo, wt, outside):
    info, w = wt
    make_dir_link(Path(info["path"]) / "jlink", outside.path)
    w.write("README.md", "hello\nedited\n")
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["removable"] and report["pending_work"]
    assert [link["path"] for link in report["links"]] == ["jlink"]
    assert outside.path.name in report["links"][0]["target"]
    result = svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()
    assert not os.path.lexists(info["path"])
    assert_nothing_outside_in_the_rescue(repo, result)
    files = tree_files(repo, result["rescue"]["ref"])
    assert "README.md" in files and not any(f == "jlink" or f.startswith("jlink/") for f in files)
    message = repo.out("log", "-1", "--format=%B", result["rescue"]["ref"])
    assert "jlink" in message and outside.path.name in message
    assert [link["path"] for link in result["links"]] == ["jlink"]
    assert outside.path.name in result["links"][0]["target"]


# ----------------------------------------------------------------------- an ignored link, clean worktree, no --force


def test_a_link_inside_an_ignored_directory_of_a_clean_worktree_is_unlinked_not_followed(svc, repo, outside):
    ignore(repo, "node_modules/\n")
    info = svc.create(str(repo.path), "main", branch="clean")
    nm = Path(info["path"]) / "node_modules"
    nm.mkdir()
    make_dir_link(nm / "linked", outside.path)
    report = svc.removal_check(str(repo.path), info["id"])
    assert report["removable"] and not report["pending_work"] and report["rescue_ref"] is None
    assert [link["path"] for link in report["links"]] == ["node_modules/linked"]
    result = svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()
    assert result["removed"] and result["rescue"] is None and not os.path.lexists(info["path"])


def test_a_link_buried_deep_in_the_tree_is_found(svc, repo, outside):
    ignore(repo, "build/\n")
    info = svc.create(str(repo.path), "main")
    deep = Path(info["path"]) / "build" / "a" / "b" / "c" / "d"
    deep.mkdir(parents=True)
    make_dir_link(deep / "linked", outside.path)
    report = svc.removal_check(str(repo.path), info["id"])
    assert [link["path"] for link in report["links"]] == ["build/a/b/c/d/linked"]
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()
    assert not os.path.lexists(info["path"])


def test_a_deep_link_in_a_dirty_worktree_stays_out_of_the_rescue(svc, repo, runner, outside):
    ignore(repo, "build/\n")
    info = svc.create(str(repo.path), "main", branch="dirty-deep")
    w = Repo(Path(info["path"]), runner)
    deep = Path(info["path"]) / "build" / "x" / "y"
    deep.mkdir(parents=True)
    make_dir_link(deep / "linked", outside.path)
    w.write("notes.txt", "keep me\n")
    _, result = go(svc, repo, info["id"])
    outside.assert_intact()
    assert_nothing_outside_in_the_rescue(repo, result)
    assert repo.out("show", f"{result['rescue']['ref']}:notes.txt") == "keep me"
    assert not os.path.lexists(info["path"])


def test_several_links_are_all_listed_and_all_undone(svc, repo, outside, tmp_path):
    ignore(repo, "cache/\n")
    second = tmp_path / "second-target"
    second.mkdir()
    (second / "other.txt").write_bytes(b"OTHER\n")
    info = svc.create(str(repo.path), "main")
    cache = Path(info["path"]) / "cache"
    cache.mkdir()
    make_dir_link(cache / "one", outside.path)
    make_dir_link(cache / "two", second)
    report = svc.removal_check(str(repo.path), info["id"])
    assert sorted(link["path"] for link in report["links"]) == ["cache/one", "cache/two"]
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()
    assert (second / "other.txt").read_bytes() == b"OTHER\n"


# ----------------------------------------------------------------------- real symlinks


def test_a_real_directory_symlink_is_not_followed(svc, repo, wt, outside):
    info, w = wt
    make_symlink(Path(info["path"]) / "slink", outside.path, directory=True)
    w.write("README.md", "hello\nedited\n")
    report = svc.removal_check(str(repo.path), info["id"])
    assert [link["path"] for link in report["links"]] == ["slink"]
    result = svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()
    assert_nothing_outside_in_the_rescue(repo, result)
    assert not os.path.lexists(info["path"])


def test_a_real_file_symlink_is_not_followed(svc, repo, outside):
    ignore(repo, "tmp/\n")
    info = svc.create(str(repo.path), "main")
    (Path(info["path"]) / "tmp").mkdir()
    make_symlink(Path(info["path"]) / "tmp" / "flink", outside.path / "secret.txt", directory=False)
    report = svc.removal_check(str(repo.path), info["id"])
    assert [link["path"] for link in report["links"]] == ["tmp/flink"]
    svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    outside.assert_intact()
    assert not os.path.lexists(info["path"])


# ----------------------------------------------------------------------- the confirmation covers the links


def test_a_link_created_after_the_check_makes_the_confirmation_stale(svc, repo, wt, outside):
    info, _ = wt
    report = svc.removal_check(str(repo.path), info["id"])
    make_dir_link(Path(info["path"]) / "late", outside.path)
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "confirmation_invalid" and caught.value.details["reason"] == "stale"
    outside.assert_intact()
    assert os.path.isdir(info["path"])


def test_a_link_retargeted_after_the_check_makes_the_confirmation_stale(svc, repo, outside, tmp_path):
    ignore(repo, "cache/\n")
    info = svc.create(str(repo.path), "main")
    cache = Path(info["path"]) / "cache"
    cache.mkdir()
    link = cache / "l"
    make_dir_link(link, outside.path)
    report = svc.removal_check(str(repo.path), info["id"])
    other = tmp_path / "other-target"
    other.mkdir()
    remove_dir_link(link)
    make_dir_link(link, other)
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.details["reason"] == "stale"
    outside.assert_intact()


# ----------------------------------------------------------------------- the guards behind the exclusion


def test_if_the_exclusion_failed_the_rescue_is_refused_and_nothing_is_removed(svc, repo, wt, outside, monkeypatch):
    info, w = wt
    make_dir_link(Path(info["path"]) / "jlink", outside.path)
    w.write("README.md", "hello\nedited\n")
    report = svc.removal_check(str(repo.path), info["id"])
    monkeypatch.setattr(removal_module, "rescue_pathspecs", lambda links: b".\0")  # as if git ignored the exclusion
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "preservation_failed"
    outside.assert_intact()
    assert rescue_refs(repo) == [] and os.path.isdir(info["path"])


def test_the_rescue_is_checked_byte_for_byte_not_only_by_name(svc, repo, wt, monkeypatch):
    info, w = wt
    w.write("README.md", "hello\nedited\n")
    report = svc.removal_check(str(repo.path), info["id"])
    original = RemovalMixin._snapshot

    def tampered(self, ctx, entry, ident, links=None):
        commit, staged = original(self, ctx, entry, ident, links)
        bogus = repo.git("hash-object", "-w", "--stdin", input=b"NOT WHAT IS ON DISK\n").stdout.decode().strip()
        rows = []
        for line in filter(None, repo.git("ls-tree", "-z", commit).stdout.split(b"\0")):
            meta, _, name = line.partition(b"\t")
            mode, kind, oid = meta.decode().split(" ")
            rows.append(f"{mode} {kind} {bogus if name == b'README.md' else oid}\t".encode() + name)
        tree = repo.git("mktree", "-z", input=b"\0".join(rows) + b"\0").stdout.decode().strip()
        parent = repo.out("rev-parse", f"{commit}^")
        return repo.out("commit-tree", tree, "-p", parent, "-m", "tampered"), staged

    monkeypatch.setattr(RemovalMixin, "_snapshot", tampered)
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "preservation_failed"
    assert rescue_refs(repo) == []
    assert (Path(info["path"]) / "README.md").read_text(encoding="utf-8") == "hello\nedited\n"


def test_a_link_between_the_managed_root_and_the_worktree_blocks_removal(svc, repo):
    info = svc.create(str(repo.path), "main")
    repo_dir = Path(info["path"]).parent
    moved = repo_dir.with_name("moved-aside")
    os.rename(repo_dir, moved)
    make_dir_link(repo_dir, moved)  # the same directory, now reached through a link that still lands inside the root
    report = svc.removal_check(str(repo.path), info["id"])
    with pytest.raises(WorkspaceError) as caught:
        svc.remove(str(repo.path), info["id"], report["confirmation_token"])
    assert caught.value.code == "unsafe_destination"
    assert (moved / info["id"]).is_dir()


def test_a_scan_reports_the_link_not_what_it_contains(tmp_path, outside):
    from workspaces.links import scan_links
    root = tmp_path / "tree"
    (root / "a" / "b").mkdir(parents=True)
    (root / "plain.txt").write_text("x", encoding="utf-8")
    make_dir_link(root / "a" / "b" / "l", outside.path)
    found = scan_links(root)
    assert [link.path for link in found] == ["a/b/l"]
    outside.assert_intact()


# ----------------------------------------------------------------------- remove_tree: the gap between lstat and scandir


def test_remove_tree_aborts_when_a_directory_turns_into_a_link_before_it_is_listed(tmp_path, outside, monkeypatch):
    from workspaces import links as links_module

    top = tmp_path / "doomed"
    child = top / "child"
    child.mkdir(parents=True)
    (child / "mine.txt").write_text("mine\n", encoding="utf-8")
    real_scandir, swapped = os.scandir, []

    def swap_then_scan(path="."):
        if os.path.normcase(os.fspath(path)) == os.path.normcase(os.fspath(child)) and not swapped:
            swapped.append(True)
            (child / "mine.txt").unlink()
            child.rmdir()
            make_dir_link(child, outside.path)  # between the lstat that said "real directory" and the listing
        return real_scandir(path)

    monkeypatch.setattr(links_module.os, "scandir", swap_then_scan)
    with pytest.raises(WorkspaceError) as caught:
        links_module.remove_tree(top)
    assert caught.value.code == "unsafe_destination"
    outside.assert_intact()
