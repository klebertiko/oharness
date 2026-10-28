"""The UI rules table must equal sandbox.hooks.HOOK_RULES (one rule, two readers)."""
import re
from pathlib import Path

from sandbox.hooks import HOOK_RULES

TS = (Path(__file__).resolve().parents[2] / 'frontend/src/lib/toolHookRules.ts').read_text(encoding='utf-8')


def test_ui_table_matches_validator_table():
    pattern = re.search(r'idPattern: /(.+)/,', TS).group(1)
    assert pattern == HOOK_RULES['id_pattern']
    t = re.search(r'timeoutS: \{ min: (\d+), max: (\d+), default: (\d+) \}', TS)
    assert tuple(map(int, t.groups())) == tuple(HOOK_RULES['timeout_s'][k] for k in ('min', 'max', 'default'))
    assert re.search(r'tools: (\[.*?\])', TS).group(1).replace('"', "'").replace(', ', ', ') == str(HOOK_RULES['tools'])
    assert int(re.search(r'argvMaxItems: (\d+)', TS).group(1)) == HOOK_RULES['argv_max_items']
    denied = re.search(r'deniedPrograms: \[(.*?)\]', TS).group(1)
    assert re.findall(r'"([^"]+)"', denied) == HOOK_RULES['denied_programs']
