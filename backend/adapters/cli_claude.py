"""
Claude Code CLI adapter — rides the local ``claude`` CLI's own subscription
login (Claude Pro/Max) instead of a metered Anthropic API key.

Spawns ``claude -p <prompt>`` in non-interactive print mode with tool
execution disabled (``--tools ""``). The anthropic catalog entry only
advertises the ``chat`` capability (`backend/adapters/catalog.py`), so this
adapter must behave like a single completion call — not a full agentic coding
session with file/shell/MCP access. That is a deliberate security choice, not
an oversight: nothing about "pick Anthropic in the chat composer" should let a
node read or write files on this machine.

This replaces the former ``LIVE_SPAWN``-gated ``CliClaudeStub``, which only
recorded argv while a reviewed spawn path was pending. The review:

  * argv is a literal list handed to ``asyncio.create_subprocess_exec``
    (`cli_shared.run_cli`) — the prompt is one argv element, never
    interpolated into a shell string.
  * cwd is resolved via `cli_shared.resolve_cwd` — a caller-pinned project
    directory if one validates as a real path, else a fixed app-owned
    default. Never the sidecar's ambient cwd.
  * env is `cli_shared.scrub_env()` — PATH/USERPROFILE/APPDATA/… only. No
    inherited secrets, no ``ANTHROPIC_API_KEY``.
  * ``--tools ""`` strips every built-in tool (Bash, Edit, Read, …) and
    ``--strict-mcp-config`` (with no ``--mcp-config`` given) loads zero MCP
    servers, so there is nothing left for `--permission-prompts none` to
    silently deny — it is a defense-in-depth belt, not the main mechanism.
  * every spawn is timeboxed and killed on timeout/cancellation
    (`cli_shared.run_cli`).
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Callable, Coroutine

from .base import AdapterConfig, AdapterResult, AgentAdapter, ProbeResult
from .cli_shared import (
    DEFAULT_TIMEOUT_S,
    CliFailure,
    CliMissing,
    CliRunResult,
    classify_cli_failure,
    find_cli,
    resolve_cwd,
    run_cli,
    scrub_env,
)

CLI_NAME = "claude"

Runner = Callable[..., Coroutine[Any, Any, CliRunResult]]


class ClaudeCliAdapter(AgentAdapter):
    """Chat-only: tool execution is disabled on every invocation.

    ``runner`` is injectable so tests can assert on the exact argv/cwd/env a
    call would spawn without actually starting a process — the default is the
    real `cli_shared.run_cli`.
    """

    def __init__(self, *, runner: Runner = run_cli, timeout: float = DEFAULT_TIMEOUT_S) -> None:
        self._runner = runner
        self._timeout = timeout

    def cli_argv_prefix(self) -> list[str] | None:
        """Argv prefix that launches this CLI, or None when it is not installed.
        Detection (``runtime/cli_detect.py``) appends ``--version`` to it."""
        path = find_cli(CLI_NAME)
        return [path] if path else None

    def _binary(self) -> str:
        # Injectable runner: tests record argv without requiring a real binary on PATH.
        if self._runner is not run_cli:
            return CLI_NAME
        path = find_cli(CLI_NAME)
        if not path:
            raise CliMissing()
        return path

    def build_argv(self, config: AdapterConfig) -> list[str]:
        # The prompt is deliberately NOT here — see `invoke()`. SEC-1 (harness
        # Security Gate, 2026-09-11): a prompt passed as a positional argv
        # element is parsed by claude's own CLI as a flag when it starts with
        # "-" (there is no `--` end-of-options separator in front of it),
        # proven exploitable via `--settings=<hostile JSON>` executing an
        # attacker-chosen shell command through Claude Code's own hooks
        # feature — a complete bypass of `--tools ""`. `-p` with no following
        # value puts the CLI in "read the prompt from stdin" mode instead
        # (confirmed by the CLI's own error text: "Input must be provided
        # either through stdin or as a prompt argument when using --print").
        argv = [
            self._binary(),
            "-p",
            "--output-format",
            "json",
            "--tools",
            "",  # chat-only — no Bash/Edit/file access from a spawned node
            "--permission-prompts",
            "none",  # never hang waiting on an approval nobody can answer
            "--no-session-persistence",
            "--strict-mcp-config",  # no project/user MCP servers loaded either
            "--setting-sources",
            "",  # SEC-5: --tools "" leaves hooks reachable via user/project
                 # settings otherwise — this drops those settings sources too
        ]
        if config.model:
            argv += ["--model", config.model]
        if config.system_prompt:
            argv += ["--system-prompt", config.system_prompt]
        return argv

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        argv = self.build_argv(config)
        cwd = resolve_cwd(config.extra.get("cwd"), root=config.extra.get("cwd_root"))
        env = scrub_env()
        timeout = float(config.extra.get("timeout_s", self._timeout))
        result = await self._runner(argv, cwd=cwd, env=env, timeout=timeout, stdin=prompt)

        if result.timed_out:
            return AdapterResult(content="", error=f"claude CLI timed out after {timeout:.0f}s", failure="cli-timeout")
        if result.returncode != 0:
            return AdapterResult(
                content="",
                error=_last_line(result.stderr) or f"claude CLI exited {result.returncode}",
                failure=classify_cli_failure(returncode=result.returncode, text=result.stderr),
            )

        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError:
            # --output-format json is always requested above; a non-JSON
            # stdout means something upstream changed. Fail loud rather than
            # guess at the shape.
            return AdapterResult(content="", error="claude CLI returned unreadable output (expected JSON).", failure="cli-error")

        if payload.get("is_error"):
            reported = str(payload.get("result") or "claude CLI reported an error")
            return AdapterResult(
                content="", error=reported, failure=classify_cli_failure(returncode=1, text=reported),
            )

        usage = payload.get("usage") or {}
        tokens = int(usage.get("input_tokens", 0)) + int(usage.get("output_tokens", 0))
        return AdapterResult(
            content=str(payload.get("result", "")),
            tokens_used=tokens,
            model=config.model or "",
        )

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        # claude -p --output-format json is a single completed result, not a
        # token stream we can tap mid-flight — one chunk is a true and
        # reasonable stream for a single-shot invocation.
        result = await self.invoke(prompt, config)
        if result.error:
            raise CliFailure(result.failure)
        yield result.content

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        path = find_cli(CLI_NAME)
        if not path:
            return ProbeResult(
                ok=False,
                health="setup",
                code="not_installed",
                detail="claude CLI not found on PATH. Install Claude Code, then run `claude login`.",
            )

        cwd = resolve_cwd(config.extra.get("cwd"), root=config.extra.get("cwd_root"))
        env = scrub_env()
        # `claude auth status` reads the local session; it never spends tokens.
        result = await self._runner([path, "auth", "status"], cwd=cwd, env=env, timeout=15)

        if result.timed_out:
            return ProbeResult(ok=False, health="fault", code="timeout", detail="claude CLI did not respond to `claude auth status`.")
        if result.returncode != 0:
            return ProbeResult(
                ok=False,
                health="fault",
                code="error",
                detail=_last_line(result.stderr) or f"claude auth status exited {result.returncode}.",
            )

        try:
            status = json.loads(result.stdout)
        except json.JSONDecodeError:
            return ProbeResult(ok=False, health="fault", code="error", detail="claude auth status returned unreadable output.")

        if not status.get("loggedIn"):
            return ProbeResult(
                ok=False,
                health="setup",
                code="not_logged_in",
                detail="claude CLI is installed but not logged in. Run `claude login`.",
            )

        email = status.get("email", "")
        plan = status.get("subscriptionType", "")
        facts = [
            f for f in [
                ("account", email, "dim"),
                ("plan", plan, "signal"),
                ("cli", f"{CLI_NAME} · on PATH", "signal"),
            ]
            if f[1]
        ]
        return ProbeResult(
            ok=True,
            health="live",
            detail=f"Logged in as {email or 'unknown'} ({plan or 'unknown'} plan).",
            facts=facts,
        )


def _last_line(text: str) -> str:
    stripped = text.strip()
    return stripped.splitlines()[-1] if stripped else ""
