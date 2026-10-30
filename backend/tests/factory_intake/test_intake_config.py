import json

import pytest

from factory_intake.config import ConfigError, load_webhooks, parse_webhook
from factory_intake.deliveries import KEEP, DeliveryLog
from factory_intake.loader import FoundationMissing, load_port
from factory_intake.memory import MemoryFactory
from factory_intake.server import is_loopback
from factory_intake.tokens import ClientTokens
from secret_store.memory import MemorySecrets

OK = "authMode: signature\nsignatureScheme: github\nsecretRef: factory/gh\ngithub:\n  repos: [Acme/Payments]\n  handle: '@payments'\n  labels: [factory]\n  allowedAuthors: [owner]\n"


def test_a_valid_github_webhook_file():
    cfg = parse_webhook("gh", OK)
    assert cfg.enabled and cfg.github.repos == {"acme/payments"} and cfg.github.allowed_authors == {"owner"} and cfg.secret_ref == "factory/gh"


@pytest.mark.parametrize("name,text", [
    ("Bad_Name", "secretRef: factory/x\n"),
    ("a", "secretRef: oharness/x\n"),                                      # not a factory/ reference
    ("a", "secretRef: factory/x\ntoken: abc\n"),                           # unknown key: no place for a credential
    ("a", "authMode: signature\nsecretRef: factory/x\n"),                  # signature needs a scheme
    ("a", "authMode: token\nsignatureScheme: github\nsecretRef: factory/x\n"),
    ("a", "authMode: nope\nsecretRef: factory/x\n"),
    ("a", "secretRef: factory/x\nenabled: yes please\n"),
    ("a", "secretRef: factory/x\ngithub:\n  repos: [a/b]\n"),               # github block needs the github scheme
    ("a", "secretRef: factory/x\ndeliveryIdHeader: 'a b'\n"),
    ("a", "secretRef: factory/x\nnote: ghp_" + "a" * 36 + "\n"),
    ("a", ": : :\n  - ["),
    ("a", "- just\n- a list\n"),
])
def test_invalid_files_are_rejected_without_echoing_values(name, text):
    with pytest.raises(ConfigError) as exc:
        parse_webhook(name, text)
    assert "ghp_" not in str(exc.value)


def test_load_webhooks_reads_the_directory_and_refuses_symlinks(tmp_path):
    (tmp_path / "webhooks").mkdir()
    (tmp_path / "webhooks" / "ci.yaml").write_text("secretRef: factory/ci\n")
    assert set(load_webhooks(tmp_path)) == {"ci"}
    assert load_webhooks(tmp_path / "nothing") == {}
    (tmp_path / "webhooks" / "evil.yaml").symlink_to(tmp_path / "webhooks" / "ci.yaml")
    with pytest.raises(ConfigError):
        load_webhooks(tmp_path)


def test_delivery_log_keeps_the_newest_entries_and_old_ones_only_within_the_window(tmp_path):
    now = [1_000_000.0]
    log = DeliveryLog(tmp_path / "l.db", clock=lambda: now[0])
    for i in range(KEEP + 20):
        log.record("w", str(i), "accepted", 1, "{}")
    assert len(log.recent("w", 500)) == KEEP + 20  # all within 7 days
    now[0] += 8 * 86400
    log.record("w", "new", "duplicate", 1)
    rows = log.recent("w", 500)
    assert len(rows) == KEEP and rows[0]["delivery_id"] == "new"


def test_tokens_validate_inputs():
    tokens = ClientTokens(MemorySecrets())
    for args in (("Bad Name", ["work:read"], "cli"), ("ok", [], "cli"), ("ok", ["root"], "cli"), ("ok", ["work:read"], "github")):
        with pytest.raises(ValueError):
            tokens.create(*args)
    tokens.create("ok", ["work:read"])
    with pytest.raises(ValueError):
        tokens.create("ok", ["work:read"])
    assert tokens.names() == ["ok"]


def test_loader_explains_a_missing_foundation_and_loads_a_named_port(monkeypatch):
    with pytest.raises(FoundationMissing):
        load_port("no_such_module_xyz:build")
    monkeypatch.setenv("OH_FACTORY_PORT", "factory_intake.memory:MemoryFactory")
    assert isinstance(load_port(), MemoryFactory)
    with pytest.raises(FoundationMissing):
        load_port("factory_intake.memory:nothing_here")
    with pytest.raises(FoundationMissing):
        load_port("os:getcwd")  # outside the allowed packages


def test_loopback_detection():
    assert all(is_loopback(h) for h in ("127.0.0.1", "::1", "[::1]", "localhost", "127.1.2.3"))
    assert not any(is_loopback(h) for h in ("0.0.0.0", "192.168.1.5", "example.com", "::"))


def test_cli_token_commands_refuse_an_in_memory_store_and_work_with_a_file_store(tmp_path, monkeypatch, capsys):
    from oharness.cli import main

    monkeypatch.setenv("OH_SECRETS", "memory")
    assert main(["factory", "token", "check", "x"]) == 2
    monkeypatch.setenv("OH_SECRETS", "file")
    monkeypatch.setenv("OH_SECRETS_DIR", str(tmp_path / "vault"))
    out = tmp_path / "agent-a.token"
    assert main(["factory", "token", "create", "agent-a", "--scope", "work:read", "--out", str(out)]) == 0
    printed = capsys.readouterr().out
    token = out.read_text().strip()
    assert token.startswith("ohf_") and token not in printed and oct(out.stat().st_mode & 0o777) == "0o600"
    assert main(["factory", "token", "check", "agent-a"]) == 0 and json.loads(capsys.readouterr().out) == {"exists": True}
    assert main(["factory", "token", "check", "nobody"]) == 1
    assert main(["factory", "token", "create", "agent-a", "--scope", "work:read", "--out", str(tmp_path / "again.token")]) == 2
    assert not (tmp_path / "again.token").exists()  # a refused creation leaves no file behind
    assert main(["factory", "token", "create", "agent-b", "--scope", "work:read", "--out", str(out)]) == 2  # never overwrites a file
    assert main(["factory", "token", "revoke", "agent-a"]) == 0 and main(["factory", "token", "revoke", "agent-a"]) == 1


def test_cli_serve_refuses_remote_binding_without_the_flag_and_memory_secrets(tmp_path, monkeypatch, capsys):
    from oharness.cli import main

    monkeypatch.setenv("OH_FACTORY_PORT", "factory_intake.memory:MemoryFactory")
    assert main(["factory", "serve", "--host", "0.0.0.0", "--dir", str(tmp_path)]) == 2
    assert "--allow-remote" in capsys.readouterr().err
    monkeypatch.setenv("OH_SECRETS", "memory")
    assert main(["factory", "serve", "--dir", str(tmp_path)]) == 2
    assert "OH_SECRETS" in capsys.readouterr().err


def test_trailing_newlines_and_yml_files_are_rejected_loudly(tmp_path):
    with pytest.raises(ConfigError):
        parse_webhook("a", "secretRef: factory/x\ndeliveryIdHeader: |\n  x-id\n")
    with pytest.raises(ConfigError):
        parse_webhook("a", "secretRef: |\n  factory/x\n")
    (tmp_path / "webhooks").mkdir()
    (tmp_path / "webhooks" / "ci.yml").write_text("secretRef: factory/ci\n")
    with pytest.raises(ConfigError):
        load_webhooks(tmp_path)


def test_token_create_leaves_nothing_behind_when_the_store_fails(tmp_path, monkeypatch):
    from oharness.cli import main

    monkeypatch.setenv("OH_SECRETS", "file")
    monkeypatch.setenv("OH_SECRETS_DIR", str(tmp_path / "vault"))
    import secret_store.file_store as fs

    def boom(self, ref, value):
        raise OSError("disk full")

    monkeypatch.setattr(fs.FileSecrets, "put", boom)
    out = tmp_path / "t.token"
    assert main(["factory", "token", "create", "x", "--scope", "work:read", "--out", str(out)]) == 1
    assert not out.exists()
