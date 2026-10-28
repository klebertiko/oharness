"""A git timeout ends the whole process tree: a grandchild holding the pipe must not stretch the call past its limit."""
from __future__ import annotations

import os
import sys
import time

import pytest

from workspaces.errors import WorkspaceError
from workspaces_support import posix

SLEEPER = "import os, sys, time\nopen(sys.argv[1], 'w').write(str(os.getpid()))\ntime.sleep(60)\n"


def pid_alive(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes
        handle = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
        if not handle:
            return False
        try:
            code = ctypes.c_ulong()
            ctypes.windll.kernel32.GetExitCodeProcess(handle, ctypes.byref(code))
            return code.value == 259  # STILL_ACTIVE
        finally:
            ctypes.windll.kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def test_a_timeout_stops_the_whole_tree_and_returns_promptly(runner, repo, tmp_path):
    script, pidfile = tmp_path / "sleeper.py", tmp_path / "pid.txt"
    script.write_text(SLEEPER, encoding="utf-8")
    repo.write(".gitattributes", "* filter=slow\n")
    repo.git("add", ".gitattributes")
    repo.git("commit", "-q", "-m", "attrs")
    repo.git("config", "filter.slow.clean", f'"{posix(sys.executable)}" "{posix(script)}" "{posix(pidfile)}"')
    for name in ("README.md", ".gitattributes"):  # new mtime, same bytes: git must run the clean filter to compare
        (repo.path / name).write_bytes((repo.path / name).read_bytes())

    started = time.monotonic()
    with pytest.raises(WorkspaceError) as caught:
        runner.run(repo.path, ["status", "--porcelain"], timeout=3)  # filters left on on purpose: this is the slow child
    elapsed = time.monotonic() - started
    assert caught.value.code == "git_timeout" and caught.value.status == 504
    assert elapsed < 12, f"a 3 s timeout took {elapsed:.1f}s"
    assert pidfile.exists(), "the filter never started, so the test proved nothing"
    pid = int(pidfile.read_text())
    deadline = time.monotonic() + 5
    while pid_alive(pid) and time.monotonic() < deadline:
        time.sleep(0.1)
    assert not pid_alive(pid), "the grandchild survived the timeout"
