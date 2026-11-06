"""The orphan-cleaning confirmation binds to the content of the tree, not to directory timestamps.

NTFS refreshes a directory's own timestamps lazily in its parent's listing, so two scans of an unchanged tree can disagree on a
directory's mtime (seen on Windows CI: "confirmation is not valid (stale)" right after a link was created inside). Files keep
their size and mtime; a directory is identified by its name and its entries.
"""
import os

from workspaces.links import scan_tree


def build(root):
    (root / "cache").mkdir(parents=True)
    (root / "cache" / "a.txt").write_text("a", encoding="utf-8")
    return scan_tree(root, digest=True).digest


def test_a_directory_timestamp_alone_does_not_change_the_digest(tmp_path):
    before = build(tmp_path)
    os.utime(tmp_path / "cache", ns=(1_000_000_000, 1_000_000_000))
    assert scan_tree(tmp_path, digest=True).digest == before


def test_content_changes_still_change_the_digest(tmp_path):
    before = build(tmp_path)
    (tmp_path / "cache" / "b.txt").write_text("b", encoding="utf-8")
    added = scan_tree(tmp_path, digest=True).digest
    assert added != before
    (tmp_path / "cache" / "a.txt").write_text("changed", encoding="utf-8")
    assert scan_tree(tmp_path, digest=True).digest != added
