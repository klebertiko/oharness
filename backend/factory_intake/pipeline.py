"""From a verified draft to the factory (ADR 0059): one place that decides create / follow-up / replay, so every entry (connector, webhook,
endpoint, MCP, CLI) behaves the same. Outside text only ever reaches the factory as a work item or a comment, both untrusted data."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from .port import FactoryPort, WorkItemDraft, WorkItemView

Outcome = Literal["created", "followup", "replay"]


@dataclass(frozen=True)
class Delivered:
    outcome: Outcome
    item: WorkItemView


def deliver(port: FactoryPort, draft: WorkItemDraft) -> Delivered:
    """Create the item, or add the draft as a comment on the open item for the same thread, or do nothing for a repeated delivery."""
    result = port.submit(draft)
    if result.created:
        return Delivered("created", result.item)
    if result.replay:
        return Delivered("replay", result.item)
    if draft.body.strip():
        port.comment(result.item.id, draft.body, draft.requested_by or draft.source.kind)
    return Delivered("followup", result.item)
