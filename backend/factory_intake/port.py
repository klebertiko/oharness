"""The narrow port between the intake side (package B) and the factory foundation (package A, ADRs 0053-0058).

Intake depends on this Protocol and nothing else of the foundation. The foundation adapts its work item model to it (or the other way
around); until it lands, tests use ``memory.MemoryFactory``. Every string in ``WorkItemDraft`` comes from outside and is untrusted data
(ADR 0059): it is stored and shown, never executed and never promoted to an instruction.
"""
from __future__ import annotations

from typing import Literal, Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field

SourceKind = Literal["github", "gitlab", "azdo", "linear", "jira", "slack", "teams", "webhook", "mcp", "cli", "schedule"]
WorkState = Literal["queued", "running", "waiting_human", "done", "failed", "cancelled", "claimed"]

MAX_TITLE, MAX_BODY, MAX_COMMENT = 300, 20_000, 10_000


class SourceRef(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    kind: SourceKind
    external_id: str = Field(max_length=200, description="id of the issue/PR/message in the source system")
    url: str | None = Field(default=None, max_length=2000)
    thread_ref: str | None = Field(default=None, max_length=500, description="opaque handle the connector uses to answer in the same thread")


class WorkItemDraft(BaseModel):
    """A request to start work. All free text is untrusted."""

    model_config = ConfigDict(frozen=True, extra="forbid")

    source: SourceRef
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    body: str = Field(default="", max_length=MAX_BODY)
    labels: tuple[str, ...] = Field(default=(), max_length=50)
    requested_by: str = Field(default="", max_length=200, description="opaque author id as the source reports it; never an authorization")
    idempotency_key: str = Field(min_length=1, max_length=200)


class Claim(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    holder: str
    worktree: str | None = None


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
    status: Literal["done", "needs_review", "abandoned"]


class FactoryError(Exception):
    """A request the factory refused; ``code`` is stable and safe to show."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@runtime_checkable
class FactoryPort(Protocol):
    def submit(self, draft: WorkItemDraft) -> WorkItemView:
        """Create a work item; the same ``idempotency_key`` returns the item it already created."""

    def get(self, item_id: str) -> WorkItemView: ...

    def list(self, state: WorkState | None = None, source: SourceKind | None = None, limit: int = 50) -> list[WorkItemView]: ...

    def comment(self, item_id: str, text: str, author: str) -> None:
        """Add a comment as untrusted input to the item's conversation."""

    def cancel(self, item_id: str) -> WorkItemView: ...

    def claim(self, item_id: str, holder: str) -> WorkItemView:
        """Suspend the factory's own run and hand the item to a local session (state ``claimed``)."""

    def release(self, item_id: str, result: ReleaseResult) -> WorkItemView:
        """Give a claimed item back; it goes to review, never to merge."""

    def metrics(self, window_days: int = 7) -> dict: ...
