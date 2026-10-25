"""Syntactic checks for client-supplied refs and branch names, applied before git ever sees them.

These are a pre-filter, not the authority: the service also asks ``git check-ref-format`` and resolves the ref with
``git rev-parse --verify --end-of-options``. The rules here are deliberately stricter than git's, because a value that
starts with ``-`` is an option, and a name with a shell metacharacter is a future incident in whatever consumes it.
"""
from __future__ import annotations

import re

from .errors import WorkspaceError

MAX_REF = 255
MAX_BRANCH = 100
_GIT_FORBIDDEN = set(" ~^:?*[\\")


def _plain_ref_problem(value: str, limit: int) -> str | None:
    if not isinstance(value, str) or not value:
        return "must not be empty"
    if len(value) > limit:
        return f"must be at most {limit} characters"
    if value.startswith("-"):
        return "must not start with '-'"
    if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in value):
        return "must not contain control characters"
    if any(ch in _GIT_FORBIDDEN for ch in value):
        return "contains a character git does not allow in a ref"
    if ".." in value or "@{" in value or "//" in value:
        return "contains a sequence git does not allow in a ref"
    if value.startswith("/") or value.endswith("/") or value.endswith(".") or value.endswith(".lock"):
        return "has a boundary git does not allow in a ref"
    if value == "@":
        return "is not a valid ref"
    return None


def validate_ref(ref: str) -> str:
    """A branch, tag or commit id to start from. Returns it unchanged or raises ``invalid_ref``."""
    problem = _plain_ref_problem(ref, MAX_REF)
    if problem:
        raise WorkspaceError("invalid_ref", f"ref {problem}", 400)
    return ref


_BRANCH_CHARS = re.compile(r"^[\w][\w./-]*$")


def validate_branch_name(name: str) -> str:
    """A name for a NEW branch: letters, digits (any script), ``_ . - /``, never an option, a path escape or a shell-looking name."""
    problem = _plain_ref_problem(name, MAX_BRANCH)
    if not problem and (not _BRANCH_CHARS.match(name) or name == "HEAD" or name.startswith("refs/") or "/." in name):
        problem = "may only use letters, digits and _ . - /, and must not look like a ref or hidden path"
    if problem:
        raise WorkspaceError("invalid_branch", f"branch name {problem}", 400)
    return name
