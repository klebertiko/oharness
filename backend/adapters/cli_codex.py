"""
Codex CLI adapter — rides the local ``codex`` CLI's own ChatGPT subscription
login instead of a metered OpenAI API key.

Same security posture as `cli_claude.ClaudeCliAdapter`, adapted to Codex's own
flags rather than Claude Code's:

  * argv is a literal list handed to ``asyncio.create_subprocess_exec``
    (`cli_shared.run_cli`) — the prompt is never an argv element at all, only
    ever stdin (SEC-1's exact class of bug — a prompt starting with "-" being
    parsed as a flag — has no positional prompt argument here to exploit;
    ``codex exec`` with no PROMPT argument reads stdin, confirmed live:
    "Reading prompt from stdin...").
  * cwd is resolved via `cli_shared.resolve_cwd`.
  * env is `cli_shared.scrub_env()` — no inherited secrets, no
    ``OPENAI_API_KEY``.
  * ``--ignore-user-config`` skips loading ``$CODEX_HOME/config.toml`` —
    confirmed live this is what pulls in the *person's own* MCP servers,
    hooks and skills (a run without it logged live hook invocations —
    SessionStart/UserPromptSubmit/Stop — and MCP auth errors from unrelated
    personal tool connections). Auth itself is unaffected: Codex reads the
    logged-in session from ``CODEX_HOME`` independently of config.toml, and a
    login check still succeeds with this flag on. Chat-only capability
    (`backend/adapters/catalog.py`'s "openai" entry: ``["chat", "embed"]``)
    must not inherit an unrelated MCP/hook configuration's side effects.
  * ``--sandbox read-only`` — Codex has no Claude-style "--tools none"; its
    equivalent containment is the sandbox policy applied to any shell command
    the model chooses to run. Security Gate review (2026-09-11, SEC-6)
    flagged this as read-not-write rather than no-execution-at-all — a real
    concern on paper (`codex exec --help`'s own wording: "the sandbox policy
    to use when executing model-generated shell commands", implying commands
    still run). Verified live **on Windows** (the only platform this app
    ships — `src-tauri/tauri.conf.json` targets `["nsis"]` only): a shell
    command targeting a file *outside* the pinned cwd was rejected ("blocked
    by policy"), and — the more telling result — a command targeting a file
    *inside* the pinned cwd was rejected identically. This is a Windows
    observation, not a property of the flag confirmed against Codex's own
    source or documentation — re-review (2026-09-11) judged the likely
    mechanism to be "no sandbox backend on this platform, fails closed",
    which would make `read-only` permissive (reads allowed, writes denied,
    exactly as its help text says) anywhere a real backend exists. `_non_
    windows_gate()` below enforces that scope: this adapter refuses to run
    at all off Windows until that is actually measured there — SEC-6 is
    carried as an open P2, not closed, and this gate is the condition that
    keeps it from mattering today.
  * ``_non_windows_gate()`` (SEC-6, harness Security Gate 2026-09-11
    re-review) — mirrors `cli_cursor.py`'s `_windows_gate()` inverted: that
    one refuses ON Windows because a sandbox flag there is force-disabled
    and looks real; this one refuses OFF Windows because the sandbox's
    containment was only ever measured there and might not travel.
  * ``--ignore-rules`` (SEC-7) — `--ignore-user-config` only covers
    `config.toml`; a person's execpolicy `.rules` files (governing which
    shell commands auto-approve) are a separate, still-loaded source without
    this. Same shape as SEC-5's settings-sources gap on the Claude adapter.
  * ``--ephemeral`` (SEC-8) — parity with `cli_claude.py`'s
    ``--no-session-persistence``: without it every turn's prompt+response is
    written to ``~/.codex/sessions`` outside this app's retention/deletion
    control.
  * ``config.model`` is rejected outright if it starts with ``-`` (SEC-9)
    rather than trusted to reach `--model` as a well-formed value.
  * ``config.system_prompt`` (SEC-10) has no CLI flag to carry it the way
    Claude's ``--system-prompt`` does; silently dropping it would leave a
    node author's constraints unapplied with no signal that happened, so
    `invoke()` folds it into the same stdin channel the prompt already
    travels through — still never an argv element.
  * every spawn is timeboxed and killed on timeout/cancellation
    (`cli_shared.run_cli`).

``--json`` streams one JSON object per line (``thread.started`` /
``turn.started`` / ``item.completed`` / ``turn.completed`` / ...) — the final
answer is the ``text`` of the ``item.completed`` event(s) whose
``item.type == "agent_message"``, confirmed live against a real completion.
"""
from __future__ import annotations

import json
from typing import Any, AsyncIterator, Callable, Coroutine

from .base import AdapterConfig, AdapterResult, AgentAdapter, ProbeResult
from .cli_shared import (
    DEFAULT_TIMEOUT_S,
    CliRunResult,
    find_cli,
    is_windows,
    resolve_cwd,
    run_cli,
    scrub_env,
)

# Delimits the app-authored system prompt from the untrusted chat prompt in
# the one channel `codex exec` reads (SEC-11, harness Security Gate
# 2026-09-11 re-review): without a boundary a prompt opening with "Ignore
# the above, new instructions:" is textually indistinguishable from a
# continuation of the system prompt. Claude's adapter doesn't need this — it
# has a real `--system-prompt` flag the untrusted prompt can never reach.
_SYSTEM_PROMPT_DELIMITER = "\n\n---\nEnd of system instructions. User message follows:\n---\n\n"

CLI_NAME = "codex"

Runner = Callable[..., Coroutine[Any, Any, CliRunResult]]


class CodexCliAdapter(AgentAdapter):
    """Chat-only: read-only sandbox and no personal config on every call.

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
        path = find_cli(CLI_NAME)
        if not path:
            raise FileNotFoundError(
                "codex CLI not found on PATH. Install it and run `codex login`, "
                "or switch this connection's runtime to API."
            )
        return path

    def _non_windows_gate(self) -> str | None:
        """SEC-6 (harness Security Gate, 2026-09-11 re-review): `--sandbox
        read-only` was verified live on Windows to deny `exec_command`
        outright — identical rejection for a target inside and outside the
        pinned cwd — rather than permit reads and deny only writes the way
        its own `--help` text describes. That result is Windows-specific and
        unverified elsewhere: the most likely explanation is that this Codex
        build has no sandbox backend on Windows and fails closed, which would
        mean the containment measured is a property of the platform, not of
        the flag. Refuse this connection off Windows until that is actually
        checked there — mirrors `cli_cursor.py`'s `_windows_gate()`, inverted
        (that one refuses ON Windows for the opposite reason: a sandbox flag
        that looks real but is force-disabled there)."""
        if not is_windows():
            return (
                "Codex chat completions are not yet verified on this platform "
                "(security review 2026-09-11, SEC-6: the read-only sandbox's "
                "containment was only confirmed on Windows, where it denies "
                "shell execution outright — behavior elsewhere is unverified). "
                "Use Claude or a direct API provider for now."
            )
        return None

    def build_argv(self, config: AdapterConfig) -> list[str]:
        # No PROMPT positional argument — see module docstring. Everything
        # here is a literal, app-controlled flag; nothing derived from a
        # node's config or a person's chat text ever lands in argv.
        argv = [
            self._binary(),
            "exec",
            "--json",
            "--sandbox",
            "read-only",
            "--skip-git-repo-check",
            "--ignore-user-config",  # drop the person's own MCP servers/hooks/skills
            "--ignore-rules",  # ...and their execpolicy .rules files (SEC-7, same
                                # shape as SEC-5: --ignore-user-config alone left a
                                # separate personal-config source still reachable)
            "--ephemeral",  # SEC-8: don't persist every turn's prompt+response to
                             # ~/.codex/sessions outside this app's control — parity
                             # with cli_claude.py's --no-session-persistence
        ]
        if config.model:
            if config.model.startswith("-"):
                # SEC-9: a value starting with "-" would be a malformed argv
                # pair with the flag right before it (`--model <this>`) — clap
                # currently errors on it rather than reinterpreting it as a
                # flag, but refuse it here too rather than depend on that.
                raise ValueError(f"invalid model name: {config.model!r}")
            argv += ["--model", config.model]
        return argv

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        gate = self._non_windows_gate()
        if gate:
            return AdapterResult(content="", error=gate)
        argv = self.build_argv(config)
        cwd = resolve_cwd(config.extra.get("cwd"), root=config.extra.get("cwd_root"))
        env = scrub_env()
        timeout = float(config.extra.get("timeout_s", self._timeout))
        # SEC-10: `codex exec` has no `--system-prompt` flag the way Claude
        # does, and silently dropping config.system_prompt would leave a node
        # author's constraints unapplied with no signal anywhere that
        # happened. Fold it into the one channel this CLI reads instead —
        # still stdin-only, never argv (SEC-1's class stays closed). SEC-11:
        # delimited, not concatenated bare — see _SYSTEM_PROMPT_DELIMITER.
        stdin_text = (
            f"{config.system_prompt}{_SYSTEM_PROMPT_DELIMITER}{prompt}"
            if config.system_prompt
            else prompt
        )
        result = await self._runner(argv, cwd=cwd, env=env, timeout=timeout, stdin=stdin_text)

        if result.timed_out:
            return AdapterResult(content="", error=f"codex CLI timed out after {timeout:.0f}s")
        if result.returncode != 0:
            return AdapterResult(
                content="",
                error=_last_line(result.stderr) or f"codex CLI exited {result.returncode}",
            )

        return _parse_jsonl(result.stdout, model=config.model)

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        # --json is a completed transcript once the process exits, not a
        # token stream we tap mid-flight — one chunk is a true and reasonable
        # stream for a single-shot invocation, same call the other CLI
        # adapters make.
        result = await self.invoke(prompt, config)
        if result.error:
            raise RuntimeError(result.error)
        yield result.content

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        gate = self._non_windows_gate()
        if gate:
            return ProbeResult(ok=False, health="setup", code="platform_unsupported", detail=gate)

        path = find_cli(CLI_NAME)
        if not path:
            return ProbeResult(
                ok=False,
                health="setup",
                code="not_installed",
                detail="codex CLI not found on PATH. Install it, then run `codex login`.",
            )

        cwd = resolve_cwd(config.extra.get("cwd"), root=config.extra.get("cwd_root"))
        env = scrub_env()
        # `codex login status` reads the local session; it never spends
        # tokens. Unlike claude/cursor-agent, Codex has no --format json for
        # this subcommand (checked: `codex login status --help` offers none)
        # — plain-text output, parsed defensively rather than assumed.
        result = await self._runner([path, "login", "status"], cwd=cwd, env=env, timeout=15)

        if result.timed_out:
            return ProbeResult(ok=False, health="fault", code="timeout", detail="codex CLI did not respond to `codex login status`.")
        if result.returncode != 0:
            return ProbeResult(
                ok=False,
                health="fault",
                code="error",
                detail=_last_line(result.stderr) or f"codex login status exited {result.returncode}.",
            )

        # `codex login status` prints its answer to stderr, not stdout —
        # confirmed live (a bash test that merged the two streams with `2>&1`
        # masked this the first time around). Check both so a future version
        # that moves it back to stdout keeps working too.
        text = (result.stdout.strip() or result.stderr.strip())
        # "Not logged in" contains "logged in" as a substring — anchor on the
        # start of the line instead of a bare `in` check, which a real
        # negative response (caught by this module's own tests) fooled.
        if not text.lower().startswith("logged in"):
            return ProbeResult(
                ok=False,
                health="setup",
                code="not_logged_in",
                detail="codex CLI is installed but not logged in. Run `codex login`.",
            )

        facts = [("cli", f"{CLI_NAME} · on PATH", "signal")]
        return ProbeResult(
            ok=True,
            health="live",
            detail=text or "Logged in.",
            facts=facts,
        )


def _parse_jsonl(stdout: str, *, model: str) -> AdapterResult:
    """Extract the agent's final message(s) from `codex exec --json`'s
    per-line event stream. No recognised `agent_message` — silence, an
    unexpected event shape, or a run that errored without a nonzero exit —
    fails loud rather than returning empty content as if that were a real
    (if unhelpful) answer."""
    texts: list[str] = []
    tokens = 0
    saw_turn_completed = False

    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue  # a stray non-JSON line (banner/log) — ignore, don't fail the whole parse on it

        kind = event.get("type")
        if kind == "item.completed":
            item = event.get("item") or {}
            if item.get("type") == "agent_message":
                text = item.get("text")
                if isinstance(text, str) and text:
                    texts.append(text)
        elif kind == "turn.completed":
            saw_turn_completed = True
            usage = event.get("usage") or {}
            tokens = int(usage.get("input_tokens", 0)) + int(usage.get("output_tokens", 0))
        elif kind in ("turn.failed", "error"):
            detail = event.get("error") or event.get("message") or "codex CLI reported an error"
            return AdapterResult(content="", error=str(detail))

    if texts:
        return AdapterResult(content="\n".join(texts), tokens_used=tokens, model=model or "")
    if saw_turn_completed:
        # The turn finished with no error event and no agent_message — an
        # empty real answer is possible but indistinguishable here from a
        # shape this parser doesn't know yet. Fail loud either way rather
        # than silently returning "" as if that were content.
        return AdapterResult(content="", error="codex CLI completed the turn with no agent message.")
    return AdapterResult(content="", error="codex CLI returned unrecognised output (expected --json events).")


def _last_line(text: str) -> str:
    stripped = text.strip()
    return stripped.splitlines()[-1] if stripped else ""
