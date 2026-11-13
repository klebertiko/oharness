"""`oharness providers list|test|doctor`: the Provider connections stored in the data directory, from a terminal (R-PRV-17).

`list` reads the same connections the desktop app shows (one data directory, `data_dir.resolve_data_dir`). `test <id>` runs the
same probe the app's Test button runs (`routers.providers.probe_connection`): a status command for a subscription CLI, the
vendor's no-cost model listing for an API key. Neither prints a secret, a secret reference or raw CLI output: a probe that
crashes is reported as `fault`. A probe's own words (an account e-mail, a CLI's stderr) are never printed: the output is its state,
latency, model count and one fixed sentence per state (en or pt-BR, from `OHARNESS_LANG`/`LANG`). `--json` follows
`schema/providers-cli.schema.json` (versioned, validated by tests).
"""
from __future__ import annotations

import json
import sys

SCHEMA_VERSION = 1
EXIT_OK, EXIT_NOT_LIVE, EXIT_USAGE = 0, 1, 2


def add_parser(sub) -> None:
    providers = sub.add_parser("providers", help="list and test the Provider connections of the OHarness data directory")
    actions = providers.add_subparsers(dest="providers_cmd", required=True)
    listing = actions.add_parser("list", help="the stored connections (never their secrets)")
    listing.add_argument("--json", action="store_true", help="one versioned JSON document (schema/providers-cli.schema.json)")
    listing.add_argument("--verbose", action="store_true", help="print the data directory in full instead of relative to your profile (`~/...`)")
    dump = actions.add_parser("dump-config", help="the effective configuration and where each field came from: default, app (stored connection) or env (this process's environment)")
    dump.add_argument("--json", action="store_true", help="one versioned JSON document (schema/providers-cli.schema.json)")
    doctor = actions.add_parser("doctor", help="the secret-free diagnostics report (same as GET /providers/diagnostics); exits 1 if an enabled connection needs attention")
    doctor.add_argument("--json", action="store_true", help="one versioned JSON document (schema/providers-cli.schema.json)")
    test = actions.add_parser("test", help="run a connection's probe; exits 1 unless it is live")
    test.add_argument("id", help="a connection id from `providers list`")
    test.add_argument("--json", action="store_true", help="one versioned JSON document (schema/providers-cli.schema.json)")


async def _load_runtime():
    """The stored connections and a secrets store, read-only: nothing is created (no data directory, no database, no tables, no secrets folder).

    The store is lazy: it is built only if a probe actually asks for a stored key.
    """
    from . import readonly

    connections, _state = readonly.read_connections()
    return connections, readonly.LazySecrets()


def _kind(provider: str) -> str:
    from adapters.catalog import get_provider

    spec = get_provider(provider)
    return spec["credential"]["kind"] if spec else "unknown"


def _endpoint(raw: str) -> str:
    """The endpoint without credentials: scheme, host, port and path only. Anything that is not a plain http(s) URL prints as empty."""
    from providers.display import safe_endpoint

    return safe_endpoint(raw)


def _shown_dir(path, verbose: bool) -> str:
    """The OS user name lives in the profile path: show it as `~/...` unless asked for in full."""
    from providers.display import mask_home

    return str(path) if verbose else mask_home(str(path))


def _public(row: dict) -> dict:
    return {
        "id": row["id"],
        "provider": row["provider"],
        "label": row["label"],
        "residence": row["residence"],
        "endpoint": _endpoint(row.get("endpoint", "")),
        "enabled": bool(row.get("enabled", False)),
        "credentialKind": _kind(row["provider"]),
        "hasSecret": bool(row.get("secretRef")),
        "defaultModel": row.get("defaultModel", ""),
    }


async def _list(as_json: bool, verbose: bool) -> int:
    connections, _ = await _load_runtime()
    from data_dir import resolve_data_dir

    rows = [_public(row) for row in connections.values()]
    if as_json:
        print(json.dumps({"schemaVersion": SCHEMA_VERSION, "command": "list", "dataDir": _shown_dir(resolve_data_dir(create=False), verbose), "connections": rows}, ensure_ascii=False))
        return EXIT_OK
    if not rows:
        print("no connections yet: add one in the OHarness app (Providers)")
        return EXIT_OK
    for row in rows:
        keyed = "key stored" if row["hasSecret"] else "-"
        state = "enabled" if row["enabled"] else "disabled"
        print(f"{row['id']}\t{row['provider']}\t{row['credentialKind']}\t{state}\t{keyed}\t{row['label']}")
    return EXIT_OK


MESSAGES = {  # one fixed sentence per state: what a probe says (an account e-mail, a CLI's own stderr) is never printed
    "en": {
        "live": "The connection is live.",
        "setup": "Setup is needed: install the provider's CLI or sign in, then test again.",
        "degraded": "The connection answers but is degraded.",
        "fault": "The connection is not working. Check this provider in OHarness.",
    },
    "pt-BR": {
        "live": "A conexão está ativa.",
        "setup": "Falta configurar: instale a CLI do provedor ou entre na conta e teste de novo.",
        "degraded": "A conexão responde, mas está degradada.",
        "fault": "A conexão não está funcionando. Confira este provedor no OHarness.",
    },
}


def _language() -> str:
    import os

    raw = os.environ.get("OHARNESS_LANG") or os.environ.get("LC_ALL") or os.environ.get("LANG") or ""
    return "pt-BR" if raw.lower().startswith("pt") else "en"


async def _probe(connection_id: str, connections: dict, store) -> dict:
    """Run the app's probe and keep only its state, its latency and how many models it listed."""
    from routers.providers import probe_connection

    try:
        result = await probe_connection(connection_id, connections=connections, store=store)
    except Exception:  # never echo the exception: it can hold CLI stderr, a prompt or a credential
        return {"ok": False, "health": "fault", "latencyMs": 0, "modelCount": 0}
    health = result["health"] if result["health"] in MESSAGES["en"] else "fault"
    return {"ok": health == "live" and bool(result["ok"]), "health": health, "latencyMs": max(0, int(result["latencyMs"])), "modelCount": len(result["models"])}


async def _test(connection_id: str, as_json: bool) -> int:
    connections, store = await _load_runtime()
    row = connections.get(connection_id)
    if row is None:
        print(f"no connection {connection_id!r}: see `oharness providers list`", file=sys.stderr)
        return EXIT_USAGE
    outcome = await _probe(connection_id, connections, store)
    message = MESSAGES[_language()][outcome["health"]]
    doc = {"schemaVersion": SCHEMA_VERSION, "command": "test", "id": row["id"], "provider": row["provider"], **outcome, "message": message}
    if as_json:
        print(json.dumps(doc, ensure_ascii=False))
    else:
        print(f"{row['id']}: {outcome['health']} - {message}")
    return EXIT_OK if outcome["health"] == "live" else EXIT_NOT_LIVE


ENV_NAMES = ("OH_DATA_DIR", "OH_SECRETS", "OH_SECRETS_DIR", "DATABASE_URL")  # the only variables dump-config ever reads: never a credential, never a subprocess's environment (I5)

DOCTOR_MESSAGES = {  # one fixed sentence per outcome
    "en": {"ok": "All connections are ready.", "attention": "Some connections need attention: see the failure class above."},
    "pt-BR": {"ok": "Todas as conexões estão prontas.", "attention": "Algumas conexões precisam de atenção: veja a classe da falha acima."},
}

DUMP_TEXT = {  # the words of the `dump-config` text (en or pt-BR, from `OHARNESS_LANG`/`LANG`); field names stay the JSON keys
    "en": {"default": "default", "app": "app", "env": "env", "invalid": "invalid", "none": "no connections yet: add one in the OHarness app (Providers)"},
    "pt-BR": {"default": "padrão", "app": "app", "env": "ambiente", "invalid": "inválido", "none": "nenhuma conexão ainda: adicione uma no app OHarness (Providers)"},
}


def _field(value, origin: str) -> dict:
    return {"value": value, "origin": origin}


def _environment() -> dict:
    """Where the installed app's data lives, as its sidecar would see it from this process's environment: what is not set is the packaged
    sidecar's own default (`sidecar_entry.configure_environment`), worked out here without setting anything (the loader only reads, #497)."""
    import os

    from data_dir import resolve_data_dir

    from . import readonly

    origin = lambda name: "env" if os.environ.get(name) else "default"  # noqa: E731
    data_dir = resolve_data_dir(create=False)
    backend = readonly.secrets_backend() or "unknown"  # a fixed vocabulary: the variable's own text is never echoed
    backend_origin = "env" if "OH_SECRETS" in os.environ else "default"  # set but empty is still a choice: the factory reads it as `memory`
    if backend == "file":  # the folder is only ever a label (the app's own `<data>/secrets`, or one the person chose): its path is never printed
        folder = _field("default" if readonly.secrets_folder() == data_dir / "secrets" else "custom", origin("OH_SECRETS_DIR"))
    else:  # no folder at all: an `OH_SECRETS_DIR` the process was given does not apply
        folder = _field(None, "default")
    return {
        "dataDir": _field(_shown_dir(data_dir, False), origin("OH_DATA_DIR")),
        "secretsBackend": _field(backend, backend_origin),
        "secretsDir": folder,
        "database": _field("sqlite" if (os.environ.get("DATABASE_URL") or "sqlite").startswith("sqlite") else "other", origin("DATABASE_URL")),  # the kind only: a URL can carry a password
    }


def _connection_config(row: dict) -> dict:
    from adapters.catalog import get_provider

    spec = get_provider(row["provider"])
    stored = (row.get("endpoint") or "").strip()
    default_endpoint = _endpoint((spec or {}).get("endpoint", {}).get("default", ""))
    # a stored value that is not a plain http(s) URL is the app's and broken (`null`): it never hides behind the catalog default
    endpoint = _field(_endpoint(stored) or None, "app") if stored else _field(default_endpoint, "default")
    return {
        "id": row["id"],
        "provider": row["provider"],
        "fields": {
            "label": _field(row["label"], "app"),
            "residence": _field(row["residence"], "app"),
            "enabled": _field(bool(row.get("enabled", False)), "app"),
            "endpoint": endpoint,
            "defaultModel": _field(row["defaultModel"], "app") if row.get("defaultModel") else _field("", "default"),
            "credentialKind": _field(_kind(row["provider"]), "default"),  # the catalog decides it, not the user
            "secretStored": _field(bool(row.get("secretRef")), "app"),
        },
    }


def _shown_value(item: dict, words: dict) -> str:
    if item["value"] is None:
        return words["invalid"] if item["origin"] == "app" else "-"  # `null` from the app is a stored value that cannot be used
    return str(item["value"])


async def _dump_config(as_json: bool) -> int:
    """Every connection's effective fields and their origin, plus the environment that locates the data. Never a secret."""
    connections, _ = await _load_runtime()
    doc = {"schemaVersion": SCHEMA_VERSION, "command": "dump-config", "environment": _environment(),
           "connections": [_connection_config(row) for row in connections.values()]}
    if as_json:
        print(json.dumps(doc, ensure_ascii=False))
        return EXIT_OK
    words = DUMP_TEXT[_language()]
    for name, item in doc["environment"].items():
        print(f"{name}	{_shown_value(item, words)}	({words[item['origin']]})")
    if not doc["connections"]:
        print(words["none"])
    for conn in doc["connections"]:
        print(f"{conn['id']} ({conn['provider']})")
        for name, item in conn["fields"].items():
            print(f"  {name}	{_shown_value(item, words)}	({words[item['origin']]})")
    return EXIT_OK


def _app_version() -> str:
    from version import APP_VERSION  # a constant: loading `main` would build the whole app (and read the human credential, write the sidecar token)

    return APP_VERSION


async def _doctor(as_json: bool) -> int:
    """The report `GET /providers/diagnostics` serves (`providers.diagnostics.build_report`), from the stored connections. No network, no probe."""
    from adapters.cli_shared import run_cli
    from providers.diagnostics import build_report

    connections, _ = await _load_runtime()
    from .doctor_cli import _detection_dir

    try:
        report = await build_report(connections, run_cli, _app_version(), cwd=_detection_dir())
    except Exception:  # never echo it: it can hold CLI output
        print("cannot build the diagnostics report: run `oharness doctor`", file=sys.stderr)
        return EXIT_NOT_LIVE
    needs_attention = any(c["enabled"] and c["failureClass"] for c in report["connections"])  # a disabled connection is not a problem
    if as_json:
        print(json.dumps({"schemaVersion": SCHEMA_VERSION, "command": "doctor", **report}, ensure_ascii=False))
    else:
        print(f"OHarness {report['app']['version']} ({report['app']['os']})")
        for c in report["connections"]:
            cli = c["cli"]
            where = f"	{cli['id']} {cli['version'] or '-'}" if cli else ""
            print(f"{c['id']}	{c['state']}	{c['failureClass'] or '-'}{where}")
        print(DOCTOR_MESSAGES[_language()]["attention" if needs_attention else "ok"])
    return EXIT_NOT_LIVE if needs_attention else EXIT_OK


def run(args) -> int:
    import asyncio

    from .readonly import Unreadable

    try:
        return _dispatch(args, asyncio)
    except Unreadable:
        print("cannot read the OHarness data directory: run `oharness doctor`", file=sys.stderr)
        return EXIT_NOT_LIVE


def _dispatch(args, asyncio) -> int:
    if args.providers_cmd == "list":
        return asyncio.run(_list(args.json, args.verbose))
    if args.providers_cmd == "dump-config":
        return asyncio.run(_dump_config(args.json))
    if args.providers_cmd == "doctor":
        return asyncio.run(_doctor(args.json))
    return asyncio.run(_test(args.id, args.json))
