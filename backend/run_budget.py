"""Per-run token ceiling and context compaction (#164).

`RUN_BUDGET_RULES` is the one table the validator, the broker and the UI
(`frontend/src/components/agent-run/runBudgetRules.ts`, pinned by a parity
test) read. A run that reaches its ceiling ends with `budget_exceeded`.
"""
from dataclasses import dataclass

STATUS_BUDGET_EXCEEDED = 'budget_exceeded'

RUN_BUDGET_RULES = {
    'max_tokens': {'min': 100, 'max': 10_000_000},
    'compact_at_tokens': 24_000,
}

_STUB = '[compacted tool result: {n} tokens]'


def validate_max_tokens(value):
    """None means no ceiling; anything else must be an int inside the table's range."""
    if value is None:
        return None
    rule = RUN_BUDGET_RULES['max_tokens']
    if isinstance(value, bool) or not isinstance(value, int) or not rule['min'] <= value <= rule['max']:
        raise ValueError('invalid_run_budget')
    return value


@dataclass
class RunBudget:
    max_tokens: int | None = None

    def exceeded(self, used_tokens: int) -> bool:
        return self.max_tokens is not None and used_tokens >= self.max_tokens


def _text_tokens(text) -> int:
    return len(text or '') // 4


def estimate_tokens(messages) -> int:
    """chars/4, the same fallback the engine uses when a provider reports no usage."""
    return sum(_text_tokens(m.get('content')) + _text_tokens(str(m.get('tool_calls') or '')) for m in messages)


def compact_messages(messages, *, trigger_tokens=None):
    """Replace tool results from earlier turns with a stub. Returns `(messages, info)` or None.

    Deterministic; only the copy replayed to the model shrinks, never the
    transcript the person sees. Results after the last assistant message are
    the current turn's: the model has not read them yet, so they stay intact.
    """
    trigger = RUN_BUDGET_RULES['compact_at_tokens'] if trigger_tokens is None else trigger_tokens
    before = estimate_tokens(messages)
    if before < trigger:
        return None
    last_assistant = max((i for i, m in enumerate(messages) if m.get('role') == 'assistant'), default=-1)
    out = [{**m, 'content': _STUB.format(n=_text_tokens(m.get('content')))}
           if m.get('role') == 'tool' and i < last_assistant and not str(m.get('content', '')).startswith('[compacted') else m
           for i, m in enumerate(messages)]
    after = estimate_tokens(out)
    if after >= before:
        return None
    return out, {'before_tokens': before, 'after_tokens': after}
