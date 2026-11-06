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
from sandbox.secrets import redact as redact_patterns
from sandbox import exec as sandbox_exec

MIN_SECRET_LENGTH = 4  # a shorter value would only mangle ordinary output when redacted
_NAME = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$')


_CUT_MARKER = re.compile('(' + chr(10) + '…' + re.escape('[truncated at ') + '[0-9]{1,9}' + re.escape(' bytes]') + '|' + chr(10) + re.escape('[truncated]') + ')')


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

    def redact(self, text: str, truncated: bool = False) -> str:
        """`truncated`: the output was cut, so a secret may be half written just before a cut marker or at the very end; any prefix of one
        sitting there is dropped too."""
        for form in self._forms:
            text = text.replace(form, '[redacted:secret]')
        if truncated:
            parts = _CUT_MARKER.split(text)  # text, marker, text, marker... with the markers kept
            for position in range(0, len(parts), 2):
                parts[position] = self._drop_partial(parts[position])
            text = ''.join(parts)
        return text

    def _drop_partial(self, text: str) -> str:
        for form in self._forms:
            for size in range(len(form) - 1, MIN_SECRET_LENGTH - 1, -1):
                if text.endswith(form[:size]):
                    return text[:-size]
        return text


def env_name(reference: str) -> str:
    return 'FORJA_SECRET_' + re.sub(r'[^A-Z0-9]', '_', reference.split('/', 1)[-1].upper())


def secrets_for(definition: dict, agent_id: str, store) -> tuple[dict[str, str], RunRedactor]:
    """The environment and the redactor for one agent: exactly the secrets it lists, nothing else, and a refusal if one is not stored."""
    refs = definition['agents'][agent_id]['secrets']
    if any(not re.fullmatch(rules.SECRET_REF_PATTERN, ref) for ref in refs):  # the vault also holds provider keys: only forja/<name> is ever read here
        raise RunnerError('a secret reference must look like forja/<name>')
    env: dict[str, str] = {}
    missing = []
    for ref in refs:
        value = store.get(ref)
        if value is None:
            missing.append(ref)
        elif env_name(ref) in env:
            raise RunnerError('two of these secrets map to the same variable: rename one of them')
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
    if not _in_run_workspace(cwd):
        raise RunnerError('commands run only inside a run workspace made by the runner')
    result = await sandbox_exec.run(argv, Path(cwd), timeout_s, env, redact_output=False)
    exact = redactor.redact(result['result'], truncated=bool(result.get('truncated')))  # exact values first, so a secret that contains a known pattern goes whole
    result['result'], result['redactions'] = redact_patterns(exact)
    return result


_GIT_PUSH_VALUE_OPTIONS = {'-o', '--push-option', '--repo', '--receive-pack', '--exec'}
_GH_VALUE_OPTIONS = {'-R', '--repo', '--hostname'}
_SEPARATORS = {';', '&&', '||', '|', '&'}
_SHELL_PUNCTUATION = re.compile('[;&|()`<>' + chr(10) + chr(13) + ']')
_EXECUTABLE_SUFFIX = re.compile(r'\.(exe|cmd|bat|com)$')


def _tokens(command: str | list[str], depth: int = 0) -> list[str]:
    """Words of a command, with quoting undone, shell punctuation turned into separators and nested shell strings (`sh -c "..."`) opened."""
    import shlex

    if isinstance(command, list):
        words = [str(w) for w in command]
    else:
        command = command.replace(chr(92) + chr(13) + chr(10), '').replace(chr(92) + chr(10), '')  # a backslash before a newline joins the lines, as in a shell
        spaced = _SHELL_PUNCTUATION.sub(lambda m: f' {m.group()} ' if m.group() in '&|' else ' ; ', command.replace('$(', ' ; '))
        try:
            words = shlex.split(spaced)
        except ValueError:
            words = spaced.split()
    out: list[str] = []
    for word in words:
        if depth < 3 and (word.strip() != word or ' ' in word or _SHELL_PUNCTUATION.search(word) or '$(' in word):
            out += _tokens(word, depth + 1)
        else:
            out.append(word)
    return out


def _name(word: str) -> str:
    return _EXECUTABLE_SUFFIX.sub('', word.replace(chr(92), '/').rsplit('/', 1)[-1].lower())


def _segment(words: list[str], start: int) -> list[str]:
    out = []
    for word in words[start:]:
        if word in _SEPARATORS:
            break
        out.append(word)
    return out


def _in_run_workspace(cwd) -> bool:
    """True when `cwd` is inside the root of the worktrees the workspace manager made, never the main checkout or anywhere else."""
    from workspaces.config import Settings

    try:
        return Path(cwd).resolve().is_relative_to(Settings.from_env().managed_root.resolve())
    except OSError:
        return False


def deny_command(command: str | list[str], protected: list[str]) -> str | None:
    """A push to a protected branch or a merge: the reason it is refused, or None. Matching the words of a command is a defence in depth
    (aliases, scripts and indirection get past it); the guarantee is the credential scope and the branch protection on the server."""
    words = _tokens(command)
    for index, word in enumerate(words):
        name = _name(word)
        if name == 'gh':
            rest = [w.lower() for w in _segment(words, index + 1)]
            skip = 0
            while skip < len(rest) and rest[skip].startswith('-'):
                skip += 2 if rest[skip] in {o.lower() for o in _GH_VALUE_OPTIONS} else 1
            head, span = rest[skip:skip + 1], rest[skip:]
            api_file = any(w.startswith('@') or w == '--input' or w.startswith('--input=') or '=@' in w for w in span) or 'graphql' in span
            if head == ['alias'] or (head == ['pr'] and 'merge' in span) or (head == ['api'] and (api_file or any('merge' in w for w in span))):
                return 'The Forja never merges: a person merges outside it.'
        if name == 'git':
            segment = _segment(words, index + 1)
            if 'push' not in segment:  # any `push` after git in the same command counts, whatever options come first
                continue
            args = segment[segment.index('push') + 1:]
            if any(w in ('--all', '--mirror') for w in args):
                return 'This push could reach a protected branch.'
            positional, i = [], 0
            while i < len(args):
                if args[i].startswith('-'):
                    i += 2 if args[i] in _GIT_PUSH_VALUE_OPTIONS else 1
                else:
                    positional.append(args[i])
                    i += 1
            for target in positional[1:]:  # the first positional is the remote
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
