"""Approved local process execution. This is not an OS filesystem/network sandbox."""
import asyncio
import os
import shutil
import signal
import time
from pathlib import Path

import anyio

from adapters.cli_shared import _kill, scrub_env
from . import permission
from .secrets import redact
from .process_tree import ProcessTree

OUTPUT_LIMIT = 65536


def risk_hints(argv: list[str]) -> list[str]:
    text = ' '.join(argv).lower()
    patterns = ('-enc', '-encodedcommand', 'invoke-expression', 'iex', 'git reset --hard',
                'git push --force', 'git clean -f', 'rm -rf', 'rmdir /s', 'del /f', 'npm publish', 'format')
    hints = [pattern for pattern in patterns if pattern in text]
    if 'curl' in text and 'sh' in text:
        hints.append('curl + sh')
    return hints


def _argv(argv: list[str]) -> list[str]:
    # npm's Windows .cmd shim requires a shell. Invoke its JS entrypoint instead.
    if os.name == 'nt' and argv[0].lower() in {'npm', 'npm.cmd', 'npx', 'npx.cmd'}:
        name = argv[0].lower().removesuffix('.cmd')
        shim, node = shutil.which(name), shutil.which('node')
        script = Path(shim).parent / 'node_modules' / 'npm' / 'bin' / f'{name}-cli.js' if shim else None
        if node and script and script.is_file():
            return [node, str(script), *argv[1:]]
        raise OSError('npm entrypoint unavailable')
    # The policy decided about the git it resolved at import (permission._GIT_EXE); run that one, not a PATH lookup made now.
    pinned = permission._GIT_EXE if argv[0] == 'git' else None
    executable = pinned or shutil.which(argv[0]) or argv[0]
    if os.name == 'nt' and Path(executable).suffix.lower() in {'.cmd', '.bat'}:
        raise OSError('batch scripts require an explicit shell')
    return [executable, *argv[1:]]


async def _capture(stream) -> tuple[bytes, bool]:
    output = bytearray()
    truncated = False
    while chunk := await stream.read(8192):
        space = OUTPUT_LIMIT - len(output)
        output.extend(chunk[:space])
        truncated |= len(chunk) > space
    return bytes(output), truncated


async def _terminate(proc, tree):
    tree.terminate()
    if os.name != 'nt':
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    await _kill(proc)


async def run(argv: list[str], cwd: Path, timeout_s: float = 60, env: dict[str, str] | None = None) -> dict:
    started = time.monotonic()
    options = {'creationflags': 0x08000000} if os.name == 'nt' else {'start_new_session': True}
    tree = ProcessTree()
    proc = None
    try:
        # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-asyncio-create-exec-audit
        # nosemgrep: python.lang.security.audit.dangerous-asyncio-create-exec-audit
        proc = await asyncio.create_subprocess_exec(  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-asyncio-create-exec-audit
            *_argv(argv), cwd=str(cwd), env=scrub_env(env),
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE, **options)
        tree.attach(proc.pid)
    except BaseException:
        with anyio.CancelScope(shield=True):
            if proc is not None:
                await _kill(proc)
            tree.close()
        raise
    stdout, stderr = asyncio.create_task(_capture(proc.stdout)), asyncio.create_task(_capture(proc.stderr))
    completion = asyncio.gather(proc.wait(), stdout, stderr)
    timed_out = False
    try:
        try:
            await asyncio.wait_for(asyncio.shield(completion), timeout_s)
        except asyncio.TimeoutError:
            timed_out = True
            await _terminate(proc, tree)
        out, err = await asyncio.gather(stdout, stderr)
    finally:
        with anyio.CancelScope(shield=True):
            if not completion.done():
                await _terminate(proc, tree)
            # Never wait forever on a pipe retained by a detached descendant.
            try:
                await asyncio.wait_for(asyncio.shield(completion), 5)
            except asyncio.TimeoutError:
                completion.cancel()
                await asyncio.gather(completion, return_exceptions=True)
            tree.close()
    text = '\n'.join(data.decode('utf-8', 'replace') + ('\n…[truncated at 65536 bytes]' if truncated else '') for data, truncated in (out, err) if data or truncated)
    text, redactions = redact(text)
    return {'ok': not timed_out and proc.returncode == 0, 'result': text,
            'exit_code': None if timed_out else proc.returncode, 'timed_out': timed_out,
            'truncated': out[1] or err[1], 'redactions': redactions,
            'duration_ms': int((time.monotonic() - started) * 1000)}
