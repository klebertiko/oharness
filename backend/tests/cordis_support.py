"""Shared helpers for the test_cordis_* files: finding a usable Node, a fake npm/GitHub, a plugin package, process checks."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import shutil
import subprocess
import sys
import tarfile
import time
from pathlib import Path

from cordis.sources import SourceError
from cordis.supervisor import MIN_NODE, parse_node_version

HOST_DIR = Path(__file__).resolve().parents[2] / 'cordis-host'


def node_problem() -> str | None:
    """Why the real host cannot run here, or None. The tests skip with this text; CI has Node 22.20 and the host's dependencies."""
    node = shutil.which('node')
    if node is None:
        return 'Node.js is not on PATH'
    out = subprocess.run(['node', '--version'], capture_output=True, check=False, stdin=subprocess.DEVNULL).stdout.decode()
    version = parse_node_version(out)
    if version is None or version < MIN_NODE:
        return f'Node.js {".".join(map(str, MIN_NODE))} or newer is required'
    if not (HOST_DIR / 'node_modules' / 'cordis').is_dir():
        return 'cordis-host dependencies are not installed (npm ci --ignore-scripts in cordis-host)'
    return None


def plugin_files(version: str = '1.0.0', *, name: str = 'backend-probe', tool: str = 'probe_info', say: str = 'hello from the probe') -> dict[str, bytes]:
    manifest = {'name': name, 'version': version, 'type': 'module', 'main': './index.ts', 'oharness': {'runtime': 'isolated', 'capabilities': []}}
    code = (
        f"export const name = '{name}'\n"
        "export const inject = ['tools']\n"
        'export function apply(ctx) {\n'
        f"  console.log('{say}')\n"
        f"  ctx.tools.register({{ name: '{tool}', description: 'Version and pid.', async execute() {{ return {{ version: '{version}', pid: process.pid }} }} }})\n"
        '}\n'
    )
    return {'package.json': json.dumps(manifest).encode(), 'index.ts': code.encode()}


def tar_gz(files: dict[str, bytes], prefix: str = 'package') -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(f'{prefix}/{name}')
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


class FakeNet:
    """npm and GitHub in memory. `add_npm(name, version, files)` and `add_github(repo, commit, files)` register what they serve."""

    def __init__(self) -> None:
        self.routes: dict[str, bytes] = {}
        self.calls: list[str] = []

    def add_npm(self, name: str, version: str, files: dict[str, bytes]) -> None:
        data = tar_gz(files)
        url = f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'
        integrity = 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()
        self.routes[f'https://registry.npmjs.org/{name}/{version}'] = json.dumps({'dist': {'tarball': url, 'integrity': integrity}}).encode()
        self.routes[url] = data

    def add_github(self, repo: str, commit: str, files: dict[str, bytes]) -> None:
        self.routes[f'https://codeload.github.com/{repo}/tar.gz/{commit}'] = tar_gz(files, prefix=f'{repo.split("/")[1]}-{commit}')

    def __call__(self, url: str, limit: int) -> bytes:
        self.calls.append(url)
        if url not in self.routes:
            raise SourceError('download_failed', 'not found')
        return self.routes[url]


def alive(pid: int) -> bool:
    from cordis.supervisor import pid_alive
    return pid_alive(pid)


def wait_until(condition, timeout: float = 30.0, step: float = 0.1) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(step)
    return condition()


def kill_hard(pid: int) -> None:
    if sys.platform == 'win32':
        subprocess.run(['taskkill', '/F', '/PID', str(pid)], capture_output=True, check=False, stdin=subprocess.DEVNULL)
    else:
        import os
        import signal
        os.kill(pid, signal.SIGKILL)
