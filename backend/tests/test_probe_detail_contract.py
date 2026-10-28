"""Which failure classes the front end may infer from a probe's `detail`.

Issue #84. A probe reports `health` plus free text in `detail`; the front end
turns that into one next step (key rejected, unreachable, rate limited, out of
credits, sign in, install, unknown). That is only safe if every failing
`detail` an adapter can emit has exactly one class, and anything the front end
cannot recognise falls back to `unknown` rather than to a wrong class.

`CONTRACT` is that table. The tests keep it honest in both directions: an
adapter that adds or rewords a failing `detail` fails here until the table (and
the front-end classifier that reads it) is updated.
"""

from __future__ import annotations

import ast
import asyncio
import re
from pathlib import Path

import httpx
import pytest
from adapters.base import AdapterConfig
from adapters.openai_compatible import OpenAICompatibleAdapter

ADAPTERS = Path(__file__).resolve().parents[1] / "adapters"

# template as written in the adapter source -> class
# `{x}` marks an interpolated value; `<expr>` a non-literal expression.
CONTRACT: dict[str, str] = {
    # Anthropic-compatible / OpenAI-compatible HTTP probes (openai_compatible.py)
    "401 unauthorized — the key was rejected or has been revoked.": "key-rejected",
    "Could not reach {origin}.": "unreachable",
    "{origin} did not respond in time.": "unreachable",
    "Could not reach {endpoint}.": "unreachable",
    "{endpoint} did not respond in time.": "unreachable",
    # status decides: 401/403 key-rejected, 402 out-of-credits, 429 rate-limited, other unknown
    "HTTP {version_status} from {origin}.": "by-status",
    "HTTP {status_code} from {endpoint}.": "by-status",
    "{endpoint} sent a model list larger than 2 MB.": "unknown",
    "<str(exc)>": "unknown",
    # CLI probes (cli_claude.py, cli_codex.py, cli_cursor.py)
    "claude CLI not found on PATH. Install Claude Code, then run `claude login`.": "cli-missing",
    "codex CLI not found on PATH. Install it, then run `codex login`.": "cli-missing",
    "cursor-agent CLI not found on PATH. Install it, then run `cursor-agent login`.": "cli-missing",
    "claude CLI is installed but not logged in. Run `claude login`.": "cli-signin",
    "codex CLI is installed but not logged in. Run `codex login`.": "cli-signin",
    "cursor-agent CLI is installed but not logged in. Run `cursor-agent login`.": "cli-signin",
    "claude CLI did not respond to `claude auth status`.": "unknown",
    "codex CLI did not respond to `codex login status`.": "unknown",
    "cursor-agent did not respond to `status`.": "unknown",
    "claude auth status returned unreadable output.": "unknown",
    "cursor-agent status returned unreadable output.": "unknown",
    "<_last_line(result.stderr) or f'claude auth status exited {result.returncode}.'>": "unknown",
    "<_last_line(result.stderr) or f'codex login status exited {result.returncode}.'>": "unknown",
    "<_last_line(result.stderr) or f'cursor-agent status exited {result.returncode}.'>": "unknown",
    # platform gates: health "setup" but neither missing nor signed out
    "<gate>": "unknown",
    # adapter without a probe
    "The {config.adapter} adapter does not implement a probe yet.": "unknown",
}

# Success details: ok=True, never classified as a failure.
SUCCESS = {
    "<detail>",
    "Reachable.",
    "<text or 'Logged in.'>",
    "Logged in as {email or 'unknown'} ({plan or 'unknown'} plan).",
    "Logged in as {email or 'unknown'}. Delegation only — no completion endpoint exists.",
}

FAILING_STATUS_CLASS = {401: "key-rejected", 403: "key-rejected", 402: "out-of-credits", 429: "rate-limited"}


def _render(node: ast.AST) -> str:
    if isinstance(node, ast.Constant):
        return str(node.value)
    if isinstance(node, ast.JoinedStr):
        return "".join(
            v.value if isinstance(v, ast.Constant) else "{" + ast.unparse(v.value) + "}" for v in node.values
        )
    return "<" + ast.unparse(node) + ">"


def _emitted_details() -> set[str]:
    found: set[str] = set()
    for source in sorted(ADAPTERS.glob("*.py")):
        for call in ast.walk(ast.parse(source.read_text(encoding="utf-8"))):
            if isinstance(call, ast.Call) and getattr(call.func, "id", None) == "ProbeResult":
                for kw in call.keywords:
                    if kw.arg == "detail":
                        found.add(_render(kw.value))
    return found


def classify(health: str, detail: str) -> str:
    """Reference rules the front-end classifier must reproduce."""
    text = detail.lower()
    status = re.match(r"^http (\d{3}) from ", text)
    if status:
        return FAILING_STATUS_CLASS.get(int(status.group(1)), "unknown")
    if text.startswith("401 unauthorized"):
        return "key-rejected"
    if re.match(r"^could not reach \S+\.$", text) or re.match(r"^\S+ did not respond in time\.$", text):
        return "unreachable"
    if health == "setup" and " cli not found on path." in text:
        return "cli-missing"
    if health == "setup" and " cli is installed but not logged in." in text:
        return "cli-signin"
    return "unknown"


def test_every_failing_detail_an_adapter_emits_has_a_class() -> None:
    emitted = _emitted_details() - SUCCESS
    assert emitted - CONTRACT.keys() == set(), "new probe detail without a class"
    assert CONTRACT.keys() - emitted == set(), "table lists a detail no adapter emits any more"


@pytest.mark.parametrize(
    ("status", "expected"),
    [(401, "key-rejected"), (403, "key-rejected"), (402, "out-of-credits"), (429, "rate-limited"), (404, "unknown"), (500, "unknown"), (503, "unknown")],
)
def test_http_failures_from_a_real_probe_are_classified_by_status(status: int, expected: str) -> None:
    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(lambda _r: httpx.Response(status)))
    probe = asyncio.run(adapter.probe(AdapterConfig(adapter="openai", model="", endpoint="http://fake/v1", api_key="k")))
    assert probe.ok is False
    assert classify(probe.health, probe.detail) == expected


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (httpx.ConnectError("refused"), "unreachable"),
        (httpx.ConnectTimeout("slow"), "unreachable"),
        (httpx.ReadError("reset"), "unknown"),
        (httpx.TooManyRedirects("loop"), "unknown"),
    ],
)
def test_transport_failures_never_become_a_wrong_class(error: Exception, expected: str) -> None:
    def handler(_r: httpx.Request) -> httpx.Response:
        raise error

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    probe = asyncio.run(adapter.probe(AdapterConfig(adapter="openai", model="", endpoint="http://fake/v1", api_key="k")))
    assert probe.ok is False
    assert classify(probe.health, probe.detail) == expected


@pytest.mark.parametrize(
    ("health", "detail", "expected"),
    [
        ("setup", "claude CLI not found on PATH. Install Claude Code, then run `claude login`.", "cli-missing"),
        ("setup", "codex CLI is installed but not logged in. Run `codex login`.", "cli-signin"),
        ("setup", "Codex chat completions are not yet verified on this platform (security review).", "unknown"),
        ("fault", "claude CLI did not respond to `claude auth status`.", "unknown"),
        ("fault", "error: not found on PATH, not logged in", "unknown"),
        ("fault", "Error: HTTP 429 from the shell", "unknown"),
    ],
)
def test_cli_details_and_free_text(health: str, detail: str, expected: str) -> None:
    assert classify(health, detail) == expected
