"""The UI rules table must equal run_budget.RUN_BUDGET_RULES (one rule, two readers)."""
import re
from pathlib import Path

from run_budget import RUN_BUDGET_RULES

TS = Path(__file__).resolve().parents[2] / 'frontend/src/components/agent-run/runBudgetRules.ts'


def test_ui_table_matches_validator_table():
    text = TS.read_text(encoding='utf-8')
    pair = re.search(r'maxTokens:\s*\{\s*min:\s*([\d_]+),\s*max:\s*([\d_]+)\s*\}', text)
    compact = re.search(r'compactAtTokens:\s*([\d_]+)', text)
    as_int = lambda raw: int(raw.replace('_', ''))
    assert as_int(pair.group(1)) == RUN_BUDGET_RULES['max_tokens']['min']
    assert as_int(pair.group(2)) == RUN_BUDGET_RULES['max_tokens']['max']
    assert as_int(compact.group(1)) == RUN_BUDGET_RULES['compact_at_tokens']
    assert set(RUN_BUDGET_RULES) == {'max_tokens', 'compact_at_tokens'}
