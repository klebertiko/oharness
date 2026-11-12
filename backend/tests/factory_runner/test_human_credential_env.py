"""The human credential (ADR 0055) lives in the sidecar's environment only; nothing the sidecar spawns may inherit it."""
from __future__ import annotations

from adapters.cli_shared import scrub_env
from factory.auth import HUMAN_ENV
from sandbox.exec import scrub_env as sandbox_scrub_env


def test_tool_and_cli_environments_never_carry_the_human_credential(monkeypatch):
    monkeypatch.setenv(HUMAN_ENV, 'human-secret')
    monkeypatch.setenv('OH_SIDECAR_TOKEN', 'sidecar-secret')
    for scrub in (scrub_env, sandbox_scrub_env):
        env = scrub({'EXTRA': '1'})
        assert 'human-secret' not in env.values()
        assert 'sidecar-secret' not in env.values()
        assert HUMAN_ENV not in {key.upper() for key in env}
