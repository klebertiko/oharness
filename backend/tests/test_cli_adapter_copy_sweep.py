"""#394 / R-PRV-13: CLI adapter copy never tells the user to switch the runtime to API.

A subscription connection (credential.kind=cli) cannot "switch to API" from the
place the message is shown; the real next step is to install or sign in to the CLI.
This sweep reads the adapter sources and the fixed failure texts so the old
instruction cannot come back in any of the three CLI adapters.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from adapters.cli_shared import CLI_FAILURE_MESSAGES, CLI_MISSING, CLI_SIGNIN

ADAPTERS_DIR = Path(__file__).resolve().parent.parent / "adapters"
CLI_ADAPTER_SOURCES = ["cli_claude.py", "cli_codex.py", "cli_cursor.py", "cli_shared.py"]

# Joined across implicit string concatenation by normalizing quotes/whitespace first.
FORBIDDEN = re.compile(r"runtime\s+to\s+api|switch\s+this\s+connection", re.IGNORECASE)


def _flatten(source: str) -> str:
    """Join adjacent string literals so a phrase split across lines is still found."""
    return re.sub(r"[\"']\s*\n\s*[\"']", "", source)


@pytest.mark.parametrize("filename", CLI_ADAPTER_SOURCES)
def test_cli_adapter_source_never_says_switch_runtime_to_api(filename: str) -> None:
    source = (ADAPTERS_DIR / filename).read_text(encoding="utf-8")
    match = FORBIDDEN.search(_flatten(source))
    assert match is None, f"{filename} still tells the user to {match.group(0)!r}"


def test_every_cli_failure_message_avoids_the_api_switch() -> None:
    for failure, text in CLI_FAILURE_MESSAGES.items():
        assert not FORBIDDEN.search(text), f"{failure}: {text!r}"


def test_missing_and_signin_point_to_the_real_step() -> None:
    assert re.search(r"\binstall\b", CLI_FAILURE_MESSAGES[CLI_MISSING], re.IGNORECASE)
    assert re.search(r"\bsign in\b", CLI_FAILURE_MESSAGES[CLI_SIGNIN], re.IGNORECASE)
