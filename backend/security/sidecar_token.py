"""
Local-process auth for the FastAPI sidecar.

SEC-3 (harness Security Gate, 2026-09-11): the sidecar bound to 127.0.0.1 and
CORS excluding "null" close the *remote* vector (any website, any browser tab
— proven exploitable before that fix via `Origin: null`). What neither of
those closes is a *local* one: any other process running as this Windows
user can still call the sidecar's mutating routes with no credential at all,
because loopback binding restricts *where from*, never *who*.

This module is the local answer: a random token, generated once and
persisted to a file only this user account can read, required on every
mutating request via `Authorization: Bearer <token>`. A page in a browser —
even one somehow running as this user — cannot read that file; only a
process with real filesystem access can, which is the same bar the CLI
adapters already assume for cwd/env (see adapters/cli_shared.py).

**What this does not yet cover, by design, not oversight:** the packaged
desktop build does not yet spawn this sidecar as a Tauri-managed child
process — src-tauri/tauri.conf.json currently has no `externalBin` (removed
earlier this session: "no packaged sidecar binary exists yet"). The intended
production shape is for Tauri's Rust side to generate this token, pass it to
the sidecar as an environment variable at spawn time, and inject it into the
webview the same way `window.__OH_API__` already is (see
frontend/src/lib/apiBase.ts). Until that integration exists, this module
persists the token to a file instead — good enough to close the local vector
in dev, but the file-based handoff below (`frontend/src/app/api/
sidecar-token/route.ts`, a same-origin Next server route) is a dev-only
bridge, not the production design. Revisit when the sidecar is actually
packaged.
"""

from __future__ import annotations

import os
import platform
import secrets
import stat
from pathlib import Path

TOKEN_HEADER = "authorization"
TOKEN_ENV_VAR = "OH_SIDECAR_TOKEN"


def _token_dir() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("HOME") or str(Path.home()))
    d = base / "OHarness"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _token_path() -> Path:
    return _token_dir() / "sidecar.token"


def _set_protected_dacl(path: Path, is_dir: bool) -> bool:
    """Windows: replace the whole DACL in one call, with one ACE for this user and nothing inherited.

    One ``SetNamedSecurityInfoW`` with ``PROTECTED_DACL_SECURITY_INFORMATION``: the object goes
    from its old ACL straight to the final one, so there is no step that is more open than the
    end state (a reset-then-grant sequence hands back the parent's inherited ACL in between, and
    a failed grant would leave it). Foreign explicit ACEs go with the old DACL. A directory's ACE
    is inherited by what is written inside it.
    """
    import ctypes
    from ctypes import wintypes

    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.GetCurrentProcess.restype = wintypes.HANDLE
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    advapi32.OpenProcessToken.argtypes = [wintypes.HANDLE, wintypes.DWORD, ctypes.POINTER(wintypes.HANDLE)]
    advapi32.GetTokenInformation.argtypes = [
        wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.ConvertSidToStringSidW.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)]
    advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p,
    ]
    advapi32.GetSecurityDescriptorDacl.argtypes = [
        ctypes.c_void_p, ctypes.POINTER(wintypes.BOOL), ctypes.POINTER(ctypes.c_void_p), ctypes.POINTER(wintypes.BOOL),
    ]
    advapi32.SetNamedSecurityInfoW.argtypes = [
        wintypes.LPWSTR, ctypes.c_int, wintypes.DWORD, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p,
    ]
    advapi32.SetNamedSecurityInfoW.restype = wintypes.DWORD

    token = wintypes.HANDLE()
    if not advapi32.OpenProcessToken(kernel32.GetCurrentProcess(), 0x0008, ctypes.byref(token)):  # TOKEN_QUERY
        return False
    sid_text = ctypes.c_void_p()
    descriptor = ctypes.c_void_p()
    try:
        needed = wintypes.DWORD()
        advapi32.GetTokenInformation(token, 1, None, 0, ctypes.byref(needed))  # TokenUser: ask for the size
        buffer = ctypes.create_string_buffer(needed.value)
        if not advapi32.GetTokenInformation(token, 1, buffer, needed, ctypes.byref(needed)):
            return False
        user_sid = ctypes.c_void_p.from_buffer(buffer).value  # TOKEN_USER starts with the SID pointer
        if not advapi32.ConvertSidToStringSidW(user_sid, ctypes.byref(sid_text)):
            return False
        inherit = "OICI" if is_dir else ""
        sddl = f"D:P(A;{inherit};FA;;;{ctypes.wstring_at(sid_text.value)})"
        if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl, 1, ctypes.byref(descriptor), None):
            return False
        present, defaulted, dacl = wintypes.BOOL(), wintypes.BOOL(), ctypes.c_void_p()
        if not advapi32.GetSecurityDescriptorDacl(descriptor, ctypes.byref(present), ctypes.byref(dacl), ctypes.byref(defaulted)):
            return False
        # SE_FILE_OBJECT; DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION
        return advapi32.SetNamedSecurityInfoW(str(path), 1, 0x00000004 | 0x80000000, None, None, dacl, None) == 0
    finally:
        if descriptor.value:
            kernel32.LocalFree(descriptor)
        if sid_text.value:
            kernel32.LocalFree(sid_text)
        kernel32.CloseHandle(token)


def restrict_to_current_user(path: Path) -> bool:
    """Strip access for anyone but the current account; True only when that is known to have worked.

    Not a hard guarantee (a local admin can always override ACLs/chmod —
    that is true of any secret-on-disk scheme, including this app's own
    FileSecrets store), but it raises the bar past "any process that can
    open a file this user's shell can also open." Callers that must not
    leave a secret exposed (a token file) check the result.
    """
    if platform.system() == "Windows":
        try:
            return _set_protected_dacl(path, path.is_dir())
        except (OSError, ValueError, AttributeError):
            return False
    try:
        os.chmod(path, 0o700 if path.is_dir() else 0o600)
    except OSError:
        return False
    return True


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise OSError("could not write the token file")
        view = view[written:]


def _persist_token(path: Path, token: str) -> str | None:
    """Create ``path`` exclusively and owner-only, restrict it, and only then write the token.

    Returns the token on disk (this one, or a concurrent winner's) or ``None`` when it could not
    be stored restricted, in which case nothing is left behind and the caller keeps its token in
    memory for this run.
    """
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_BINARY", 0) | getattr(os, "O_CLOEXEC", 0)
    try:
        fd = os.open(path, flags, 0o600)
    except FileExistsError:
        try:
            return path.read_text(encoding="utf-8").strip() or None
        except OSError:
            return None
    except OSError:
        return None
    try:
        if platform.system() == "Windows":
            os.close(fd)  # the ACL is set on the closed file, then it is reopened to write
            fd = -1
            if not restrict_to_current_user(path):
                raise OSError("could not restrict the token file")
            fd = os.open(path, os.O_WRONLY | getattr(os, "O_BINARY", 0), 0o600)
        else:
            os.fchmod(fd, stat.S_IRUSR | stat.S_IWUSR)
        _write_all(fd, token.encode("utf-8"))
    except OSError:
        if fd >= 0:
            os.close(fd)
        path.unlink(missing_ok=True)
        return None
    os.close(fd)
    return token


def get_or_create_token() -> str:
    """The sidecar's own auth secret for this run.

    ``OH_SIDECAR_TOKEN`` in the environment wins when set — that is the seam
    a real Tauri-spawns-sidecar integration would use (env var at spawn
    time, never touching disk). Otherwise, generate once and persist to a
    user-restricted file so the token survives a sidecar restart without
    invalidating whatever the frontend has already cached. If the file cannot
    be created restricted, nothing is written and the token lives in this
    process only.
    """
    env_token = os.environ.get(TOKEN_ENV_VAR, "").strip()
    if env_token:
        return env_token

    path = _token_path()
    if path.is_file():
        existing = path.read_text(encoding="utf-8").strip()
        if existing:
            return existing
        path.unlink(missing_ok=True)  # an empty leftover: nothing was ever stored in it

    token = secrets.token_urlsafe(32)
    return _persist_token(path, token) or token
