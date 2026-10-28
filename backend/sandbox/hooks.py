"""Pre-tool hooks (#165): fail-closed gates that run before a tool does.

A hook is a program the person registered in the sidecar (never read from a
workspace, so a repository cannot plant one). It is run through `sandbox.exec.run`
with argv only (no shell), an environment rebuilt from the allowlist (`scrub_env`), the workspace
as cwd, a short timeout, and a redacted JSON payload on stdin. Exit 0 allows.
A non-zero exit, a timeout, a spawn failure or a corrupt registration blocks.
`HOOK_RULES` is the one table for the validator and the UI.
"""
import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path, PurePosixPath, PureWindowsPath

from .exec import run
from .secrets import redact

HOOK_RULES = {
    'id_pattern': r'^[a-z0-9][a-z0-9_-]{0,63}$',
    'timeout_s': {'min': 1, 'max': 10, 'default': 5},
    'tools': ['exec', 'read', 'discover'],
    'argv_max_items': 16,
    'argv_item_max_chars': 1024,
    'denied_programs': ['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'env',
                        'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'],
}


@dataclass(frozen=True)
class Hook:
    id: str
    argv: list
    timeout_s: float
    tools: tuple
    invalid: bool = False


@dataclass(frozen=True)
class HookDecision:
    hook_id: str
    allowed: bool
    reason: str  # ok | exit_nonzero | timeout | spawn_error | invalid_config
    duration_ms: int = 0


def _is_abs(path: str) -> bool:
    return os.path.isabs(path) or PureWindowsPath(path).is_absolute()


def validate_hook(hook_id, body) -> Hook:
    """Raise ValueError('invalid_hook') unless every rule in HOOK_RULES holds."""
    rules = HOOK_RULES
    try:
        if not isinstance(hook_id, str) or not re.fullmatch(rules['id_pattern'], hook_id):
            raise ValueError
        argv, tools = body.get('argv'), body.get('tools')
        timeout = body.get('timeout_s', rules['timeout_s']['default'])
        if (not isinstance(argv, list) or not 1 <= len(argv) <= rules['argv_max_items']
                or not all(isinstance(a, str) and 0 < len(a) <= rules['argv_item_max_chars'] and '\0' not in a for a in argv)):
            raise ValueError
        # Absolute path only: no PATH lookup an attacker-writable directory could win.
        # Refusing shells by name is a best-effort guard; the guarantee is argv-only exec.
        program = argv[0]
        name = (PureWindowsPath(program).name if '\\' in program else PurePosixPath(program).name).lower()
        if not _is_abs(program) or name in rules['denied_programs']:
            raise ValueError
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) \
                or not rules['timeout_s']['min'] <= timeout <= rules['timeout_s']['max']:
            raise ValueError
        if not isinstance(tools, list) or not tools or not all(t in rules['tools'] for t in tools):
            raise ValueError
    except (ValueError, AttributeError):
        raise ValueError('invalid_hook') from None
    return Hook(id=hook_id, argv=list(argv), timeout_s=timeout, tools=tuple(dict.fromkeys(tools)))


def _redact_value(value):
    if isinstance(value, str):
        return redact(value)[0]
    if isinstance(value, dict):
        return {k: _redact_value(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_value(v) for v in value]
    return value


async def run_hook(hook: Hook, payload: dict, cwd) -> HookDecision:
    started = time.monotonic()

    def done(allowed, reason):
        return HookDecision(hook.id, allowed, reason, int((time.monotonic() - started) * 1000))

    if hook.invalid:
        return done(False, 'invalid_config')
    body = json.dumps({'hook_id': hook.id, **_redact_value(payload)}).encode()
    try:
        # The one reviewed spawn site (sandbox.exec.run): argv only, allowlisted environment, bounded, tree-killed.
        result = await run(hook.argv, Path(cwd), hook.timeout_s, stdin_data=body, reap_descendants=True)
    except (OSError, ValueError):
        return done(False, 'spawn_error')
    if result['timed_out']:
        return done(False, 'timeout')
    return done(True, 'ok') if result['exit_code'] == 0 else done(False, 'exit_nonzero')
