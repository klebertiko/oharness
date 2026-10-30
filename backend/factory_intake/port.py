"""The narrow port between the intake side (package B) and the factory foundation (package A, ADRs 0053-0058).

Intake depends on this Protocol and nothing else of the foundation. The foundation adapts its work item model to it (or the other way
around); until it lands, tests use ``memory.MemoryFactory``. Every string in ``WorkItemDraft`` comes from outside and is untrusted data
(ADR 0059): it is stored and shown, never executed and never promoted to an instruction.
"""
from __future__ import annotations

from typing import Annotated, Literal, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

# Vocabulary of the foundation (package A, ADR 0053): `source.kind` is the connector, `status` the item's lifecycle. `done` is set only by an observed
# merge or a person's confirmation, never by intake; a release returns an item to review, not to done.
SourceKind = Literal["github", "gitlab", "azdo", "linear", "jira", "slack", "teams", "webhook", "mcp", "cli", "schedule", "conversation", "manual", "monitor"]
WorkState = Literal["queued", "running", "awaiting_human", "waiting_merge", "claimed", "parked", "done", "cancelled", "failed"]
TERMINAL: frozenset[str] = frozenset({"done", "cancelled", "failed"})
CLAIMABLE: frozenset[str] = frozenset({"queued", "running", "awaiting_human", "parked"})

MAX_TITLE, MAX_BODY, MAX_COMMENT = 300, 20_000, 10_000


class SourceRef(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: SourceKind
    ref: str = Field(max_length=200, description="id of the issue/PR/message in the source system")
    url: str | None = Field(default=None, max_length=2000)
    thread_ref: str | None = Field(default=None, max_length=500, description="opaque handle the connector uses to answer in the same thread")


class WorkItemDraft(BaseModel):
    """A request to start work. All free text is untrusted."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    source: SourceRef
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    body: str = Field(default="", max_length=MAX_BODY)
    labels: tuple[Annotated[str, StringConstraints(max_length=100)], ...] = Field(default=(), max_length=50)
    requested_by: str = Field(default="", max_length=200, description="opaque author id as the source reports it; never an authorization")
    idempotency_key: str = Field(min_length=1, max_length=200)
    agent: str | None = Field(default=None, max_length=100, description="the agent an automation routes this to (owner-set, not from the source)")
    automation: str | None = Field(default=None, max_length=100, description="id of the automation that created the draft")
    instructions: str = Field(default="", max_length=MAX_BODY, description="TRUSTED: the owner's automation prompt; `body` stays untrusted source text")
    token_ceiling: int | None = Field(default=None, ge=1, description="token ceiling for the item's runs, from the automation's limits")
    is_reply: bool = Field(default=False, description="a message in an existing thread (a comment): if the thread's item is open it is added there as a comment")


def clamp_draft(source: SourceRef, title: str, body: str, labels, requested_by: str, idempotency_key: str, is_reply: bool = False) -> "WorkItemDraft":
    """Build a draft from outside text that may be too long or empty: cut to the limits (sources allow larger bodies than the factory
    keeps) and give a blank title a placeholder, so a normal oversized payload is never a validation error."""
    return WorkItemDraft(
        source=source,
        title=(" ".join(title.split())[:MAX_TITLE]) or "(untitled)",
        body=body[:MAX_BODY],
        labels=tuple(str(label)[:100] for label in list(labels)[:50]),
        requested_by=requested_by[:200],
        idempotency_key=idempotency_key[:200],
        is_reply=is_reply,
    )


class Claim(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    holder: str
    worktree_ref: str | None = None


class WorkItemView(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    state: WorkState
    stage: str | None = None
    source: SourceRef
    title: str
    cost_tokens: int = 0
    pr_url: str | None = None
    created_at: str
    updated_at: str
    claim: Claim | None = None


class ReleaseResult(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    summary: str = Field(max_length=MAX_COMMENT)
    branch: str | None = Field(default=None, max_length=200)
    status: Literal["needs_review", "abandoned"]  # a release never completes an item: review is a person's checkpoint, abandoning re-queues it


class SubmitResult(BaseModel):
    """What ``submit`` did. ``created``: a new item. ``replay``: the same ``(source.kind, idempotency_key)`` was already delivered (nothing
    changed). Neither: the work belongs to an item that is still open for the same ``(source.kind, source.ref)``, a reply in its thread, so
    the caller adds it as a comment (ADR 0059)."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    item: "WorkItemView"
    created: bool = False
    replay: bool = False


class FactoryError(Exception):
    """A request the factory refused; ``code`` is stable and safe to show."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@runtime_checkable
class FactoryPort(Protocol):
    def submit(self, draft: WorkItemDraft) -> SubmitResult:
        """Create a work item, or say why not (``SubmitResult``): the same ``(source.kind, idempotency_key)`` is a replay; an open item with
        the same ``(source.kind, source.ref)`` is a follow-up. A closed item with that ref does not block a new one."""

    def get(self, item_id: str) -> WorkItemView:
        """The item, or ``FactoryError('not_found')``."""

    def list(self, state: WorkState | None = None, source: SourceKind | None = None, limit: int = 50) -> list[WorkItemView]:
        """Items newest first; ``state='awaiting_human'`` is the inbox."""

    def comment(self, item_id: str, text: str, author: str) -> None:
        """Add a comment as untrusted input to the item's conversation."""

    def cancel(self, item_id: str) -> WorkItemView: ...

    def claim(self, item_id: str, holder: str) -> WorkItemView:
        """Suspend the factory's own run and hand the item to a local session (state ``claimed``)."""

    def release(self, item_id: str, result: ReleaseResult) -> WorkItemView:
        """Give a claimed item back; it goes to review, never to merge."""

    def metrics(self, window_days: int = 7) -> dict:
        """Throughput, cost and quality figures for the window."""
