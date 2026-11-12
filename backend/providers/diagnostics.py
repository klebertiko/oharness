"""Doctor-style report per connection (R-PRV-07). Secret-free by construction.

Only fixed vocabulary and values this module derived travel in the report: the
credential *kind* and *origin* (never the value), the state and failure class,
the endpoint without userinfo/query/fragment, the CLI version (already clamped by
``runtime.cli_detect``) and the CLI path with the user's home directory masked.
No network call is made; CLI state comes from the same status-only probes as
``GET /providers/clis``.
"""

from __future__ import annotations

import platform
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from adapters.catalog import get_provider
from runtime.cli_detect import DETECTED, detect_clis

_CLI_FAILURE = {
    "not-logged-in": "cli-signin",
    "not-installed": "cli-missing",
    "unavailable": "cli-unavailable",
    "error": "cli-error",
}


def mask_home(path: str) -> str:
    """Replace the user's home directory prefix with ``~`` (either slash style)."""
    home = str(Path.home())
    norm = path.replace("\\", "/")
    home_norm = home.replace("\\", "/").rstrip("/")
    if home_norm and norm.lower().startswith(home_norm.lower() + "/"):
        return "~" + norm[len(home_norm):]
    return norm


def safe_endpoint(endpoint: str) -> str:
    """scheme://host[:port]/path — no userinfo, query or fragment."""
    if not endpoint:
        return ""
    try:
        parts = urlsplit(endpoint)
        host = parts.hostname or ""
        port = f":{parts.port}" if parts.port else ""
    except ValueError:
        return ""
    if not parts.scheme or not host:
        return ""
    return f"{parts.scheme}://{host}{port}{parts.path}"


def _cli_path(cli: str, runner: Callable[..., Any]) -> str | None:
    for cid, _provider, cls in DETECTED:
        if cid == cli:
            prefix = cls(runner=runner).cli_argv_prefix()  # type: ignore[call-arg,attr-defined]
            return mask_home(prefix[0]) if prefix else None
    return None


async def build_report(connections: dict[str, dict[str, Any]], runner: Callable[..., Any], app_version: str) -> dict:
    detected = {d["provider"]: d for d in await detect_clis(runner)}
    cli_for_provider = {provider: cid for cid, provider, _cls in DETECTED}
    rows = []
    for row in connections.values():
        provider = row["provider"]
        kind = (get_provider(provider) or {}).get("credential", {}).get("kind", "none")
        entry: dict[str, Any] = {
            "id": row["id"], "provider": provider, "label": row["label"], "enabled": bool(row.get("enabled")),
            "credentialKind": kind, "endpoint": safe_endpoint(row.get("endpoint", "")), "cli": None,
        }
        if kind == "cli" and provider in detected:
            d = detected[provider]
            entry["credentialOrigin"] = "cli"
            entry["state"] = d["state"]
            entry["failureClass"] = _CLI_FAILURE.get(d["state"])
            entry["cli"] = {"id": d["id"], "version": d["version"], "path": _cli_path(cli_for_provider[provider], runner)}
        elif kind == "api-key":
            has = bool(row.get("secretRef"))
            entry["credentialOrigin"] = "vault" if has else "none"
            entry["state"] = "configured" if has else "no-credential"
            entry["failureClass"] = None if has else "credential-missing"
        else:
            entry["credentialOrigin"] = "none"
            entry["state"] = "configured" if row.get("enabled") else "disabled"
            entry["failureClass"] = None
        rows.append(entry)
    return {"app": {"version": app_version, "os": platform.system() or "unknown"}, "connections": rows}
