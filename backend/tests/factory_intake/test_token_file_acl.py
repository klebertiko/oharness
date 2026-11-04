"""#342: `factory token create --out` writes a bearer token; only the current account may read the file, on POSIX and on Windows."""
import getpass
import os
import subprocess
from types import SimpleNamespace

import pytest

from oharness.cli import main
from security import sidecar_token


def _create(tmp_path, monkeypatch, name="agent-a"):
    monkeypatch.setenv("OH_SECRETS", "file")
    monkeypatch.setenv("OH_SECRETS_DIR", str(tmp_path / "vault"))
    out = tmp_path / f"{name}.token"
    return out, main(["factory", "token", "create", name, "--scope", "work:read", "--out", str(out)])


@pytest.mark.skipif(os.name != "nt", reason="reads the Windows ACL")
def test_token_file_is_restricted_to_the_current_user(tmp_path, monkeypatch):
    out, code = _create(tmp_path, monkeypatch)
    assert code == 0
    listing = subprocess.run(["icacls", str(out)], capture_output=True, text=True, check=True).stdout  # nosemgrep
    entries = [line.strip() for line in listing.splitlines()[:-2] if "(" in line]
    names = " ".join(entries).lower()
    assert getpass.getuser().lower() in names
    assert not any(word in names for word in ("everyone", "builtin" + chr(92) + "users", "authenticated users", "(i)"))  # (I): inherited from the folder


@pytest.mark.skipif(os.name == "nt", reason="POSIX mode bits")
def test_token_file_is_mode_0600(tmp_path, monkeypatch):
    out, code = _create(tmp_path, monkeypatch)
    assert code == 0 and oct(out.stat().st_mode & 0o777) == "0o600"


def test_a_token_is_never_written_when_the_file_cannot_be_restricted(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(sidecar_token, "restrict_to_current_user", lambda path, *, strict=False: False)
    out, code = _create(tmp_path, monkeypatch)
    assert code != 0 and not out.exists()
    assert "ohf_" not in capsys.readouterr().out
    monkeypatch.undo()
    monkeypatch.setenv("OH_SECRETS", "file")
    monkeypatch.setenv("OH_SECRETS_DIR", str(tmp_path / "vault"))
    assert main(["factory", "token", "check", "agent-a"]) == 1  # the failed attempt left no client behind


def test_the_restriction_reports_a_failed_icacls(tmp_path, monkeypatch):
    target = tmp_path / "t"
    target.write_text("x")
    monkeypatch.setattr(sidecar_token.platform, "system", lambda: "Windows")
    for returncode, restricted in ((5, False), (0, True)):
        monkeypatch.setattr(sidecar_token.subprocess, "run", lambda *a, _rc=returncode, **k: SimpleNamespace(returncode=_rc))
        assert sidecar_token.restrict_to_current_user(target) is restricted
