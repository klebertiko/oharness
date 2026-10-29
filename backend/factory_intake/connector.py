"""The plug for a work source (ADR 0059). GitHub implements it first (ADR 0060); GitLab, Azure DevOps, Linear, Jira, Slack and Teams
have skeletons and a fixture each (ADR 0064) and are not claimed to work until verified against the real service.

A connector does three things and nothing more: turn a verified delivery into zero or more ``WorkItemDraft``, answer in the same thread
the work came from, and say which token scopes it needs. It never runs a command, never reads a repository, and never decides what the
factory may do: that stays with the permission policy and the human checkpoints.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Mapping, Protocol, runtime_checkable

from .port import SourceKind, SourceRef, WorkItemDraft


@dataclass(frozen=True)
class Delivery:
    """One request as the receiver saw it, headers lower-cased. ``body`` is the raw bytes the signature covers."""

    headers: Mapping[str, str]
    body: bytes


_HANDLE = re.compile(r"^@?[A-Za-z0-9][A-Za-z0-9_-]{0,38}$")
_CODE = re.compile(r"```.*?```|`[^`\n]*`|^>.*$", re.DOTALL | re.MULTILINE)


@dataclass(frozen=True)
class TriggerRules:
    """When outside activity becomes work: an explicit mention of the factory handle, or a label the owner configured as a trigger.

    A mention inside a code block, inline code or a quoted reply does not count (quoting someone is not addressing the factory)."""

    handle: str | None = None
    labels: frozenset[str] = field(default_factory=frozenset)
    allowed_authors: frozenset[str] | None = None  # None: anyone who can reach the source; a set restricts it (recommended for public repos)

    def __post_init__(self) -> None:
        if self.handle is not None and not _HANDLE.match(self.handle):
            raise ValueError("handle must be a name such as '@payments' (letters, digits, '-', '_')")
        if self.allowed_authors is not None:
            object.__setattr__(self, "allowed_authors", frozenset(a.lower() for a in self.allowed_authors))

    def mentions(self, text: str) -> bool:
        if not self.handle:
            return False
        handle = self.handle if self.handle.startswith("@") else "@" + self.handle
        lowered, needle = _CODE.sub(" ", text).lower(), handle.lower()
        start = 0
        while (at := lowered.find(needle, start)) != -1:
            end = at + len(needle)
            before_ok = at == 0 or not (lowered[at - 1].isalnum() or lowered[at - 1] in "_-/")
            after_ok = end == len(lowered) or not (lowered[end].isalnum() or lowered[end] in "_-" or (lowered[end] == "." and lowered[end + 1:end + 2].isalnum()))
            if before_ok and after_ok:
                return True
            start = end
        return False

    def author_allowed(self, author: str) -> bool:
        return self.allowed_authors is None or author.lower() in self.allowed_authors


@runtime_checkable
class Connector(Protocol):
    kind: SourceKind

    def required_scopes(self) -> tuple[str, ...]:
        """The minimum token permissions this connector needs, shown to the owner (documented per connector)."""

    def parse(self, delivery: Delivery, rules: TriggerRules) -> list[WorkItemDraft]:
        """Authenticity is already checked by the receiver. Returns drafts only for activity the rules select; ignores the rest."""

    def reply(self, ref: SourceRef, text: str) -> None:
        """Post ``text`` in the thread ``ref`` came from. Raises on failure; never merges, never pushes."""
