"""#481 / PR #516 QA round: Windows sharing, FIFO, token O_EXCL, sweep and stage mutation survivors."""

from __future__ import annotations

import os
import threading
import time
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from secret_store import file_store
from secret_store.file_store import FileSecrets, _filename_for_ref
from security import sidecar_token

REF = "oharness/p3"


class _Denied(PermissionError):
    """PermissionError as Windows raises it for a replace blocked by an open reader."""

    def __init__(self, code: int = 5) -> None:
        super().__init__(13, "denied")
        self.winerror = code


# ---- P2-1: Windows replace with a reader open ------------------------------------------------


@pytest.mark.skipif(os.name != "nt", reason="an open reader blocks os.replace only on Windows")
def test_put_replaces_a_blob_that_a_reader_still_has_open(tmp_path: Path) -> None:
    store = FileSecrets(tmp_path / "vault", use_keychain=False)
    store.put(REF, "first")
    blob = tmp_path / "vault" / _filename_for_ref(REF)
    fd = file_store._open_checked(blob, file_store._open_flags(os.O_RDONLY))  # the production reader
    try:
        store.put(REF, "second")
    finally:
        os.close(fd)
    assert store.get(REF) == "second"


def test_concurrent_puts_and_gets_never_error(tmp_path: Path) -> None:
    store = FileSecrets(tmp_path / "vault", use_keychain=False)
    store.put(REF, "seed")
    errors: list[BaseException] = []
    stop = time.monotonic() + 1.0

    def writer(n: int) -> None:
        i = 0
        while time.monotonic() < stop:
            try:
                store.put(REF, f"w{n}-{i}")
            except (OSError, AssertionError) as exc:  # the test counts every failure
                errors.append(exc)
            i += 1

    def reader() -> None:
        while time.monotonic() < stop:
            try:
                assert store.get(REF) is not None
            except (OSError, AssertionError) as exc:  # the test counts every failure
                errors.append(exc)

    threads = [threading.Thread(target=writer, args=(n,)) for n in range(2)]
    threads += [threading.Thread(target=reader) for _ in range(3)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(15)
    assert not errors, errors[:3]


def test_a_replace_blocked_for_a_moment_is_retried(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = FileSecrets(tmp_path / "vault", use_keychain=False)
    store.put(REF, "first")
    real = os.replace
    calls = {"n": 0}

    def flaky(src: object, dst: object) -> None:
        calls["n"] += 1
        if calls["n"] <= 2:
            raise _Denied(5)
        real(src, dst)  # type: ignore[arg-type]

    monkeypatch.setattr(file_store, "_REPLACE_DELAY_S", 0.0)
    monkeypatch.setattr(file_store, "_USE_POSIX_RENAME", False)  # exercise the os.replace fallback
    monkeypatch.setattr(file_store.os, "replace", flaky)
    store.put(REF, "second")
    assert calls["n"] == 3
    assert store.get(REF) == "second"


@pytest.mark.parametrize("code", [5, 32])
def test_a_replace_that_stays_blocked_fails_closed_after_a_bounded_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, code: int
) -> None:
    store = FileSecrets(tmp_path / "vault", use_keychain=False)
    store.put(REF, "first")
    calls = {"n": 0}

    def always(src: object, dst: object) -> None:
        calls["n"] += 1
        raise _Denied(code)

    monkeypatch.setattr(file_store, "_REPLACE_DELAY_S", 0.0)
    monkeypatch.setattr(file_store, "_USE_POSIX_RENAME", False)  # exercise the os.replace fallback
    monkeypatch.setattr(file_store.os, "replace", always)
    with pytest.raises(OSError):
        store.put(REF, "second")
    assert 1 < calls["n"] <= file_store._REPLACE_ATTEMPTS
    assert store.get(REF) == "first"
    assert not [p for p in (tmp_path / "vault").iterdir() if p.name.endswith(".tmp")]


def test_a_replace_failing_for_another_reason_is_not_retried(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = FileSecrets(tmp_path / "vault", use_keychain=False)
    store.put(REF, "first")
    calls = {"n": 0}

    def broken(src: object, dst: object) -> None:
        calls["n"] += 1
        raise OSError(28, "no space left")

    monkeypatch.setattr(file_store, "_USE_POSIX_RENAME", False)
    monkeypatch.setattr(file_store.os, "replace", broken)
    with pytest.raises(OSError):
        store.put(REF, "second")
    assert calls["n"] == 1


# ---- P2-2: FIFO must not hang _restrict_file ----------------------------------------------------


@pytest.mark.skipif(os.name == "nt", reason="FIFOs: POSIX only")
def test_restrict_file_on_a_fifo_returns_false_without_blocking(tmp_path: Path) -> None:
    fifo = tmp_path / "pipe"
    os.mkfifo(fifo)
    result: list[bool] = []
    worker = threading.Thread(target=lambda: result.append(file_store._restrict_file(fifo)), daemon=True)
    worker.start()
    worker.join(5)
    assert not worker.is_alive(), "_restrict_file blocked on a FIFO"
    assert result == [False]


# ---- P2-3: token O_EXCL and the empty winner ----------------------------------------------------


def test_an_existing_token_file_is_never_opened_for_writing(tmp_path: Path) -> None:
    path = tmp_path / "sidecar.token"
    path.write_text("old-token", encoding="utf-8")
    assert sidecar_token._persist_token(path, "new-token") == "old-token"
    assert path.read_text(encoding="utf-8") == "old-token"


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_a_symlink_at_the_token_path_is_not_written_through(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    outside.write_text("keep", encoding="utf-8")
    path = tmp_path / "sidecar.token"
    path.symlink_to(outside)
    sidecar_token._persist_token(path, "new-token")
    assert outside.read_text(encoding="utf-8") == "keep"


def test_an_empty_winner_is_waited_for_not_replaced_by_a_different_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "sidecar.token"
    path.write_bytes(b"")  # another process created the name and has not written yet
    monkeypatch.setattr(sidecar_token, "_WINNER_READ_DELAY_S", 0.01)
    threading.Timer(0.1, lambda: path.write_text("winner-token", encoding="utf-8")).start()
    assert sidecar_token._persist_token(path, "mine") == "winner-token"


def test_an_empty_winner_that_never_fills_yields_no_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "sidecar.token"
    path.write_bytes(b"")
    monkeypatch.setattr(sidecar_token, "_WINNER_READ_DELAY_S", 0.0)
    assert sidecar_token._persist_token(path, "mine") is None
    assert path.read_bytes() == b""  # a possibly live writer's file is left alone


# ---- P3: sweep and stage mutation survivors ------------------------------------------------------


def test_the_sweep_never_removes_an_old_file_that_is_not_a_tmp(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    keep = [vault / "blob.bin", vault / ".install-key", vault / ".store-id", vault / "note.tmp"]  # last: no leading dot
    old = time.time() - 3600
    for path in keep:
        path.write_bytes(Fernet.generate_key())
        os.utime(path, (old, old))
    file_store._sweep_stale_tmp(vault)
    assert all(path.exists() for path in keep)


def test_the_sweep_survives_a_tmp_that_vanishes_under_it(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    stale = vault / ".a.dead.tmp"
    other = vault / ".b.dead.tmp"
    old = time.time() - 3600
    for path in (stale, other):
        path.write_bytes(b"x")
        os.utime(path, (old, old))
    real_unlink = Path.unlink

    def racing(self: Path, missing_ok: bool = False) -> None:
        real_unlink(self, missing_ok=missing_ok)
        raise FileNotFoundError(str(self))  # a second sweeper removed it first

    monkeypatch.setattr(Path, "unlink", racing)
    file_store._sweep_stale_tmp(vault)  # must not raise, and must go on to the next entry
    assert not stale.exists() and not other.exists()


def test_a_staged_name_that_already_exists_is_never_opened(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "blob.bin"
    monkeypatch.setattr(file_store.secrets, "token_hex", lambda n: "fixed")
    squatter = tmp_path / ".blob.bin.fixed.tmp"
    squatter.write_bytes(b"keep")
    with pytest.raises(FileExistsError):
        file_store._stage_private(target, b"secret")
    assert squatter.read_bytes() == b"keep"


@pytest.mark.skipif(os.name == "nt", reason="symlinks need privileges on Windows")
def test_a_symlink_at_the_staged_name_is_never_written_through(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    outside = tmp_path / "outside"
    outside.write_bytes(b"keep")
    monkeypatch.setattr(file_store.secrets, "token_hex", lambda n: "fixed")
    (tmp_path / ".blob.bin.fixed.tmp").symlink_to(outside)
    with pytest.raises(FileExistsError):
        file_store._stage_private(tmp_path / "blob.bin", b"secret")
    assert outside.read_bytes() == b"keep"


# ---- P3 SEC: Windows applies the ACL through the open handle -------------------------------------


@pytest.mark.skipif(os.name != "nt", reason="Windows ACL by handle")
def test_the_staged_file_gets_its_acl_through_the_open_handle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[object, bool]] = []
    real = sidecar_token._set_protected_dacl

    def spy(path: object, is_dir: bool, handle: object = None) -> bool:
        seen.append((handle, is_dir))
        return real(path, is_dir, handle)  # type: ignore[arg-type]

    monkeypatch.setattr(sidecar_token, "_set_protected_dacl", spy)
    staged = file_store._stage_private(tmp_path / "blob.bin", b"secret")
    assert staged.read_bytes() == b"secret"
    assert seen and all(handle for handle, is_dir in seen if not is_dir)  # a handle, never a bare name


@pytest.mark.skipif(os.name != "nt", reason="Windows ACL by handle")
def test_the_token_file_gets_its_acl_through_the_open_handle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[object] = []
    real = sidecar_token._set_protected_dacl

    def spy(path: object, is_dir: bool, handle: object = None) -> bool:
        seen.append(handle)
        return real(path, is_dir, handle)  # type: ignore[arg-type]

    monkeypatch.setattr(sidecar_token, "_set_protected_dacl", spy)
    path = tmp_path / "sidecar.token"
    assert sidecar_token._persist_token(path, "tok") == "tok"
    assert seen and all(seen)


# ---- QA/SEC round 2 -------------------------------------------------------------------------------


def test_opening_never_restricts_a_staged_tmp(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / ".blob.bin.live.tmp").write_bytes(b"in flight")
    (vault / "kept.bin").write_bytes(b"x")
    seen: list[str] = []
    real = file_store._restrict_file
    monkeypatch.setattr(file_store, "_restrict_file", lambda p: seen.append(Path(p).name) or real(p))
    file_store._restrict_existing_files(vault)
    assert seen == ["kept.bin"]


def _token_at(monkeypatch: pytest.MonkeyPatch, path: Path) -> None:
    monkeypatch.delenv(sidecar_token.TOKEN_ENV_VAR, raising=False)
    monkeypatch.setattr(sidecar_token, "_token_path", lambda: path)
    monkeypatch.setattr(sidecar_token, "_WINNER_READ_DELAY_S", 0.01)


def test_an_empty_token_file_is_not_deleted_under_a_live_writer(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "sidecar.token"
    path.write_bytes(b"")  # process A created the name and is about to write
    _token_at(monkeypatch, path)
    threading.Timer(0.1, lambda: path.write_text("token-from-a", encoding="utf-8")).start()
    assert sidecar_token.get_or_create_token() == "token-from-a"
    assert path.read_text(encoding="utf-8") == "token-from-a"


def test_a_fresh_empty_token_file_survives_and_this_run_uses_a_memory_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "sidecar.token"
    path.write_bytes(b"")
    _token_at(monkeypatch, path)
    monkeypatch.setattr(sidecar_token, "_WINNER_READ_DELAY_S", 0.0)
    assert sidecar_token.get_or_create_token()
    assert path.exists() and path.read_bytes() == b""


def test_an_old_empty_token_file_heals(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "sidecar.token"
    path.write_bytes(b"")
    old = time.time() - 3600
    os.utime(path, (old, old))
    _token_at(monkeypatch, path)
    monkeypatch.setattr(sidecar_token, "_WINNER_READ_DELAY_S", 0.0)
    token = sidecar_token.get_or_create_token()
    assert path.read_text(encoding="utf-8") == token


@pytest.mark.skipif(os.name != "nt", reason="Windows rename")
def test_the_posix_rename_replaces_a_link_at_the_destination_not_its_target(tmp_path: Path) -> None:
    from security import win_files

    outside = tmp_path / "outside"
    outside.write_bytes(b"keep")
    link = tmp_path / "dst"
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("symbolic links are not available here")
    src = tmp_path / "src"
    src.write_bytes(b"new")
    win_files.rename_replace(src, link)
    assert outside.read_bytes() == b"keep"
    assert not link.is_symlink() and link.read_bytes() == b"new"


def test_the_acl_is_not_applied_to_a_file_the_name_no_longer_points_at(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "blob.bin"
    path.write_bytes(b"x")
    real = os.lstat

    def other(p: object, *a: object, **k: object) -> os.stat_result:
        info = real(p, *a, **k)  # type: ignore[arg-type]
        return os.stat_result((info.st_mode, info.st_ino + 1, info.st_dev, *tuple(info)[3:]))

    monkeypatch.setattr(file_store.os, "lstat", other)
    with pytest.raises(OSError):
        file_store._open_checked(path, file_store._open_flags(os.O_RDONLY), write_dac=True)
    fd = file_store._open_checked(path, file_store._open_flags(os.O_RDONLY))  # a plain read keeps tolerating a swap
    os.close(fd)
