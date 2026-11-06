"""Links for the tests: junctions on Windows (no privilege needed), symbolic links elsewhere; skip when the account cannot make one."""
from __future__ import annotations

import errno
import os
import sys

import pytest


def _skip_if_not_permitted(exc: OSError) -> None:
    """Skip only when the account or platform cannot make a link (WinError 1314, EPERM, EACCES, ENOTSUP); any other error is a real failure."""
    if getattr(exc, "winerror", None) == 1314 or exc.errno in (errno.EPERM, errno.EACCES, errno.ENOTSUP):
        pytest.skip("symbolic links need a privilege this account does not have")
    raise exc


def make_dir_link(link, target) -> None:
    """A directory link at ``link`` pointing at ``target``: a junction on Windows (no privilege needed), a symlink elsewhere."""
    if sys.platform == "win32":
        import _winapi
        _winapi.CreateJunction(os.fspath(target), os.fspath(link))
        return
    try:
        os.symlink(target, link, target_is_directory=True)
    except OSError as exc:
        _skip_if_not_permitted(exc)


def remove_dir_link(link) -> None:
    """Undo a link made by ``make_dir_link`` without touching its target."""
    (os.rmdir if sys.platform == "win32" else os.unlink)(link)


def make_symlink(link, target, *, directory: bool) -> None:
    """A real symbolic link; skipped where the platform or the account does not allow creating one (WinError 1314)."""
    try:
        os.symlink(target, link, target_is_directory=directory)
    except NotImplementedError:
        pytest.skip("symbolic links are not implemented on this platform")
    except OSError as exc:
        _skip_if_not_permitted(exc)
