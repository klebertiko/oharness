"""Intake configuration read from the factory definition directory (ADR 0056 layout, ADR 0061): ``webhooks/<name>.yaml``.

No secret ever lives in these files: ``secretRef`` is the opaque name under which the secrets store holds it. Unknown keys are rejected,
so a field such as ``token:`` cannot be smuggled in; values that look like credentials are rejected too.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.error import YAMLError

from sandbox.secrets import redact

MAX_FILE_BYTES = 256 * 1024
_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")
_SECRET_REF = re.compile(r"^factory/[A-Za-z0-9_.-]{1,100}$")
_HEADER = re.compile(r"^[A-Za-z0-9-]{1,100}$")
AUTH_MODES = ("token", "signature")
SCHEMES = ("github", "generic", "standard")


class ConfigError(ValueError):
    """A definition file is invalid; the message names the file and field, never a value."""


@dataclass(frozen=True)
class GithubSettings:
    repos: frozenset[str]
    handle: str | None
    labels: frozenset[str]
    allowed_authors: frozenset[str] | None
    self_logins: frozenset[str]


@dataclass(frozen=True)
class WebhookConfig:
    name: str
    auth_mode: str
    scheme: str | None
    secret_ref: str
    enabled: bool
    delivery_id_header: str | None
    github: GithubSettings | None


def _strict(where: str, data, allowed: set[str]) -> dict:
    if not isinstance(data, dict):
        raise ConfigError(f"{where}: expected a mapping")
    unknown = sorted(str(k) for k in data if k not in allowed)
    if unknown:
        raise ConfigError(f"{where}: unknown key(s) {', '.join(unknown)}")
    return data


def _strings(where: str, value, required: bool = False) -> list[str]:
    if value is None and not required:
        return []
    if not isinstance(value, list) or not all(isinstance(v, str) and v for v in value):
        raise ConfigError(f"{where}: expected a list of non-empty strings")
    return value


def parse_webhook(name: str, text: str) -> WebhookConfig:
    where = f"webhooks/{name}.yaml"
    if not _NAME.match(name):
        raise ConfigError(f"{where}: the file name must be lowercase letters, digits and '-'")
    if len(text.encode("utf-8")) > MAX_FILE_BYTES:
        raise ConfigError(f"{where}: file is too large")
    try:
        data = YAML(typ="safe").load(text)
    except YAMLError:
        raise ConfigError(f"{where}: not valid YAML") from None
    data = _strict(where, data, {"authMode", "signatureScheme", "secretRef", "enabled", "deliveryIdHeader", "github"})
    mode = data.get("authMode", "token")
    if mode not in AUTH_MODES:
        raise ConfigError(f"{where}: authMode must be one of {', '.join(AUTH_MODES)}")
    scheme = data.get("signatureScheme")
    if mode == "signature" and scheme not in SCHEMES:
        raise ConfigError(f"{where}: signatureScheme must be one of {', '.join(SCHEMES)}")
    if mode == "token" and scheme is not None:
        raise ConfigError(f"{where}: signatureScheme only applies to authMode signature")
    ref = data.get("secretRef")
    if not isinstance(ref, str) or not _SECRET_REF.match(ref):
        raise ConfigError(f"{where}: secretRef must be a reference like factory/<name>")
    enabled = data.get("enabled", True)
    if not isinstance(enabled, bool):
        raise ConfigError(f"{where}: enabled must be true or false")
    header = data.get("deliveryIdHeader")
    if header is not None and not (isinstance(header, str) and _HEADER.match(header)):
        raise ConfigError(f"{where}: deliveryIdHeader must be a header name")
    github = None
    if "github" in data:
        if scheme != "github":
            raise ConfigError(f"{where}: the github block needs signatureScheme github")
        block = _strict(f"{where} github", data["github"], {"repos", "handle", "labels", "allowedAuthors", "selfLogins"})
        handle = block.get("handle")
        if handle is not None and not isinstance(handle, str):
            raise ConfigError(f"{where} github: handle must be a string")
        authors = block.get("allowedAuthors")
        github = GithubSettings(
            repos=frozenset(r.lower() for r in _strings(f"{where} github repos", block.get("repos"))),
            handle=handle, labels=frozenset(_strings(f"{where} github labels", block.get("labels"))),
            allowed_authors=None if authors is None else frozenset(_strings(f"{where} github allowedAuthors", authors)),
            self_logins=frozenset(_strings(f"{where} github selfLogins", block.get("selfLogins"))),
        )
    if redact(text)[1]:
        raise ConfigError(f"{where}: a value looks like a credential; keep secrets in the secrets store and reference them with secretRef")
    return WebhookConfig(name, mode, scheme if mode == "signature" else None, ref, enabled, header, github)


def load_webhooks(directory: Path) -> dict[str, WebhookConfig]:
    folder = Path(directory) / "webhooks"
    found: dict[str, WebhookConfig] = {}
    if folder.is_dir():
        for path in sorted(folder.glob("*.yaml")):
            if path.is_symlink() or not path.is_file():
                raise ConfigError(f"webhooks/{path.name}: symbolic links are not followed")
            found[path.stem] = parse_webhook(path.stem, path.read_text(encoding="utf-8"))
    return found
