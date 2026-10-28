"""Pure parsers for git's machine-readable output. No process is started here."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class WorktreeEntry:
    path: str
    head: str | None = None
    branch: str | None = None  # full ref, e.g. refs/heads/main
    detached: bool = False
    bare: bool = False
    locked: bool = False
    lock_reason: str = ""
    prunable: bool = False
    prunable_reason: str = ""


def parse_worktree_list(raw: bytes) -> list[WorktreeEntry]:
    """`git worktree list --porcelain -z`: attributes are NUL-terminated, records end with an extra NUL."""
    entries: list[WorktreeEntry] = []
    current: WorktreeEntry | None = None
    for field_bytes in raw.split(b"\0"):
        text = field_bytes.decode("utf-8", "replace")
        if not text:
            current = None
            continue
        key, _, value = text.partition(" ")
        if key == "worktree":
            current = WorktreeEntry(path=value)
            entries.append(current)
        elif current is None:
            continue
        elif key == "HEAD":
            current.head = value
        elif key == "branch":
            current.branch = value
        elif key == "detached":
            current.detached = True
        elif key == "bare":
            current.bare = True
        elif key == "locked":
            current.locked, current.lock_reason = True, value
        elif key == "prunable":
            current.prunable, current.prunable_reason = True, value
    return entries


@dataclass
class StatusReport:
    staged: int = 0
    modified: int = 0
    untracked: int = 0
    conflicted: int = 0
    ignored: int = 0
    # path -> one-letter-class: "?" untracked, "u" conflicted, otherwise the XY code (only non-ignored paths)
    paths: dict[str, str] = field(default_factory=dict)

    @property
    def dirty(self) -> bool:
        return bool(self.staged or self.modified or self.untracked or self.conflicted)


def parse_status_v2(raw: bytes) -> StatusReport:
    """`git status --porcelain=v2 -z`. A change in both index and work tree counts once in each column."""
    report = StatusReport()
    tokens = raw.split(b"\0")
    i = 0
    while i < len(tokens):
        token = tokens[i].decode("utf-8", "replace")
        i += 1
        if not token or token[0] == "#":
            continue
        kind = token[0]
        if kind == "1":
            xy, path = token[2:4], token.split(" ", 8)[8]
        elif kind == "2":
            xy, path = token[2:4], token.split(" ", 9)[9]
            i += 1  # the original path follows as its own field
        elif kind == "u":
            report.conflicted += 1
            report.paths[token.split(" ", 10)[10]] = "u"
            continue
        elif kind == "?":
            report.untracked += 1
            report.paths[token[2:]] = "?"
            continue
        elif kind == "!":
            report.ignored += 1
            continue
        else:
            continue
        if xy[0] != ".":
            report.staged += 1
        if xy[1] != ".":
            report.modified += 1
        report.paths[path] = xy
    return report
