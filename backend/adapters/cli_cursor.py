"""
Cursor CLI adapter — rides the local ``cursor-agent`` CLI's own subscription
login (Cursor Pro) instead of a metered API key.

Cursor's catalog entry advertises ``agent`` capability only, never ``chat``
(`backend/adapters/catalog.py`): "Cursor publishes no chat-completions
endpoint — its API runs agents, not models." An LLM node cannot target this
connection; only a Delegate node can. That distinction matters for the
security posture here and is the opposite call from the Claude CLI adapter:

  * `cli_claude.ClaudeCliAdapter` disables every tool (`--tools ""`) because
    it fronts a chat completion and must not have side effects.
  * This adapter leaves cursor-agent's tools ON, because running a delegated
    task *is* letting it read/write files and run commands — that is the
    product it is. The blast radius is contained by other means instead: a
    pinned, app-controlled cwd (never an arbitrary or caller-influenced
    directory), a scrubbed env, `--sandbox enabled`, and a hard timeout.

``-p/--print`` is documented by ``cursor-agent --help`` as having "access to
all tools, including write and shell." Running it headlessly also requires
``--force`` (cursor-agent's own docs: "allow commands unless explicitly
denied") — without it, any tool call that would normally prompt for approval
has nobody to answer and the process hangs until this module's own timeout
kills it. `--trust` is required for the same reason: cursor-agent's workspace
trust prompt is interactive-only, and headless has no interactive session to
answer it. Passing `--trust`/`--force` unattended is only safe because cwd is
never arbitrary — see `cli_shared.resolve_cwd`.

**This combination (`--force` + `--trust`, tools left on) is the one part of
this change that genuinely grants a spawned process real file/shell access on
this machine.** It is scoped by cwd pinning, env scrubbing, sandbox mode, and
a timeout, but it has not been exercised end-to-end against a real delegated
task in this review (the verifying account was over its Cursor usage quota at
review time — see the task summary). Flagged for explicit human sign-off
before this ships.

argv/cwd/env review, same discipline as the Claude adapter:

  * argv is a literal list handed to ``asyncio.create_subprocess_exec``
    (`cli_shared.run_cli`) — the prompt is one argv element, never
    interpolated into a shell string.
  * cwd is resolved via `cli_shared.resolve_cwd`.
  * env is `cli_shared.scrub_env()` — no inherited secrets, no
    ``CURSOR_API_KEY``.
  * every spawn is timeboxed and killed on timeout/cancellation.

Native Windows remains blocked by SEC-2 because Cursor's sandbox helper is
disabled there. On Windows this adapter instead invokes the Linux CLI inside
WSL2, where ``--sandbox enabled`` has a real filesystem boundary. ``wsl.exe``
and the Linux executable receive a literal argv list (no shell string), while
the prompt continues to travel only through stdin. Elsewhere `cursor-agent`
is invoked directly.
"""
from __future__ import annotations

import json
import os
from shutil import which
from typing import Any, AsyncIterator, Callable, Coroutine

from .base import AdapterConfig, AdapterResult, AgentAdapter, ProbeResult
from .cli_shared import (
    CliRunResult,
    find_cli,
    is_windows,
    resolve_cwd,
    run_cli,
    scrub_env,
)

CLI_NAME = "cursor-agent"
# Delegated tasks run real tools and can take much longer than a chat turn.
DEFAULT_TIMEOUT_S = 600.0

Runner = Callable[..., Coroutine[Any, Any, CliRunResult]]

WSL_DISTRO = "Ubuntu-24.04"


def _windows_wsl_prefix() -> list[str] | None:
    """Run Cursor in WSL2, where its Linux filesystem sandbox is real.

    The Linux executable is invoked directly (no shell); prompts still travel
    over stdin. Native Windows cursor-agent is intentionally never returned
    because SEC-2 remains true for that runtime.
    """
    wsl = which("wsl") or which("wsl.exe")
    if not wsl:
        return None
    distro = (
        os.environ.get("OHARNESS_CURSOR_WSL_DISTRO")
        or os.environ.get("OPENHARNESS_CURSOR_WSL_DISTRO")  # legacy name
        or WSL_DISTRO
    )
    windows_user = os.environ.get("USERNAME", "")
    linux_home = (
        os.environ.get("OHARNESS_CURSOR_WSL_HOME")
        or os.environ.get("OPENHARNESS_CURSOR_WSL_HOME")  # legacy name
        or f"/home/{windows_user}"
    )
    return [wsl, "-d", distro, "--", f"{linux_home}/.local/bin/cursor-agent"]


def _invocation_prefix() -> list[str] | None:
    """Argv prefix that launches cursor-agent, or None if it cannot be found."""
    if is_windows():
        return _windows_wsl_prefix()
    direct = find_cli(CLI_NAME)
    return [direct] if direct else None


class CursorCliAdapter(AgentAdapter):
    """Agent-only. Tool execution stays on; see module docstring for why that
    is safe here and not in the Claude chat adapter.

    ``runner`` is injectable so tests can assert on argv/cwd/env without
    starting a process — the default is the real `cli_shared.run_cli`.
    """

    def __init__(self, *, runner: Runner = run_cli, timeout: float = DEFAULT_TIMEOUT_S) -> None:
        self._runner = runner
        self._timeout = timeout

    def _prefix(self) -> list[str]:
        prefix = _invocation_prefix()
        if not prefix:
            raise FileNotFoundError(
                "cursor-agent CLI not found on PATH. Install the Cursor CLI and run "
                "`cursor-agent login`, or switch this connection's runtime to API."
            )
        return prefix

    def build_argv(self, config: AdapterConfig) -> list[str]:
        # Prompt is not here — see `invoke()`. SEC-1 (harness Security Gate,
        # 2026-09-11): a prompt starting with "-" is parsed as a flag when
        # passed positionally, proven exploitable against the Claude CLI and
        # flagged as "same class" here. Read from stdin instead.
        argv = [
            *self._prefix(),
            "-p",
            "--output-format",
            "json",
            "--trust",  # cwd is app-pinned (see cli_shared.resolve_cwd) — safe to trust unattended
            "--force",  # headless: nobody can answer an interactive approval prompt
            # Hardcoded, not caller-configurable. Native Windows remains
            # blocked by SEC-2; the Windows route runs this inside WSL2.
            "--sandbox",
            "enabled",
        ]
        if config.model:
            argv += ["--model", config.model]
        return argv

    def _windows_gate(self) -> str | None:
        """SEC-2 (harness Security Gate, 2026-09-11): `--sandbox enabled`
        provides no filesystem isolation in the native Windows CLI — confirmed from
        cursor-agent's own bundled source (`isSandboxHelperSupported()`
        returns false unconditionally on win32; the shipped default map sets
        `sandbox_force_disable_win32: true`). Combined with `--force --trust`
        (required for headless use), a delegated task on this platform has
        real, unsandboxed file/shell access. Native execution therefore stays
        blocked. Windows is allowed only when `_windows_wsl_prefix()` can route
        the task to Cursor's Linux CLI under WSL2.
        """
        if is_windows() and _windows_wsl_prefix() is None:
            return (
                "Cursor delegation on Windows requires Cursor Agent inside WSL2 "
                "because the native Windows CLI has no filesystem sandbox (SEC-2). "
                "Install cursor-agent in Ubuntu-24.04 and sign in there, or set "
                "OHARNESS_CURSOR_WSL_DISTRO to a prepared distribution."
            )
        return None

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        gate = self._windows_gate()
        if gate:
            return AdapterResult(content="", error=gate)
        argv = self.build_argv(config)
        cwd = resolve_cwd(config.extra.get("cwd"), root=config.extra.get("cwd_root"))
        env = scrub_env()
        timeout = float(config.extra.get("timeout_s", self._timeout))
        result = await self._runner(argv, cwd=cwd, env=env, timeout=timeout, stdin=prompt)

        if result.timed_out:
            return AdapterResult(content="", error=f"cursor-agent timed out after {timeout:.0f}s")
        if result.returncode != 0:
            return AdapterResult(
                content="",
                error=_last_line(result.stderr) or f"cursor-agent exited {result.returncode}",
            )

        return _parse_result(result.stdout)

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        # cursor-agent's --output-format json is a single completed result in
        # print mode; --output-format stream-json exists but its event shape
        # is unverified in this review (see module docstring). One completed
        # chunk is a true and reasonable stream for now.
        result = await self.invoke(prompt, config)
        if result.error:
            raise RuntimeError(result.error)
        yield result.content

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        gate = self._windows_gate()
        if gate:
            return ProbeResult(ok=False, health="setup", detail=gate)

        prefix = _invocation_prefix()
        if not prefix:
            return ProbeResult(
                ok=False,
                health="setup",
                detail="cursor-agent CLI not found on PATH. Install it, then run `cursor-agent login`.",
            )

        cwd = resolve_cwd(config.extra.get("cwd"), root=config.extra.get("cwd_root"))
        env = scrub_env()
        # `status --format json` reads the local session; it never spends
        # model usage (verified live — see task summary).
        result = await self._runner([*prefix, "status", "--format", "json"], cwd=cwd, env=env, timeout=15)

        if result.timed_out:
            return ProbeResult(ok=False, health="fault", detail="cursor-agent did not respond to `status`.")
        if result.returncode != 0:
            return ProbeResult(
                ok=False,
                health="fault",
                detail=_last_line(result.stderr) or f"cursor-agent status exited {result.returncode}.",
            )

        try:
            status = json.loads(result.stdout)
        except json.JSONDecodeError:
            return ProbeResult(ok=False, health="fault", detail="cursor-agent status returned unreadable output.")

        if not status.get("isAuthenticated"):
            return ProbeResult(
                ok=False,
                health="setup",
                detail="cursor-agent CLI is installed but not logged in. Run `cursor-agent login`.",
            )

        user = status.get("userInfo") or {}
        email = user.get("email", "")
        facts = [
            f for f in [
                ("account", email, "dim"),
                ("cli", f"{CLI_NAME} · on PATH", "signal"),
            ]
            if f[1]
        ]
        return ProbeResult(
            ok=True,
            health="live",
            detail=f"Logged in as {email or 'unknown'}. Delegation only — no completion endpoint exists.",
            facts=facts,
        )


def _parse_result(stdout: str) -> AdapterResult:
    """
    Extract completion text from cursor-agent's ``--output-format json``.

    The exact success shape was not observed live in this review — the
    verifying account was over its Cursor usage quota (a real, subscription
    -only response: "You've saved $497 on API model usage this month with
    Pro"), which proved the spawn/auth/argv path end-to-end but not the
    result payload's field names. This checks the field names Cursor's own
    docs and the Claude Code CLI's own ``result`` convention suggest, then
    falls back to raw stdout rather than silently returning nothing. Flagged
    for a human to confirm against a real successful run.
    """
    try:
        payload = json.loads(stdout)
    except json.JSONDecodeError:
        return AdapterResult(content=stdout.strip())

    if isinstance(payload, dict):
        if payload.get("is_error") or payload.get("error"):
            return AdapterResult(content="", error=str(payload.get("error") or payload.get("result") or "cursor-agent reported an error"))
        for key in ("result", "output", "text", "message", "response"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return AdapterResult(content=value)
        # Valid JSON, no error flag, but none of the known content keys held
        # a non-empty string. Silently returning raw stdout here (SEC P3-3,
        # harness Security Gate 2026-09-11) would let an unrecognised
        # response shape — or a genuinely empty success — pass downstream as
        # if it were real content. Fail loud instead; the exact shape is
        # still unverified against a real successful run (see module
        # docstring), so a human should see this rather than have it hidden.
        return AdapterResult(
            content="",
            error="cursor-agent returned JSON with no recognised result field — response shape unverified, not treating as success.",
        )

    return AdapterResult(content=stdout.strip())


def _last_line(text: str) -> str:
    stripped = text.strip()
    return stripped.splitlines()[-1] if stripped else ""
