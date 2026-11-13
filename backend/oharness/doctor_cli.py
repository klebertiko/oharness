"""`oharness doctor`: one report of the version, the data directory, the database, the secrets store, the sidecar, the sandbox and the
Provider connections (R-DX-01).

The connections are the rows `providers.diagnostics.build_report` already builds (the same report `oharness providers doctor` and
`GET /providers/diagnostics` serve): nothing is re-derived here. Every failure is a fixed code (`cannot-open`, `not-writable`, ...),
never an exception's text, a path or a CLI's own output. The command only looks: it creates nothing, probes no provider and
calls no adapter. Exits 1 when any check fails. `--json` follows `schema/doctor.schema.json` (versioned, validated by tests).
"""
from __future__ import annotations

import json
import os

SCHEMA_VERSION = 1
EXIT_OK, EXIT_FAILED = 0, 1

MESSAGES = {  # one fixed sentence per outcome (en or pt-BR, from `OHARNESS_LANG`/`LANG`)
    "en": {"ok": "Everything is in order.", "failed": "There are failures: see the checks above."},
    "pt-BR": {"ok": "Tudo em ordem.", "failed": "Há falhas: veja as verificações acima."},
}


def add_parser(sub) -> None:
    doctor = sub.add_parser("doctor", help="one report of version, data directory, database, secrets store, sidecar, sandbox and connections; exits 1 if any check fails")
    doctor.add_argument("--json", action="store_true", help="one versioned JSON document (schema/doctor.schema.json)")


def _check(check_id: str, status: str, detail: str | None = None) -> dict:
    return {"id": check_id, "status": status, "detail": detail}


def _data_dir() -> tuple[str, dict]:
    """The data directory as the app and the CLI both resolve it. Looks only: nothing is created."""
    from data_dir import DataDirError, resolve_data_dir

    from . import providers_cli

    try:
        path = resolve_data_dir(create=False)
    except DataDirError:
        return "", _check("dataDir", "fail", "invalid")
    shown = providers_cli._shown_dir(path, False)
    if not path.exists():
        return shown, _check("dataDir", "ok", "missing")  # a first run: the app creates it
    if not path.is_dir():
        return shown, _check("dataDir", "fail", "not-a-folder")
    if not os.access(path, os.W_OK):
        return shown, _check("dataDir", "fail", "not-writable")
    return shown, _check("dataDir", "ok", "exists")


def _sandbox() -> tuple[dict, dict]:
    import shutil

    try:
        from sandbox import permission

        facts = {"defaultMode": str(permission.DEFAULT_MODE), "modes": [str(m) for m in permission.MODES], "gitFound": shutil.which("git") is not None}
    except Exception:  # never echo it: an import error carries paths
        return {"defaultMode": "", "modes": [], "gitFound": False}, _check("sandbox", "fail", "cannot-load")
    return facts, _check("sandbox", "ok")


async def _report() -> dict:
    from adapters.cli_shared import run_cli
    from providers.diagnostics import build_report

    from . import providers_cli

    data_dir, data_check = _data_dir()
    checks = [data_check]
    connections, connection_check = [], _check("connections", "skipped")
    try:
        rows, _store = await providers_cli._load_runtime()
        checks += [_check("database", "ok"), _check("secretsStore", "ok")]
    except Exception:  # never echo it: it can hold a path and the database's own text
        rows = None
        checks += [_check("database", "fail", "cannot-open"), _check("secretsStore", "skipped")]
    try:
        version = providers_cli._app_version()
        checks.append(_check("sidecar", "ok"))
    except Exception:
        version = "unknown"
        checks.append(_check("sidecar", "fail", "cannot-load"))
    facts, sandbox_check = _sandbox()
    checks.append(sandbox_check)
    if rows is not None:
        connections = (await build_report(rows, run_cli, version))["connections"]
        needs_attention = any(c["enabled"] and c["failureClass"] for c in connections)  # a disabled connection is not a failure
        connection_check = _check("connections", "fail" if needs_attention else "ok")
    checks.append(connection_check)
    import platform

    return {"schemaVersion": SCHEMA_VERSION, "command": "doctor", "ok": all(c["status"] != "fail" for c in checks), "version": version,
            "os": platform.system() or "unknown", "dataDir": data_dir, "checks": checks, "sandbox": facts, "connections": connections}


def _print_text(report: dict, language: str) -> None:
    print(f"OHarness {report['version']} ({report['os']})")
    print(f"dataDir\t{report['dataDir'] or '-'}")
    for check in report["checks"]:
        print(f"{check['id']}\t{check['status']}\t{check['detail'] or '-'}")
    sandbox = report["sandbox"]
    print(f"sandbox\tdefault={sandbox['defaultMode'] or '-'}\tmodes={','.join(sandbox['modes']) or '-'}\tgit={'yes' if sandbox['gitFound'] else 'no'}")
    for row in report["connections"]:
        print(f"{row['id']}\t{row['state']}\t{row['failureClass'] or '-'}")
    print(MESSAGES[language]["ok" if report["ok"] else "failed"])


def run(args) -> int:
    import asyncio

    from . import providers_cli

    report = asyncio.run(_report())
    if args.json:
        print(json.dumps(report, ensure_ascii=False))
    else:
        _print_text(report, providers_cli._language())
    return EXIT_OK if report["ok"] else EXIT_FAILED
