"""The local runner and the Forja secrets (ADR 0057).

Each stage run gets a git worktree of its own on its own branch (`forja/<item>-<run>`), so two runs never see each other and the main
checkout is never touched. An agent receives only the secrets its definition lists, injected as environment variables for that one command;
the exact values are removed from everything the command prints. The guard that refuses pushes to protected branches and merges is a
second layer: the real protection is the credential scope and branch protection on the server (ADR 0055).
"""
from __future__ import annotations

import asyncio
import base64
import fnmatch
import re
import urllib.parse
from contextlib import asynccontextmanager
from pathlib import Path

from factory import definition_rules as rules
from sandbox import exec as sandbox_exec

MIN_SECRET_LENGTH = 4  # a shorter value would only mangle ordinary output when redacted
_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$')
_PUSH = re.compile(r'git\s+(?:-\S+\s+)*push\b([^;&|\n"\']*)')
_MERGE = re.compile(r'\bgh\s+pr\s+merge\b|\bgh\s+api\b[^\n]*\bmerge\b', re.IGNORECASE)


class RunnerError(ValueError):
    """A run cannot be set up, with a reason that never contains a secret value."""


class SecretMissing(RunnerError):
    """The agent lists a secret reference that is not stored."""


class RunRedactor:
    """Removes the exact secret values (and their base64 and URL-encoded forms) from text. `redact_value` knows patterns, not your secrets."""

    def __init__(self, values: list[str]):
        forms: set[str] = set()
        for value in values:
            if len(value) < MIN_SECRET_LENGTH:
                continue
            raw = value.encode('utf-8')
            forms |= {value, urllib.parse.quote(value, safe=''), base64.b64encode(raw).decode(), base64.urlsafe_b64encode(raw).decode(),
                      base64.b64encode(raw).decode().rstrip('=')}
        self._forms = sorted((f for f in forms if len(f) >= MIN_SECRET_LENGTH), key=len, reverse=True)

    def redact(self, text: str) -> str:
        for form in self._forms:
            text = text.replace(form, '[redacted:secret]')
        return text


def env_name(reference: str) -> str:
    return 'FORJA_SECRET_' + re.sub(r'[^A-Z0-9]', '_', reference.split('/', 1)[-1].upper())


def secrets_for(definition: dict, agent_id: str, store) -> tuple[dict[str, str], RunRedactor]:
    """The environment and the redactor for one agent: exactly the secrets it lists, nothing else, and a refusal if one is not stored."""
    refs = definition['agents'][agent_id]['secrets']
    env: dict[str, str] = {}
    missing = []
    for ref in refs:
        value = store.get(ref)
        if value is None:
            missing.append(ref)
        else:
            env[env_name(ref)] = value
    if missing:
        raise SecretMissing('these secrets are not stored: ' + ', '.join(missing))
    return env, RunRedactor(list(env.values()))


def _protected(definition: dict) -> list[str]:
    return [b for repo in definition['repositories'] for b in repo['protectedBranches']]


async def run_as_agent(definition: dict, agent_id: str, argv: list[str], cwd, store, timeout_s: float = 60) -> dict:
    """One command with the agent secrets for this call only (never global) and the values removed from the result."""
    denied = deny_command(argv, _protected(definition))
    if denied:
        return {'ok': False, 'result': denied, 'exit_code': None, 'timed_out': False, 'truncated': False, 'redactions': 0, 'duration_ms': 0}
    env, redactor = secrets_for(definition, agent_id, store)
    result = await sandbox_exec.run(argv, Path(cwd), timeout_s, env)
    result['result'] = redactor.redact(result['result'])
    return result


def deny_command(command: str | list[str], protected: list[str]) -> str | None:
    """A push to a protected branch or a merge: the reason it is refused, or None. Text matching is a defence in depth, not the guarantee."""
    text = ' '.join(command) if isinstance(command, list) else command
    if _MERGE.search(text):
        return 'The Forja never merges: a person merges outside it.'
    for match in _PUSH.finditer(text):
        words = match.group(1).split()
        if any(w in ('--all', '--mirror') for w in words):
            return 'This push could reach a protected branch.'
        targets = [w for w in words if not w.startswith('-')][1:]  # the first word is the remote
        for target in targets:
            branch = target.lstrip('+').rsplit(':', 1)[-1].removeprefix('refs/heads/')
            if any(fnmatch.fnmatchcase(branch, pattern) for pattern in protected):
                return f'Pushing to the protected branch {branch} is not allowed.'
    return None


class RunnerPool:
    """At most `limit` runs at once; the rest wait their turn (their work items stay `queued`)."""

    def __init__(self, limit: int):
        self._semaphore = asyncio.Semaphore(limit)
        self.running = 0
        self.waiting = 0

    @asynccontextmanager
    async def slot(self):
        self.waiting += 1
        try:
            await self._semaphore.acquire()
        finally:
            self.waiting -= 1
        self.running += 1
        try:
            yield
        finally:
            self.running -= 1
            self._semaphore.release()


def runner_config(definition: dict, runner_id: str | None = None) -> dict:
    """The settings of a runner; the defaults when the definition names none (`local`, two at a time, no push credential of the user)."""
    declared = definition.get('runners', {})
    chosen = declared.get(runner_id) if runner_id else (next(iter(declared.values()), None))
    return {**rules.RUNNER_DEFAULTS, **(chosen or {})}


def create_run_workspace(repo, item_id: str, run_id: str, base: str = 'HEAD') -> dict:
    """A managed worktree of the repository on a new branch `forja/<item>-<run>` (ADR 0055: the branch is what a person reviews)."""
    from workspaces.errors import WorkspaceError
    from workspaces.service import WorkspaceService

    for part in (item_id, run_id):
        if not _NAME.fullmatch(part) or '..' in part:
            raise RunnerError('the item and run ids must be plain names')
    try:
        return WorkspaceService().create(str(repo), base, f'forja/{item_id}-{run_id}')
    except WorkspaceError as exc:
        raise RunnerError(f'could not make the worktree: {exc}') from None


def remove_run_workspace(repo, workspace_id: str) -> None:
    """Removes the worktree with the rescue of unsaved work that the workspace manager always does (ADR 0008)."""
    from workspaces.errors import WorkspaceError
    from workspaces.service import WorkspaceService

    service = WorkspaceService()
    try:
        service.remove(str(repo), workspace_id, service.removal_check(str(repo), workspace_id)['confirmation_token'])
    except WorkspaceError as exc:
        raise RunnerError(f'could not remove the worktree: {exc}') from None
