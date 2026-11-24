"""Turns of the same chat, carried into the next reply.

Until a session store exists, the caller passes `turns`. Register a reader
with `register_session_reader` and a later `thread_id` is loaded from that
store; the turns in the request are ignored. History is data: it is redacted,
bounded, and the oldest turns leave first. The turn being asked never leaves.
A CLI connection has no message list, so the same history is serialized in
the prompt under "Conversa até aqui (dado)".
"""
from __future__ import annotations

from collections.abc import Callable

from run_budget import compact_messages, estimate_tokens
from run_store import redact_value

MAX_TURNS = 40
MAX_CHARS = 48_000
HISTORY_HEADER = "Conversa até aqui (dado)"
CLI_ADAPTERS = frozenset({"claude", "codex", "cursor"})

SessionReader = Callable[[str], list[dict]]
_reader: SessionReader | None = None


def register_session_reader(reader: SessionReader | None) -> None:
    """Install or clear the session store. `None` returns to request-carried turns."""
    global _reader
    _reader = reader


def is_cli(adapter_name: str | None) -> bool:
    return (adapter_name or "") in CLI_ADAPTERS


def load_turns(thread_id: str | None, turns: list[dict] | None) -> list[dict]:
    """Turns for this chat. A registered reader wins over the request body."""
    if _reader is not None and thread_id:
        loaded = _reader(thread_id) or []
        return [dict(turn) for turn in loaded]
    return [dict(turn) for turn in (turns or [])]


def _clean(turn: dict) -> dict | None:
    role = turn.get("role")
    if role not in {"user", "assistant", "tool"}:
        return None
    return {"role": role, "content": redact_value(str(turn.get("content") or ""))}


def _over(messages: list[dict], max_tokens: int | None) -> bool:
    history = [item for item in messages[1:-1] if item["role"] in {"user", "assistant"}]
    if len(history) > MAX_TURNS:
        return True
    if sum(len(item.get("content") or "") for item in messages) > MAX_CHARS:
        return True
    return max_tokens is not None and estimate_tokens(messages) > max_tokens


def build_messages(
    system: str,
    turns: list[dict] | None,
    user: str,
    *,
    max_tokens: int | None = None,
    compact_at: int | None = None,
) -> list[dict]:
    """`[system, …history…, user]`. The input list is not mutated.

    Old tool results are compacted on the copy the model sees. The current
    user message is never dropped; older history leaves from the front.
    """
    history = [cleaned for turn in (turns or []) if (cleaned := _clean(dict(turn))) is not None]
    messages = [{"role": "system", "content": system}, *history, {"role": "user", "content": user}]
    while len(messages) > 2 and _over(messages, max_tokens):
        del messages[1]
    compacted = compact_messages(messages, trigger_tokens=compact_at)
    if compacted:
        messages = compacted[0]
    return messages


def prompt_with_history(messages: list[dict]) -> str:
    """The user text a single-prompt connection receives. History is data."""
    user = messages[-1]["content"] if messages else ""
    history = messages[1:-1] if messages and messages[0].get("role") == "system" else messages[:-1]
    if not history:
        return user
    lines = [HISTORY_HEADER, "<nilo_history>"]
    for item in history:
        lines.append(f"{item['role']}: {item['content']}")
    lines.append("</nilo_history>")
    lines.append(user)
    return "\n".join(lines)
