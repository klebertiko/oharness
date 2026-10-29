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


def parse_run_budget(value) -> RunBudget:
    """The one way a request's `max_tokens` becomes a budget; raises ValueError('invalid_run_budget')."""
    return RunBudget(validate_max_tokens(value))


def token_count(value) -> int:
    """Tokens off an event, tolerant of anything malformed (a bad count must never fail a run)."""
    try:
        return max(0, int(value or 0))
    except (TypeError, ValueError, OverflowError):
        return 0


class HarnessCeiling:
    """Decides, from a harness run's own events, when its token ceiling has been reached with work still to do.

    Nodes are one provider call each, so the check runs between nodes: the node that crosses the
    ceiling finishes, then the run stops. A run whose last planned node crosses it is left as it ended.
    A node a Gate sends back (`gate_retry`) is work still to do. `spent` may start above zero when the
    routing call already used tokens.
    """

    def __init__(self, budget: RunBudget, spent: int = 0):
        self.budget, self.spent, self.hit = budget, spent, False
        self.planned: list = []
        self.finished: set = set()

    def observe(self, name: str, data: dict):
        """Feed one event; returns the `budget_exceeded` payload once, when the run must stop."""
        if self.hit or self.budget.max_tokens is None:
            return None
        if name == 'run_start':
            self.planned = [n.get('node_id') for n in data.get('order', []) if isinstance(n, dict)]
        elif name == 'node_start':
            self.finished.discard(data.get('node_id'))
        elif name in ('node_restored', 'node_skipped'):
            self.finished.add(data.get('node_id'))
        elif name in ('node_done', 'node_error'):
            self.finished.add(data.get('node_id'))
            self.spent += token_count(data.get('tokens'))
        if name not in ('run_start', 'node_done', 'node_error', 'gate_retry') or not self.budget.exceeded(self.spent):
            return None
        if name == 'gate_retry' or any(n not in self.finished for n in self.planned):
            self.hit = True
            return {'max_tokens': self.budget.max_tokens, 'used_tokens': self.spent}
        return None
