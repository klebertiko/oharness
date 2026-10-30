"""API contract of the factory (ADR 0053). Package B builds on these shapes."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

FACTORY_ID_PATTERN = r'^[a-z0-9][a-z0-9-]{0,62}$'
SOURCE_KINDS = ('github', 'gitlab', 'azdo', 'linear', 'jira', 'slack', 'teams', 'webhook', 'mcp', 'cli', 'schedule',
                'conversation', 'manual', 'monitor')
ORIGIN_LIMIT_BYTES = 64 * 1024
ACTIONS = ('approve_spec', 'edit_spec', 'answer', 'request_changes', 'confirm_merged', 'advance', 'park', 'resume',
           'cancel', 'note', 'claim', 'release')
# Decisions belong to a person; the agent/integration credential class (package B, MCP) can do the rest (ADR 0055).
HUMAN_ONLY_ACTIONS = frozenset({'approve_spec', 'edit_spec', 'answer', 'request_changes', 'confirm_merged', 'advance'})


class Source(BaseModel):
    kind: Literal[SOURCE_KINDS]  # type: ignore[valid-type]
    subtype: str | None = Field(default=None, max_length=32)
    ref: str = Field(min_length=1, max_length=512)
    url: str | None = Field(default=None, max_length=2048)
    thread_ref: str | None = Field(default=None, max_length=512)


class Attachment(BaseModel):
    label: str = Field(max_length=200)
    ref: str = Field(max_length=2048)


class OriginContext(BaseModel):
    text: str = ''
    attachments: list[Attachment] = Field(default_factory=list, max_length=50)


class WorkItemCreate(BaseModel):
    factory_id: str = Field(pattern=FACTORY_ID_PATTERN)
    title: str = Field(min_length=1, max_length=200)
    source: Source
    origin_context: OriginContext = Field(default_factory=OriginContext)
    labels: list[str] = Field(default_factory=list, max_length=50)
    requested_by: str | None = Field(default=None, max_length=200)
    idempotency_key: str | None = Field(default=None, max_length=200)
    # Which agent/automation should handle it. The trusted `instructions` and `token_ceiling` are not accepted from a request body:
    # package B passes them in process from a validated automation definition.
    agent: str | None = Field(default=None, pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    automation: str | None = Field(default=None, pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')

    @field_validator('labels')
    @classmethod
    def _short_labels(cls, labels: list[str]) -> list[str]:
        return [label[:100] for label in labels]


class ActionBody(BaseModel):
    """`actor` is deliberately absent: the server derives it from the credential (ADR 0055)."""
    model_config = {'extra': 'ignore'}
    action: Literal[ACTIONS]  # type: ignore[valid-type]
    revision: int | None = None
    base_revision: int | None = None
    text: str | None = Field(default=None, max_length=20000)
    question_id: str | None = None
    note: str | None = Field(default=None, max_length=4000)
    holder: str | None = Field(default=None, max_length=200)
    summary: str | None = Field(default=None, max_length=4000)
    branch: str | None = Field(default=None, max_length=255)
    status: Literal['needs_review', 'abandoned'] | None = None
