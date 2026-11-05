"""`oharness factory validate <dir> [--check]`: 0 valid, 1 invalid, 2 folder missing (ADR 0056)."""
from __future__ import annotations

import json
import runpy
import sys

import pytest

from factory_definition_files import agent_md
from oharness.cli import main


def _run(capsys, *args):
    code = main(['forja', 'validate', *map(str, args)])
    return code, json.loads(capsys.readouterr().out)


def test_a_valid_definition_exits_zero_and_prints_its_hash(make_definition, capsys):
    code, out = _run(capsys, make_definition())
    assert code == 0 and out['ok'] is True and len(out['hash']) == 64 and out['errors'] == []


def test_an_invalid_definition_exits_one_and_names_the_field(make_definition, capsys):
    code, out = _run(capsys, make_definition({'agents/builder/agent.md': agent_md('implement', 'openai/gpt-4o', 'full')}))
    assert code == 1 and out['ok'] is False and out['hash'] is None
    assert out['errors'][0]['path'] == 'agents.builder.permissions.mode' and out['errors'][0]['file'] == 'agents/builder/agent.md'


def test_a_missing_folder_exits_two(tmp_path, capsys):
    code, out = _run(capsys, tmp_path / 'nope')
    assert code == 2 and out['ok'] is False


def test_check_runs_the_mock_walk(make_definition, capsys):
    code, out = _run(capsys, make_definition(), '--check')
    assert code == 0 and [e['name'] for e in out['check']['examples']] == ['small-fix', 'needs-spec', 'ambiguous']


def test_the_module_entry_point_works_from_a_terminal(make_definition, capsys, monkeypatch):
    root = make_definition()
    monkeypatch.setattr(sys, 'argv', ['oharness', 'forja', 'validate', str(root)])
    with pytest.raises(SystemExit) as stop:
        runpy.run_module('oharness', run_name='__main__')  # what `python -m oharness` does
    assert stop.value.code == 0
    assert json.loads(capsys.readouterr().out)['ok'] is True
