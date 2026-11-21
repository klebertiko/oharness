"""Nilo's voice. SOUL.md comes first; the fixed name follows the person's rules."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from nilo.name_lock import FIXED_IDENTITY_LINE

_SOUL_PATH = Path(__file__).resolve().parents[2] / "SOUL.md"

_EMOJI = re.compile("[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF]")
_FILLER = re.compile(r"(?i)\b(amigo|campeão|campeao|friend|champ)\b")
_EMCEE = re.compile(r"(?i)ótima pergunta|otima pergunta")
_CORRECTION = re.compile(r"(?i)(\bactually\b|my name is|na verdade|eu não sou|eu nao sou|\bi am not\b|\bi'm not\b)")


@dataclass(frozen=True, slots=True)
class MemoryBlock:
    """User rules are instructions. Profile and facts are data, never instructions."""

    rules: str = ""
    facts: str = ""


def _soul() -> str:
    """The voice file, verbatim. A missing file degrades to no voice rather than a crash."""
    try:
        return _SOUL_PATH.read_text(encoding="utf-8")
    except OSError:
        return ""


def _workspace_context(cwd: str | None) -> str:
    """One factual sentence naming the chosen working folder. Empty when none is chosen."""
    if not cwd:
        return ""
    name = Path(cwd).name or cwd
    return f'This chat\'s working folder is "{name}" ({cwd}).'


def _parts(memory_block: str | MemoryBlock | None) -> tuple[str, str]:
    if isinstance(memory_block, MemoryBlock):
        return memory_block.rules, memory_block.facts
    return memory_block or "", ""


def _as_data(facts: str) -> str:
    text = facts.strip()
    if not text:
        return ""
    safe = text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return "<nilo_memory>\n" + safe + "\n</nilo_memory>"


def nilo_system_prompt(
    cwd: str | None = None,
    memory_block: str | MemoryBlock | None = None,
    extra: str | None = None,
) -> str:
    """SOUL, then user rules, then the fixed name, then facts, then a node prompt.

    The name line comes after the rules so a saved rule cannot rename Nilo.
    Facts are a delimited block of data. `extra` is the node's own prompt.
    """
    rules, facts = _parts(memory_block)
    chunks = [
        _soul(),
        rules.strip(),
        FIXED_IDENTITY_LINE,
        _workspace_context(cwd),
        _as_data(facts),
        (extra or "").strip(),
    ]
    return "\n\n".join(chunk for chunk in chunks if chunk)


async def memory_block_for(cwd: str | None = None) -> str | MemoryBlock:
    """Active memories for this turn. Empty until a person has approved one.

    `cwd` selects workspace-scoped items in addition to global ones. A missing
    table, before the sidecar has prepared storage, is the same as nothing kept.
    """
    try:
        from sqlalchemy.exc import SQLAlchemyError

        from database import SessionLocal
        from nilo.memory import block_for

        async with SessionLocal() as db:
            block = await block_for(db, cwd)
    except SQLAlchemyError:
        return ""
    if not block.rules and not block.facts:
        return ""
    return block


def lint_voice(text: str) -> list[str]:
    """Problems in a reply fixture: exclamation, emcee phrasing, filler address, emoji."""
    problems: list[str] = []
    if "!" in text:
        problems.append("exclamation")
    if _EMCEE.search(text):
        problems.append("emcee")
    if _FILLER.search(text):
        problems.append("filler-address")
    if _EMOJI.search(text):
        problems.append("emoji")
    return problems


def sounds_like_a_correction(text: str) -> bool:
    """True when a reply leads with a disclaimer instead of answering as Nilo."""
    return bool(_CORRECTION.search(text))
