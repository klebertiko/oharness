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
    actions.add_parser("list", help="client names")
    revoke = actions.add_parser("revoke")
    revoke.add_argument("name")
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
    if args.factory_cmd == "token":
        from .tokens import ClientTokens

        store = _vault()
        if store is None:
            return EXIT_USAGE
        tokens = ClientTokens(store)
        if args.token_cmd == "create":
            try:
                descriptor = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)  # before creating: a taken path must not cost a token
            except OSError as exc:
                print(f"refused: cannot create {args.out}: {exc.strerror}", file=sys.stderr)
                return EXIT_USAGE
            try:
                value = tokens.create(args.name, args.scope, args.kind)
            except ValueError as exc:
                os.close(descriptor)
                args.out.unlink()
                print(f"refused: {exc}", file=sys.stderr)
                return EXIT_USAGE
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                handle.write(value + "\n")
            print(json.dumps({"name": args.name, "scopes": sorted(set(args.scope)), "kind": args.kind, "token_file": str(args.out), "note": "only the token's hash is stored"}))
            return EXIT_OK
        if args.token_cmd == "list":
            print(json.dumps({"clients": tokens.names()}))
            return EXIT_OK
        if args.token_cmd == "revoke":
            ok = tokens.revoke(args.name)
            print(json.dumps({"revoked": ok}))
            return EXIT_OK if ok else EXIT_FAILED
    return EXIT_USAGE
