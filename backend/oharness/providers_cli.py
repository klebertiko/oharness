"""`oharness providers list|test`: the Provider connections stored in the data directory, from a terminal (R-PRV-17).

`list` reads the same connections the desktop app shows (one data directory, `data_dir.resolve_data_dir`). `test <id>` runs the
same probe the app's Test button runs (`routers.providers.probe_connection`): a status command for a subscription CLI, the
vendor's no-cost model listing for an API key. Neither prints a secret, a secret reference or raw CLI output: a probe that
crashes is reported by a fixed line, and everything a probe says is redacted before it is printed. `--json` follows
`schema/providers-cli.schema.json` (versioned, validated by tests).
"""
from __future__ import annotations

import json
import sys

SCHEMA_VERSION = 1
EXIT_OK, EXIT_NOT_LIVE, EXIT_USAGE = 0, 1, 2
CRASH_DETAIL = "The probe failed to run. Check the provider's configuration and try again."


def add_parser(sub) -> None:
    providers = sub.add_parser("providers", help="list and test the Provider connections of the OHarness data directory")
    actions = providers.add_subparsers(dest="providers_cmd", required=True)
    listing = actions.add_parser("list", help="the stored connections (never their secrets)")
    listing.add_argument("--json", action="store_true", help="one versioned JSON document (schema/providers-cli.schema.json)")
    test = actions.add_parser("test", help="run a connection's probe; exits 1 unless it is live")
    test.add_argument("id", help="a connection id from `providers list`")
    test.add_argument("--json", action="store_true", help="one versioned JSON document (schema/providers-cli.schema.json)")


async def _load_runtime():
    """The stored connections and the secrets store, as the sidecar loads them at startup."""
    from . import headless

    headless._backend_on_path()
    from database import init_db

    await init_db()  # a first-ever run has no tables yet
    return await headless.load_runtime()


def _kind(provider: str) -> str:
    from adapters.catalog import get_provider

    spec = get_provider(provider)
    return spec["credential"]["kind"] if spec else "unknown"


def _public(row: dict) -> dict:
    return {
        "id": row["id"],
        "provider": row["provider"],
        "label": row["label"],
        "residence": row["residence"],
        "endpoint": row.get("endpoint", ""),
        "enabled": bool(row.get("enabled", False)),
        "credentialKind": _kind(row["provider"]),
        "hasSecret": bool(row.get("secretRef")),
        "defaultModel": row.get("defaultModel", ""),
    }


def _safe(text: str) -> str:
    from studio_copilot.redaction import redact  # the shared redactor plus the provider key shapes it misses (sk-ant-, sk-proj-, AIza)

    return redact(str(text))[0]


async def _list(as_json: bool) -> int:
    connections, _ = await _load_runtime()
    from data_dir import resolve_data_dir

    rows = [_public(row) for row in connections.values()]
    if as_json:
        print(json.dumps({"schemaVersion": SCHEMA_VERSION, "command": "list", "dataDir": str(resolve_data_dir(create=False)), "connections": rows}, ensure_ascii=False))
        return EXIT_OK
    if not rows:
        print("no connections yet: add one in the OHarness app (Providers)")
        return EXIT_OK
    for row in rows:
        secret = "key stored" if row["hasSecret"] else "-"
        state = "enabled" if row["enabled"] else "disabled"
        print(f"{row['id']}\t{row['provider']}\t{row['credentialKind']}\t{state}\t{secret}\t{row['label']}")
    return EXIT_OK


async def _probe(connection_id: str, connections: dict, store) -> dict:
    from routers.providers import probe_connection

    try:
        result = await probe_connection(connection_id, connections=connections, store=store)
    except Exception:  # never echo the exception: it can hold CLI stderr, a prompt or a credential
        return {"ok": False, "health": "fault", "detail": CRASH_DETAIL, "latencyMs": 0, "facts": [], "models": []}
    return {
        "ok": bool(result["ok"]),
        "health": result["health"],
        "detail": _safe(result["detail"]),
        "latencyMs": int(result["latencyMs"]),
        "facts": [{"k": _safe(f["k"]), "v": _safe(f["v"]), "tone": f["tone"]} for f in result["facts"]],
        "models": [_safe(m) for m in result["models"]],
    }


async def _test(connection_id: str, as_json: bool) -> int:
    connections, store = await _load_runtime()
    row = connections.get(connection_id)
    if row is None:
        print(f"no connection {connection_id!r}: see `oharness providers list`", file=sys.stderr)
        return EXIT_USAGE
    outcome = await _probe(connection_id, connections, store)
    doc = {"schemaVersion": SCHEMA_VERSION, "command": "test", "id": row["id"], "provider": row["provider"], **outcome}
    if as_json:
        print(json.dumps(doc, ensure_ascii=False))
    else:
        print(f"{row['id']}: {doc['health']} - {doc['detail']}")
        for fact in doc["facts"]:
            print(f"  {fact['k']}: {fact['v']}")
    return EXIT_OK if doc["health"] == "live" else EXIT_NOT_LIVE


def run(args) -> int:
    import asyncio

    if args.providers_cmd == "list":
        return asyncio.run(_list(args.json))
    return asyncio.run(_test(args.id, args.json))
