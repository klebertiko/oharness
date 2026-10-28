"""The one place the Workspace Manager starts git.

Why a dedicated runner instead of ``sandbox.exec.run``: that helper is built for approved *tool* execution. It merges
stdout and stderr into one redacted, truncated (64 KiB) string. The Workspace Manager parses NUL-separated porcelain output
and hashes it to bind a removal confirmation to the repository state, so truncation, redaction or interleaved stderr would
silently corrupt the very data a destructive decision rests on. This runner returns exact stdout bytes and keeps stderr apart.

What it guarantees, for every call:

* argv is a list, git is an absolute path resolved once, there is no shell, stdin is closed;
* the environment is rebuilt from the sidecar allowlist (``adapters.cli_shared.scrub_env``): every inherited ``GIT_*`` and every
  unrelated secret is dropped; system and global git configuration are switched off; prompts are disabled;
* repository-controlled code cannot start: hooks are redirected to an empty directory, the filesystem monitor is off, and every
  ``filter.<name>.{clean,smudge,process}`` the repository defines is blanked (``filters=True``). If a filter driver name cannot
  be neutralised exactly, the call is refused rather than run (fail closed);
* a timeout bounds every call and ends the whole process tree (a Windows job object from ``sandbox/process_tree.py``; a process group elsewhere).

What it cannot neutralise is listed in docs/adr/0008-workspace-manager.md (a repository's own ``.git`` contents are still read by git).
"""
from __future__ import annotations

import logging
import os
import shutil
import signal
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from adapters.cli_shared import scrub_env
from sandbox.process_tree import ProcessTree

from .errors import WorkspaceError

log = logging.getLogger(__name__)
CREATE_NO_WINDOW = 0x08000000
DEFAULT_TIMEOUT_S = 30.0
MAX_STDOUT = 64 * 1024 * 1024
_FILTER_VARS = ("clean", "smudge", "process")


class GitFailure(Exception):
    """git ran and exited non-zero."""

    def __init__(self, args: list[str], returncode: int, stderr: str):
        super().__init__(f"git {' '.join(args[:3])} exited {returncode}: {stderr.strip()[:300]}")
        self.args_run = args
        self.returncode = returncode
        self.stderr = stderr


@dataclass(frozen=True)
class GitResult:
    returncode: int
    stdout: bytes
    stderr: str

    def text(self) -> str:
        return self.stdout.decode("utf-8", "replace")


def resolve_git() -> str:
    found = shutil.which("git")
    if not found:
        raise WorkspaceError("git_unavailable", "git was not found on PATH", 503)
    return os.path.abspath(found)


class GitRunner:
    def __init__(self, hooks_dir: Path, git: str | None = None):
        self.git_path = git or resolve_git()
        self.hooks_dir = Path(hooks_dir)

    def _environment(self, extra: dict[str, str] | None) -> dict[str, str]:
        env = {key: value for key, value in scrub_env().items() if not key.upper().startswith("GIT_")}
        env.update({
            "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull, "GIT_TERMINAL_PROMPT": "0",
            "GIT_OPTIONAL_LOCKS": "0", "GIT_NO_LAZY_FETCH": "1", "GIT_PAGER": "cat",
        })
        env.update(extra or {})
        return env

    def _base_config(self) -> list[str]:
        pairs = [
            f"core.hooksPath={self.hooks_dir}", "core.fsmonitor=false", "core.pager=cat", "diff.external=",
            f"core.attributesFile={os.devnull}", "protocol.allow=never", "gc.auto=0", "maintenance.auto=false",
            "log.showSignature=false", "commit.gpgsign=false", "core.longpaths=true",
        ]
        return [part for pair in pairs for part in ("-c", pair)]

    def _filter_neutralisers(self, cwd: Path) -> set[str]:
        """The names of every filter driver the configuration visible from ``cwd`` defines.

        The keys are read as BYTES: a name that is not strict UTF-8 cannot be written back into an argv unchanged (decoding it
        with a replacement character would blank a driver git does not have and leave the real one armed), so it is refused.
        """
        listing = self._execute(["config", "--list", "--null"], cwd, DEFAULT_TIMEOUT_S, None, None)
        if listing.returncode != 0:
            raise WorkspaceError("unsafe_repository", "git could not read this repository's configuration", 409)
        drivers: set[str] = set()
        for entry in listing.stdout.split(b"\0"):
            key = entry.split(b"\n", 1)[0]
            if not key.startswith(b"filter."):
                continue
            name_bytes, _, var = key[len(b"filter."):].rpartition(b".")
            if var.decode("ascii", "replace") not in (*_FILTER_VARS, "required"):
                continue
            try:
                name = name_bytes.decode("utf-8", "strict")
            except UnicodeDecodeError as exc:
                raise WorkspaceError("unsafe_repository", "the repository defines a filter driver whose name is not valid UTF-8 and cannot be neutralised", 409) from exc
            if "=" in name or any(ord(ch) < 0x20 for ch in name):
                raise WorkspaceError("unsafe_repository", "the repository defines a filter driver whose name cannot be neutralised", 409)
            drivers.add(name)
        return drivers

    def _drivers(self, cwd: Path, filter_dirs: Sequence[Path | str]) -> set[str]:
        drivers = self._filter_neutralisers(cwd)
        for other in filter_dirs:
            if os.path.isdir(other):
                drivers |= self._filter_neutralisers(Path(other))
        return drivers

    @staticmethod
    def _overrides(drivers: set[str]) -> list[str]:
        args: list[str] = []
        for name in sorted(drivers):
            for var in _FILTER_VARS:
                args += ["-c", f"filter.{name}.{var}="]
            args += ["-c", f"filter.{name}.required=false"]
        return args

    def _execute(self, args: list[str], cwd: Path, timeout: float, input: bytes | None, env: dict[str, str] | None) -> GitResult:
        argv = [self.git_path, *self._base_config(), "--no-pager", *args]
        options: dict[str, Any] = {"creationflags": CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
        tree = ProcessTree()  # Windows job object: ends git AND whatever it started; elsewhere a process group does the same
        proc: subprocess.Popen | None = None
        try:
            # The single process-spawning call site of the Workspace Manager. argv is a list (no shell), git is an absolute path,
            # the environment is rebuilt from an allowlist, stdin is closed and the call is time-bounded (killed with its process tree).
            # OpenGrep flags any non-literal subprocess argv (dangerous-subprocess-use-audit); this one suppression is the reviewed one
            # (two SEC reviews, ADR 0008); it is the only suppression in workspaces/.
            # nosemgrep: python.lang.security.audit.dangerous-subprocess-use-audit
            proc = subprocess.Popen(argv, cwd=str(cwd), env=self._environment(env),  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit
                                    stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options)
            try:
                tree.attach(proc.pid)
            except OSError as exc:  # the timeout then falls back to the direct child and the process group
                log.warning("git could not be placed in a job object: %s", exc)
            try:
                stdout, stderr = proc.communicate(input, timeout=timeout)
            except subprocess.TimeoutExpired as exc:
                self._kill_tree(proc, tree)
                raise WorkspaceError("git_timeout", f"git {args[0]} did not finish within {timeout:g}s", 504) from exc
        except (OSError, ValueError) as exc:
            raise WorkspaceError("git_unavailable", f"git could not be started: {exc}", 503) from exc
        finally:
            if proc is not None and proc.poll() is None:
                self._kill_tree(proc, tree)
            tree.close()
        if len(stdout) > MAX_STDOUT:
            raise WorkspaceError("git_output_too_large", f"git {args[0]} produced more than {MAX_STDOUT} bytes", 507)
        return GitResult(proc.returncode, stdout, stderr.decode("utf-8", "replace"))

    @staticmethod
    def _kill_tree(proc: "subprocess.Popen", tree: ProcessTree) -> None:
        """End git and everything it started, then reap it. Never waits on a pipe a stray descendant might still hold."""
        tree.terminate()  # Windows: every process in the job (sandbox/process_tree.py)
        if os.name != "nt":
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except (ProcessLookupError, PermissionError) as exc:  # the group is already gone, or not ours to signal
                log.debug("process group %s not signalled: %s", proc.pid, exc)
        try:
            proc.kill()
        except OSError as exc:  # already exited
            log.debug("git process %s not killed: %s", proc.pid, exc)
        try:
            proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            for stream in (proc.stdin, proc.stdout, proc.stderr):
                if stream:
                    stream.close()
            proc.wait(timeout=5)

    def run(self, cwd: Path | str, args: list[str], *, timeout: float = DEFAULT_TIMEOUT_S, input: bytes | None = None,
            env: dict[str, str] | None = None, check: bool = True, filters: bool = False,
            filter_dirs: Sequence[Path | str] = ()) -> GitResult:
        """Run ``git <args>`` in ``cwd``.

        ``filters=True`` is required for any command that reads or writes working-tree content (checkout, status, add): it blanks
        the repository's clean/smudge/process filters first. Pure plumbing on refs and objects does not need it.

        A command run from one worktree that makes git read ANOTHER worktree (a ``worktree remove`` without ``--force`` starts a
        ``git status`` there) passes that worktree's directory in ``filter_dirs``: the drivers blanked are the union of every
        configuration git will read, ``config.worktree`` included.
        """
        cwd = Path(cwd)
        pre: list[str] = []
        drivers: set[str] = set()
        if filters:
            drivers = self._drivers(cwd, filter_dirs)
            pre = self._overrides(drivers)
        if pre:
            args = [*pre, *args]
        done = self._execute(list(args), cwd, timeout, input, env)
        if filters and not self._drivers(cwd, filter_dirs) <= drivers:  # read again: a driver git was not told to blank appeared while it ran (one that went away, with a removed worktree, is harmless)
            raise WorkspaceError("config_changed", "the repository's configuration changed while git was running; the result was discarded", 409)
        if check and done.returncode != 0:
            raise GitFailure(list(args), done.returncode, done.stderr)
        return done
