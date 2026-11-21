"""Starts and watches the Cordis host (ADR 0071).

The sidecar is the host's parent and holds its stdin: when any link of the chain app -> sidecar -> host -> plugin
processes dies, the pipe below it closes and the process under it exits. The host's address and token live only in the
memory of this object; nothing here logs them and no route returns them.
"""
from __future__ import annotations

import collections
import http.client
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

MIN_NODE = (22, 20, 0)
STARTING, RUNNING, UNAVAILABLE, FAILED, STOPPED = 'starting', 'running', 'unavailable', 'failed', 'stopped'
BANNER_TIMEOUT_S = 20.0
STOP_GRACE_S = 6.0
LOG_LINES = 500
_PLUGIN_LINE = re.compile(r'^\[plugin (.+?)\] (.*)$')
_HOST_ENV_KEEP = ('SystemRoot', 'windir', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA')


class CordisUnavailable(RuntimeError):
    """The host is not running (yet, or at all). `state` and `reason` say why."""

    def __init__(self, state: str, reason: str | None):
        super().__init__(reason or state)
        self.state, self.reason = state, reason


class HostRequestError(RuntimeError):
    def __init__(self, status: int, body: Any):
        super().__init__(f'host answered {status}')
        self.status, self.body = status, body


def parse_node_version(text: str) -> tuple[int, int, int] | None:
    match = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)', text.strip())
    return (int(match[1]), int(match[2]), int(match[3])) if match else None


def default_host_dir() -> Path:
    return Path(__file__).resolve().parents[2] / 'cordis-host'


def banner_problem(banner: Mapping[str, Any]) -> str | None:
    """Why the host that printed this banner cannot be used, or None. The host reports its own Node version, so Node is never probed apart."""
    version = parse_node_version(str(banner.get('node', '')))
    if version is None or version < MIN_NODE:
        return f'Node.js {".".join(map(str, MIN_NODE))} or newer is required.'
    return None


def start_arguments(host_dir: Path) -> list[str]:
    """Node arguments of the host's own `start` script, so there is one place that says how the host runs."""
    manifest = json.loads((host_dir / 'package.json').read_text(encoding='utf8'))
    parts = str(manifest['scripts']['start']).split(' ')
    if parts[0] != 'node':
        raise ValueError('the host start script must run node')
    return parts[1:]


def host_environment(source: Mapping[str, str], plugins_dir: Path) -> dict[str, str]:
    env = {key: source[key] for key in _HOST_ENV_KEEP if key in source}
    env['OH_CORDIS_PLUGINS_DIR'] = str(plugins_dir)
    return env


def pid_alive(pid: int) -> bool:
    if sys.platform == 'win32':
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        code = ctypes.c_ulong()
        ok = ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(handle)
        return bool(ok) and code.value == 259  # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


class CordisSupervisor:
    def __init__(
        self,
        plugins_dir: Path,
        *,
        env: Mapping[str, str] | None = None,
        backoff: tuple[float, ...] = (1.0, 3.0, 8.0),
        max_restarts: int = 3,
        window_s: float = 60.0,
        on_running: Callable[['CordisSupervisor'], None] | None = None,
    ):
        self._source_env = os.environ if env is None else env
        self.plugins_dir = plugins_dir
        self._backoff, self._max_restarts, self._window_s = backoff, max_restarts, window_s
        self._on_running = on_running
        self._lock = threading.RLock()
        self._state, self._reason = STOPPED, None
        self._proc: subprocess.Popen[bytes] | None = None
        self._port: int | None = None
        self._token: str | None = None
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None
        self._restarts: collections.deque[float] = collections.deque()
        self._host_log: collections.deque[str] = collections.deque(maxlen=LOG_LINES)
        self._plugin_logs: dict[str, collections.deque[str]] = {}
        self.node_version: str | None = None
        self._fatal = False
        self.host_pid: int | None = None

    # -- state ---------------------------------------------------------
    @property
    def state(self) -> str:
        return self._state

    @property
    def reason(self) -> str | None:
        return self._reason

    def _set(self, state: str, reason: str | None = None) -> None:
        with self._lock:
            self._state, self._reason = state, reason

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                'state': self._state, 'reason': self._reason, 'restarts': len(self._restarts),
                'node': self.node_version, 'hostLog': list(self._host_log)[-50:],
            }

    # -- locate --------------------------------------------------------
    def _locate(self) -> tuple[str, Path] | None:
        env = self._source_env
        node = env.get('OH_CORDIS_NODE') or shutil.which('node')
        if not node:
            self._set(UNAVAILABLE, 'Node.js was not found; plugins are off.')
            return None
        host_dir = Path(env.get('OH_CORDIS_HOST_DIR') or default_host_dir())
        if not (host_dir / 'src' / 'main.ts').is_file() or not (host_dir / 'package.json').is_file():
            self._set(UNAVAILABLE, 'The plugin host files were not found.')
            return None
        if not (host_dir / 'node_modules' / 'cordis').is_dir():
            self._set(UNAVAILABLE, 'The plugin host dependencies are not installed.')
            return None
        return node, host_dir

    # -- lifecycle -----------------------------------------------------
    def start(self) -> None:
        """Returns at once. The host comes up on a thread; `state` says where it is. Never raises."""
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._stopping.clear()
            self._set(STARTING)
            self._thread = threading.Thread(target=self._run, name='cordis-supervisor', daemon=True)
            self._thread.start()

    def _run(self) -> None:
        try:
            located = self._locate()
            if located is None:
                return
            node, host_dir = located
            attempt = 0
            while not self._stopping.is_set():
                self._set(STARTING)
                came_up = self._launch(node, host_dir)
                if self._stopping.is_set() or self._fatal:
                    return
                reason = 'The plugin host stopped and was restarted.' if came_up else (self._reason or 'The plugin host did not start.')
                now = time.monotonic()
                self._restarts.append(now)
                while self._restarts and now - self._restarts[0] > self._window_s:
                    self._restarts.popleft()
                if len(self._restarts) > self._max_restarts:
                    self._set(FAILED, 'The plugin host keeps stopping; it was not restarted again.')
                    return
                self._set(STARTING, reason)
                delay = self._backoff[min(attempt, len(self._backoff) - 1)] if self._backoff else 0
                attempt += 1
                if self._stopping.wait(delay):
                    return
        except Exception:  # the supervisor must never take the sidecar down
            _log.exception('the plugin host supervisor stopped unexpectedly')
            self._set(FAILED, 'The plugin host supervisor stopped unexpectedly.')

    def _launch(self, node: str, host_dir: Path) -> bool:
        """Run the host once. True when it came up and later exited; False when it never gave its banner."""
        try:
            self.plugins_dir.mkdir(parents=True, exist_ok=True)
            args = [node, *start_arguments(host_dir)]
            kwargs: dict[str, Any] = {}
            if sys.platform == 'win32':
                kwargs['creationflags'] = 0x08000000  # CREATE_NO_WINDOW
            else:
                kwargs['start_new_session'] = True
            proc = subprocess.Popen(  # list, no shell; the environment is a short allowlist plus the plugin folder
                args, cwd=host_dir, env=host_environment(self._source_env, self.plugins_dir),
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs,
            )
        except (OSError, ValueError, KeyError, json.JSONDecodeError):
            self._fatal = True  # Node itself cannot be run: trying again would fail the same way
            self._set(UNAVAILABLE, 'The plugin host could not be started.')
            return False
        with self._lock:
            self._proc, self.host_pid = proc, proc.pid
        banner: dict[str, Any] = {}
        ready = threading.Event()
        threading.Thread(target=self._pump_stdout, args=(proc, banner, ready), daemon=True).start()
        threading.Thread(target=self._pump_stderr, args=(proc,), daemon=True).start()
        deadline = time.monotonic() + BANNER_TIMEOUT_S
        while not ready.wait(0.1):
            if proc.poll() is not None or time.monotonic() > deadline or self._stopping.is_set():
                break
        if not banner or proc.poll() is not None:
            self._terminate(proc)
            self._set(UNAVAILABLE, 'The plugin host exited before it was ready.')
            return False
        problem = banner_problem(banner)
        if problem is not None:
            self._terminate(proc)
            self._fatal = True
            self._set(UNAVAILABLE, problem)
            return False
        self.node_version = '.'.join(map(str, parse_node_version(str(banner['node'])) or ()))
        with self._lock:
            self._port, self._token = int(banner['port']), str(banner['token'])
        self._set(RUNNING)
        if self._on_running is not None:
            try:
                self._on_running(self)
            except Exception:
                _log.exception('restoring plugins after the host started failed')
        while proc.poll() is None and not self._stopping.is_set():
            time.sleep(0.2)
        with self._lock:
            self._port = self._token = None
            self.host_pid = None
        if not self._stopping.is_set():
            self._terminate(proc)
        return True

    def _pump_stdout(self, proc: subprocess.Popen[bytes], banner: dict[str, Any], ready: threading.Event) -> None:
        assert proc.stdout is not None
        first = True
        for raw in proc.stdout:
            if first:
                first = False
                try:
                    parsed = json.loads(raw.decode('utf8'))
                    if isinstance(parsed, dict) and isinstance(parsed.get('port'), int) and isinstance(parsed.get('token'), str):
                        banner.update(parsed)
                except ValueError:
                    # The first line must be the JSON banner; without it the start fails as "no banner".
                    _log.debug('the first plugin host stdout line was not the JSON banner')
                ready.set()
        ready.set()  # stdout closed without a banner

    def _pump_stderr(self, proc: subprocess.Popen[bytes]) -> None:
        assert proc.stderr is not None
        for raw in proc.stderr:
            self._ingest(raw.decode('utf8', 'replace').rstrip('\r\n'))

    def _ingest(self, line: str) -> None:
        token = self._token
        if token:
            line = line.replace(token, '[redacted]')
        match = _PLUGIN_LINE.match(line)
        with self._lock:
            if match:
                self._plugin_logs.setdefault(match[1], collections.deque(maxlen=LOG_LINES)).append(match[2])
            else:
                self._host_log.append(line)

    def plugin_log(self, name: str, tail: int = 200) -> list[str]:
        with self._lock:
            return list(self._plugin_logs.get(name, ()))[-max(1, tail):]

    def _terminate(self, proc: subprocess.Popen[bytes]) -> None:
        try:
            if proc.stdin is not None:
                proc.stdin.close()
        except OSError:
            # The pipe is already broken: the host is gone or going, which is what closing it asks for.
            _log.debug('the plugin host stdin was already closed')
        try:
            proc.wait(timeout=STOP_GRACE_S)
            return
        except subprocess.TimeoutExpired:
            pass
        if sys.platform == 'win32':  # the host's plugin processes are its children: end the whole tree
            subprocess.run(['taskkill', '/T', '/F', '/PID', str(proc.pid)], capture_output=True, check=False, stdin=subprocess.DEVNULL)
        else:
            import signal
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError):
                # The group already exited (nothing left to kill) or is not ours to signal.
                _log.debug('the plugin host process group was already gone')
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    def stop(self) -> None:
        """Close the host's stdin and wait for it (and through it, for the plugin processes) to leave; kill after the grace period."""
        self._stopping.set()
        with self._lock:
            proc = self._proc
        if proc is not None and proc.poll() is None:
            self._terminate(proc)
        thread = self._thread
        if thread is not None and thread is not threading.current_thread():
            thread.join(timeout=STOP_GRACE_S + 10)
        with self._lock:
            self._port = self._token = None
        self._set(STOPPED)

    # -- host requests -------------------------------------------------
    def request(self, method: str, path: str, body: Any = None, timeout: float = 60.0) -> Any:
        with self._lock:
            state, port, token = self._state, self._port, self._token
        if state != RUNNING or port is None or token is None:
            raise CordisUnavailable(state, self._reason)
        payload = None if body is None else json.dumps(body).encode('utf8')
        headers = {'Authorization': f'Bearer {token}'}
        if payload is not None:
            headers['Content-Type'] = 'application/json'
        conn = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
        try:
            conn.request(method, path, body=payload, headers=headers)
            response = conn.getresponse()
            raw = response.read()
        except OSError as error:
            raise CordisUnavailable(STARTING, 'The plugin host did not answer.') from error
        finally:
            conn.close()
        parsed = json.loads(raw) if raw else None
        if response.status >= 400:
            raise HostRequestError(response.status, parsed)
        return parsed
