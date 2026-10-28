"""Links inside a tree the Workspace Manager is about to remove: found without following them, and undone without following them.

``git worktree remove`` (and ``git add --all``) walk into a junction or symlink they find inside a worktree, so a link planted in
a worktree (or an ignored ``node_modules\\linked``) makes the removal delete, or the rescue embed, files that live outside it.
Everything here uses ``lstat``-style calls only: a link is recorded as a name and a target and is removed as the link itself
(``rmdir`` of a junction or directory symlink, ``unlink`` of a file symlink), never by descending into it.

A *link* is: a symbolic link of either kind, a junction (mount point reparse tag), or any other directory reparse point. A file
reparse point that is not a symlink (a cloud placeholder, say) holds its own bytes and is not a link.
"""
from __future__ import annotations

import hashlib
import os
import stat
from dataclasses import dataclass, field
from pathlib import Path

from .errors import WorkspaceError

FILE_ATTRIBUTE_DIRECTORY = 0x10
FILE_ATTRIBUTE_REPARSE_POINT = 0x400
IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003
MAX_SAMPLE = 100


@dataclass(frozen=True)
class LinkInfo:
    path: str  # relative to the scanned root, "/"-separated
    target: str
    kind: str  # "symlink" | "junction" | "reparse"
    is_dir: bool

    def as_dict(self) -> dict[str, str]:
        return {"path": self.path, "target": self.target, "kind": self.kind}


@dataclass
class TreeScan:
    links: list[LinkInfo] = field(default_factory=list)
    entries: int = 0
    sample: list[str] = field(default_factory=list)
    digest: str = ""


def link_kind(full: str, st: os.stat_result) -> str | None:
    """``symlink``, ``junction`` or ``reparse`` when ``st`` (an lstat result) describes a link, else None."""
    if stat.S_ISLNK(st.st_mode):
        return "symlink"
    attributes = getattr(st, "st_file_attributes", 0)
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT:
        if getattr(st, "st_reparse_tag", 0) == IO_REPARSE_TAG_MOUNT_POINT:
            return "junction"
        isjunction = getattr(os.path, "isjunction", None)
        if isjunction and isjunction(full):
            return "junction"
        if attributes & FILE_ATTRIBUTE_DIRECTORY:
            return "reparse"
    return None


def _is_dir_entry(st: os.stat_result) -> bool:
    attributes = getattr(st, "st_file_attributes", None)
    if attributes is not None:
        return bool(attributes & FILE_ATTRIBUTE_DIRECTORY)
    return stat.S_ISDIR(st.st_mode)


def _target(full: str) -> str:
    try:
        target = os.readlink(full)
    except OSError:
        return "(unreadable)"
    return target[4:] if target.startswith("\\\\?\\") and not target.startswith("\\\\?\\UNC\\") else target


def _cannot_prove(path: str, exc: OSError) -> WorkspaceError:
    return WorkspaceError("inspection_failed", "the workspace could not be scanned for links, so it cannot be proven safe to remove", 409,
                          detail=f"{os.path.basename(path)}: {exc.strerror or exc}")


def scan_tree(root: str | Path, *, digest: bool = False) -> TreeScan:
    """Walk the whole tree under ``root`` (ignored and hidden entries included, at any depth) without following any link.

    A directory that cannot be read fails the scan: "no links found" must mean "none exist", not "could not look".
    With ``digest`` every entry's (name, kind, size, mtime) feeds a hash, so a caller can bind a confirmation to the exact content.
    """
    scan = TreeScan()
    hasher = hashlib.sha256() if digest else None
    base = os.fspath(root)
    pending = [""]
    while pending:
        rel_dir = pending.pop()
        here = os.path.join(base, rel_dir) if rel_dir else base
        try:
            with os.scandir(here) as iterator:
                entries = sorted(iterator, key=lambda e: e.name)
        except OSError as exc:
            raise _cannot_prove(here, exc) from exc
        for entry in entries:
            rel = f"{rel_dir}/{entry.name}" if rel_dir else entry.name
            try:
                st = entry.stat(follow_symlinks=False)
            except OSError as exc:
                raise _cannot_prove(entry.path, exc) from exc
            scan.entries += 1
            if len(scan.sample) < MAX_SAMPLE:
                scan.sample.append(rel)
            kind = link_kind(entry.path, st)
            if kind:
                link = LinkInfo(rel, _target(entry.path), kind, _is_dir_entry(st))
                scan.links.append(link)
                if hasher:
                    hasher.update(f"L|{rel}|{link.target}\0".encode("utf-8", "surrogateescape"))
                continue
            if hasher:
                hasher.update(f"{'D' if stat.S_ISDIR(st.st_mode) else 'F'}|{rel}|{st.st_size}|{st.st_mtime_ns}\0".encode("utf-8", "surrogateescape"))
            if stat.S_ISDIR(st.st_mode):
                pending.append(rel)
    scan.links.sort(key=lambda link: link.path)
    scan.digest = hasher.hexdigest() if hasher else ""
    return scan


def scan_links(root: str | Path) -> list[LinkInfo]:
    return scan_tree(root).links


def is_under(rel: str, links: list[LinkInfo]) -> bool:
    """True when the "/"-separated ``rel`` is one of ``links`` or sits below one."""
    rel = rel.rstrip("/")
    return any(rel == link.path or rel.startswith(link.path + "/") for link in links)


def _unlink_entry(full: str, st: os.stat_result) -> None:
    """Remove the directory entry itself: a directory-type link goes with rmdir on Windows (never recursing), anything else with unlink."""
    if os.name == "nt" and _is_dir_entry(st):
        os.rmdir(full)
    else:
        os.unlink(full)


def unlink_link(root: str | Path, link: LinkInfo) -> None:
    """Undo one link recorded by a scan, as the link itself. Refuses if it is no longer a link or a parent has become one."""
    base = os.path.realpath(os.fspath(root))
    full = os.path.join(base, *link.path.split("/"))
    try:
        st = os.lstat(full)
    except FileNotFoundError:
        return
    parent = os.path.dirname(full)
    if os.path.normcase(os.path.realpath(parent)) != os.path.normcase(os.path.join(base, *link.path.split("/")[:-1])):
        raise WorkspaceError("unsafe_destination", "a link appeared above a link that was meant to be undone; nothing was followed", 409)
    if link_kind(full, st) is None:
        raise WorkspaceError("unsafe_destination", f"{link.path!r} is no longer a link; refusing to remove it as one", 409)
    _unlink_entry(full, st)


def _same_directory(before: os.stat_result, now: os.stat_result) -> bool:
    """Still the very directory that was inspected (identity compared where the file system reports one)."""
    if before.st_ino and now.st_ino and (before.st_dev, before.st_ino) != (now.st_dev, now.st_ino):
        return False
    return True


def _turned_into_a_link(top: str) -> WorkspaceError:
    return WorkspaceError("unsafe_destination", f"{os.path.basename(top)!r} turned into a link while it was being removed; nothing below it was touched", 409)


def _reconfirm(top: str, inspected: os.stat_result) -> None:
    """The directory whose listing is being worked through is still the one that was inspected (checked again before every entry).

    The check runs on the full path, so a link planted on any ancestor shows up as a different directory too.
    """
    try:
        now = os.lstat(top)
    except FileNotFoundError:
        raise _turned_into_a_link(top) from None
    if link_kind(top, now) or not stat.S_ISDIR(now.st_mode) or not _same_directory(inspected, now):
        raise _turned_into_a_link(top)


def remove_tree(path: str | Path) -> None:
    """Delete ``path`` bottom-up, undoing every link as a link and descending only into real directories.

    The directory is checked again after it is listed and before anything in it is deleted: if it was swapped for a link (or for
    another directory) between the first ``lstat`` and the listing, the walk stops without deleting a thing below it.
    """
    top = os.fspath(path)
    try:
        st = os.lstat(top)
    except FileNotFoundError:
        return
    if link_kind(top, st):
        _unlink_entry(top, st)
        return
    with os.scandir(top) as iterator:
        entries = list(iterator)
    try:
        again = os.lstat(top)
    except FileNotFoundError:
        return
    if link_kind(top, again) or not stat.S_ISDIR(again.st_mode) or not _same_directory(st, again):
        raise _turned_into_a_link(top)
    first = again
    for entry in entries:
        _reconfirm(top, first)
        st = entry.stat(follow_symlinks=False)
        if link_kind(entry.path, st):
            _unlink_entry(entry.path, st)
        elif stat.S_ISDIR(st.st_mode):
            remove_tree(entry.path)
        else:
            try:
                os.unlink(entry.path)
            except PermissionError:
                os.chmod(entry.path, stat.S_IWRITE)  # a read-only file (git objects, for one) blocks delete on Windows
                os.unlink(entry.path)
    _reconfirm(top, first)
    os.rmdir(top)
