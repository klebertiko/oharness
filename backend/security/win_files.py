"""Windows file opens that Python's ``os.open`` cannot express (``CreateFileW`` through ctypes).

Two things are needed and ``os.open`` offers neither:

* ``FILE_SHARE_DELETE``. A reader opened without it makes ``os.replace`` of that name fail with
  ``WinError 5`` for as long as the reader is open, so a ``put`` racing a ``get`` fails.
* ``WRITE_DAC`` on the handle. The ACL is applied to the *open* file (``SetSecurityInfo``), so a
  junction swapped in between the check and the ACL cannot aim it at another target.

Every function here is Windows-only; callers branch on the platform first.
"""

from __future__ import annotations

import ctypes
import ctypes.wintypes
import msvcrt
import os
from pathlib import Path

GENERIC_READ = 0x80000000
GENERIC_WRITE = 0x40000000
WRITE_DAC = 0x00040000
FILE_SHARE_ALL = 0x1 | 0x2 | 0x4  # READ | WRITE | DELETE
CREATE_NEW = 1
OPEN_EXISTING = 3
_FILE_ATTRIBUTE_NORMAL = 0x80
_INVALID_HANDLE = ctypes.c_void_p(-1).value


def open_file(path: Path, *, access: int, disposition: int, binary_flags: int) -> int:
    """``CreateFileW`` with every share mode, returned as a CRT descriptor.

    ``CREATE_NEW`` is the ``O_EXCL`` equivalent: a name that exists, a link included, is not opened.
    Errors raise ``OSError`` carrying the Win32 code, so ``FileNotFoundError`` and
    ``FileExistsError`` come out as they do from ``os.open``.
    """
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateFileW.argtypes = [
        ctypes.wintypes.LPCWSTR, ctypes.wintypes.DWORD, ctypes.wintypes.DWORD, ctypes.c_void_p,
        ctypes.wintypes.DWORD, ctypes.wintypes.DWORD, ctypes.c_void_p,
    ]
    kernel32.CreateFileW.restype = ctypes.c_void_p
    handle = kernel32.CreateFileW(str(path), access, FILE_SHARE_ALL, None, disposition, _FILE_ATTRIBUTE_NORMAL, None)
    if handle is None or handle == _INVALID_HANDLE:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return msvcrt.open_osfhandle(handle, binary_flags | os.O_NOINHERIT)
    except OSError:
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle(handle)
        raise


class _RenameInfoEx(ctypes.Structure):
    _fields_ = [
        ("Flags", ctypes.wintypes.DWORD),
        ("RootDirectory", ctypes.c_void_p),
        ("FileNameLength", ctypes.wintypes.DWORD),
    ]


_FILE_RENAME_INFO_EX_CLASS = 22
_RENAME_REPLACE_IF_EXISTS = 0x1
_RENAME_POSIX_SEMANTICS = 0x2
_DELETE = 0x00010000
_NT_PREFIX = chr(92) + "??" + chr(92)


def rename_replace(src: Path, dst: Path) -> None:
    """Rename ``src`` over ``dst`` with POSIX semantics (Windows 10 1809+).

    ``os.replace`` (``MoveFileExW``) fails with ``WinError 5`` while *any* handle on ``dst`` is open,
    share mode or not. A POSIX-semantics rename swaps the name at once and the open handle keeps the
    old, complete file: the same behaviour ``os.replace`` has on POSIX. Raises ``OSError`` when the
    system refuses (an older Windows, or a reader opened without ``FILE_SHARE_DELETE``): the caller
    falls back to ``os.replace``.
    """
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.SetFileInformationByHandle.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p, ctypes.wintypes.DWORD]
    kernel32.SetFileInformationByHandle.restype = ctypes.wintypes.BOOL
    kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
    fd = open_file(src, access=_DELETE, disposition=OPEN_EXISTING, binary_flags=os.O_RDONLY)
    try:
        target = _NT_PREFIX + str(dst.resolve(strict=False))  # an NT path: no RootDirectory is given
        name = ctypes.create_unicode_buffer(target)
        name_bytes = len(target) * 2
        header = _RenameInfoEx.FileNameLength.offset + 4  # FileName follows the length; sizeof() adds tail padding
        buffer = ctypes.create_string_buffer(max(ctypes.sizeof(_RenameInfoEx), header + name_bytes + 2))
        info = _RenameInfoEx.from_buffer(buffer)
        info.Flags = _RENAME_REPLACE_IF_EXISTS | _RENAME_POSIX_SEMANTICS
        info.RootDirectory = None
        info.FileNameLength = name_bytes
        ctypes.memmove(ctypes.addressof(buffer) + header, name, name_bytes)
        if not kernel32.SetFileInformationByHandle(msvcrt.get_osfhandle(fd), _FILE_RENAME_INFO_EX_CLASS, buffer, len(buffer)):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        os.close(fd)
