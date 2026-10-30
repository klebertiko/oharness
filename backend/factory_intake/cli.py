"""``oharness factory ...``: the intake side of the factory CLI (ADR 0064). This module owns ``serve`` and ``token``; later subcommands
(submit, list, status...) register here too so the whole group lives in one place."""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

EXIT_OK, EXIT_FAILED, EXIT_USAGE = 0, 1, 2


def add_parser(sub) -> argparse.ArgumentParser:
    factory = sub.add_parser("factory", help="the software factory: intake server, client tokens")
    group = factory.add_subparsers(dest="factory_cmd", required=True)

    serve = group.add_parser("serve", help="receive webhooks and integration API calls (loopback by default)")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--dir", type=Path, default=Path(".oharness/factory"), help="the factory definition directory (webhooks/<name>.yaml)")
    serve.add_argument("--allow-remote", action="store_true", help="bind beyond loopback; put your own authenticated tunnel or proxy in front")

    token = group.add_parser("token", help="client tokens for the integration API (kept hashed in the secrets store)")
    actions = token.add_subparsers(dest="token_cmd", required=True)
    create = actions.add_parser("create", help="create a token; it is printed once")
    create.add_argument("name")
    create.add_argument("--scope", action="append", choices=("work:read", "work:write", "work:claim"), required=True)
    create.add_argument("--out", type=Path, required=True, help="file the token is written to (mode 0600, must not exist); it is never printed")
    create.add_argument("--kind", choices=("cli", "mcp", "webhook", "manual"), default="cli", help="the source.kind its work is recorded under")
    actions.add_parser("check", help="whether a client with this name exists").add_argument("name")
    revoke = actions.add_parser("revoke")
    revoke.add_argument("name")
    auto = group.add_parser("automation", help="scheduled and event automations (ADR 0062)")
    auto.add_argument("--dir", type=Path, default=Path(".oharness/factory"))
    verbs = auto.add_subparsers(dest="auto_cmd", required=True)
    verbs.add_parser("list", help="automations with their triggers and paused state")
    for verb in ("pause", "resume"):
        verbs.add_parser(verb).add_argument("id")
    history = verbs.add_parser("history", help="what fired, what was skipped and why")
    history.add_argument("id", nargs="?")
    history.add_argument("--limit", type=int, default=50)
    verbs.add_parser("tick", help="start the schedule slots that came due since the last tick (for an external cron/launchd; `serve` ticks by itself)")
    return factory


def _backend_on_path() -> None:
    backend = str(Path(__file__).resolve().parent.parent)
    if backend not in sys.path:
        sys.path.insert(0, backend)


def _vault():
    _backend_on_path()
    if os.environ.get("OH_SECRETS", "memory").strip().lower() in ("", "memory", "mem"):
        print("refused: set OH_SECRETS=file or keychain (an in-memory store forgets tokens at exit)", file=sys.stderr)
        return None
    from secret_store.factory import build_secrets_store

    return build_secrets_store()


def run(args: argparse.Namespace) -> int:
    _backend_on_path()
    if args.factory_cmd == "serve":
        from .server import serve

        return serve(args.host, args.port, args.dir, args.allow_remote)
    if args.factory_cmd == "automation":
        return _automation(args)
    if args.factory_cmd == "token":
        from .tokens import ClientTokens

        store = _vault()
        if store is None:
            return EXIT_USAGE
        clients = ClientTokens(store)
        if args.token_cmd == "create":
            try:
                descriptor = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)  # first: a taken path must not cost a token
            except OSError as exc:
                print(f"refused: cannot create {args.out}: {exc.strerror}", file=sys.stderr)
                return EXIT_USAGE
            created = False
            try:
                value = clients.create(args.name, args.scope, args.kind)
                created = True
                with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                    handle.write(value + "\n")
            except Exception as exc:  # a refused or failed creation leaves neither a token file nor a client behind
                if created:
                    clients.revoke(args.name)
                else:
                    os.close(descriptor)
                args.out.unlink(missing_ok=True)
                print(f"refused: {exc}" if isinstance(exc, ValueError) else "failed: the token could not be stored", file=sys.stderr)
                return EXIT_USAGE if isinstance(exc, ValueError) else EXIT_FAILED
            print(json.dumps({"name": args.name, "scopes": sorted(set(args.scope)), "kind": args.kind, "token_file": str(args.out), "note": "only the token's hash is stored"}))
            return EXIT_OK
        if args.token_cmd == "check":
            exists = args.name in clients.names()
            print(json.dumps({"exists": exists}))
            return EXIT_OK if exists else EXIT_FAILED
        if args.token_cmd == "revoke":
            ok = clients.revoke(args.name)
            print(json.dumps({"revoked": ok}))
            return EXIT_OK if ok else EXIT_FAILED
    return EXIT_USAGE


def _automation(args: argparse.Namespace) -> int:
    from .automations import AutomationEngine, AutomationError, load_automations
    from .loader import FoundationMissing, load_port

    try:
        found = load_automations(args.dir)
        port = load_port()
    except (AutomationError, FoundationMissing) as exc:
        print(f"refused: {exc}", file=sys.stderr)
        return EXIT_USAGE
    data = Path(os.environ.get("OH_DATA_DIR") or Path.home() / ".oharness")
    data.mkdir(parents=True, exist_ok=True)
    engine = AutomationEngine(port, found, data / "factory_intake.db")
    try:
        if args.auto_cmd == "list":
            print(json.dumps({"automations": [{"id": a.id, "title": a.title, "agent": a.agent, "enabled": a.enabled, "paused": engine.is_paused(a.id),
                                               "triggers": [f"{t.provider}/{t.name or t.event}" for t in a.triggers]} for a in found.values()]}))
            return EXIT_OK
        if args.auto_cmd in ("pause", "resume"):
            try:
                engine.set_paused(args.id, args.auto_cmd == "pause")
            except KeyError:
                print("refused: no such automation", file=sys.stderr)
                return EXIT_USAGE
            print(json.dumps({"id": args.id, "paused": args.auto_cmd == "pause"}))
            return EXIT_OK
        if args.auto_cmd == "history":
            print(json.dumps({"history": engine.history(args.id, max(1, min(args.limit, 500)))}))
            return EXIT_OK
        if args.auto_cmd == "tick":
            print(json.dumps({"started": engine.tick()}))
            return EXIT_OK
        return EXIT_USAGE
    finally:
        engine.close()
