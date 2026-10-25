"""Parsers for `git worktree list --porcelain -z` and `git status --porcelain=v2 -z`."""
from __future__ import annotations

from workspaces.gitstate import parse_status_v2, parse_worktree_list

Z = "\0"


def test_worktree_list_records_and_flags():
    raw = (
        f"worktree C:/r{Z}HEAD {'a' * 40}{Z}branch refs/heads/main{Z}{Z}"
        f"worktree C:/w/one{Z}HEAD {'b' * 40}{Z}detached{Z}locked because I said so{Z}{Z}"
        f"worktree C:/w/two{Z}HEAD {'c' * 40}{Z}branch refs/heads/feat{Z}locked{Z}prunable gitdir file points to non-existent location{Z}{Z}"
        f"worktree C:/bare{Z}bare{Z}{Z}"
    ).encode()
    main, one, two, bare = parse_worktree_list(raw)
    assert (main.path, main.head, main.branch, main.detached, main.locked, main.prunable) == ("C:/r", "a" * 40, "refs/heads/main", False, False, False)
    assert one.detached and one.branch is None and one.locked and one.lock_reason == "because I said so"
    assert two.locked and two.lock_reason == "" and two.prunable and "non-existent" in two.prunable_reason
    assert bare.bare


def test_worktree_list_tolerates_empty_output():
    assert parse_worktree_list(b"") == []


def test_status_v2_counts_every_kind_of_change():
    oid = "0" * 40
    raw = (
        f"1 M. N... 100644 100644 100644 {oid} {oid} staged.txt{Z}"
        f"1 .M N... 100644 100644 100644 {oid} {oid} modified.txt{Z}"
        f"1 MM N... 100644 100644 100644 {oid} {oid} both.txt{Z}"
        f"2 R. N... 100644 100644 100644 {oid} {oid} R100 new name.txt{Z}old name.txt{Z}"
        f"u UU N... 100644 100644 100644 100644 {oid} {oid} {oid} conflict.txt{Z}"
        f"? untracked.txt{Z}? dir/untracked 2.txt{Z}"
        f"! ignored.log{Z}"
    ).encode()
    report = parse_status_v2(raw)
    assert (report.staged, report.modified, report.untracked, report.conflicted, report.ignored) == (3, 2, 2, 1, 1)
    assert report.dirty
    assert "new name.txt" in report.paths and "old name.txt" not in report.paths
    assert report.paths["untracked.txt"] == "?"
    assert "ignored.log" not in report.paths


def test_clean_status_is_not_dirty():
    report = parse_status_v2(b"")
    assert not report.dirty and (report.staged, report.modified, report.untracked) == (0, 0, 0)
