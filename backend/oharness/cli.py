import argparse
import json
import sys
from pathlib import Path

from .headless import Refusal, parse_frame, run_graph
from .validate import validate_path

RUN_EVENT_SCHEMA = Path(__file__).resolve().parent / "schema" / "run-event.schema.json"
EXIT_OK, EXIT_RUN_FAILED, EXIT_INVALID = 0, 1, 2


class ContractError(RuntimeError):
    """The engine emitted something the published run-event schema rejects."""


async def _stream(bundle: dict, mode: str = "mock", workspace: str | None = None, worktree: bool = False):
    """Run the harness. Mock needs no Provider and no database; live/local go through the sidecar's own run path (`headless`).

    A person-only checkpoint (HITL) stops the run in both: headless never approves for them."""
    import uuid

    if mode != "mock":
        from . import headless

        async for event, data in headless.stream_live(bundle, mode, workspace, worktree):
            yield event, data
        return

    backend = str(Path(__file__).resolve().parent.parent)  # `engine` is a top-level module of the backend, not part of this package
    if backend not in sys.path:
        sys.path.insert(0, backend)
    from engine import RunControl, execute_harness

    run_id = str(uuid.uuid4())
    control = RunControl(run_id)
    async for chunk in execute_harness(run_graph(bundle), "mock", control=control, run_id=run_id):
        event, data = parse_frame(chunk)
        yield event, data
        if event == "hitl_pause":
            control.stop.set()
            control.release()


def _run(path: Path, as_json: bool, mode: str = "mock", workspace: str | None = None, worktree: bool = False) -> int:
    import asyncio

    from jsonschema import Draft202012Validator
    from jsonschema.exceptions import best_match

    result = validate_path(path)
    if not result.ok:
        print("invalid harness: " + "; ".join(result.errors), file=sys.stderr)
        return EXIT_INVALID
    from . import codec

    bundle = codec.decode_bytes(path.read_bytes())  # the whole bundle: the engine reads `runtime` from it too
    validator = Draft202012Validator(json.loads(RUN_EVENT_SCHEMA.read_text(encoding="utf-8")))

    async def drive() -> str:
        final, sequence = "error", 0
        async for event, data in _stream(bundle, mode, workspace, worktree):
            sequence += 1
            line = {"sequence": sequence, "event": event, "data": data}
            worst = best_match(validator.iter_errors(line))
            if worst is not None:  # the engine and the published schema disagree: never print an event the schema rejects
                where = "/".join(str(part) for part in worst.absolute_path)
                raise ContractError(f"event {event!r} breaks the run-event schema at {where or '<'}: {worst.message}")
            if event == "harness_done":
                final = data["status"]
            if as_json:
                print(json.dumps(line, ensure_ascii=False), flush=True)
            elif event in ("node_start", "node_done", "node_error", "hitl_pause", "run_stopped", "harness_done", "error", "budget_warning"):
                detail = data.get("error") or data.get("message") or data.get("node_id") or data.get("at_node") or data.get("status") or data.get("state", "")
                print(f"{event}: {detail}", flush=True)
        return final

    try:
        status = asyncio.run(drive())
    except ContractError as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_RUN_FAILED
    except Refusal as exc:  # refused before anything ran: nothing was printed to stdout
        print(f"run refused: {exc}", file=sys.stderr)
        return exc.exit_code
    except Exception as exc:  # a crash is a failed run, reported on stderr with a one-line cause rather than a traceback
        print(f"run crashed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return EXIT_RUN_FAILED
    return EXIT_OK if status == "complete" else EXIT_RUN_FAILED


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="oharness")
    sub = parser.add_subparsers(dest="cmd", required=True)
    validate_parser = sub.add_parser("validate")
    validate_parser.add_argument("path", type=Path)

    run_parser = sub.add_parser("run", help="run a harness headless and stream its events")
    run_parser.add_argument("path", type=Path)
    run_parser.add_argument("--json", action="store_true", help="one schema-valid JSON event per line (schema/run-event.schema.json)")

    run_parser.add_argument("--mode", choices=("mock", "live", "local"), default="mock",
                            help="mock (default): no Provider, no network. live/local: the Providers you connected in OHarness (needs OH_SECRETS=file|keychain)")
    run_parser.add_argument("--workspace", help="live/local: a project registered in OHarness; the run works in its folder")
    run_parser.add_argument("--worktree", action="store_true", help="live/local: run in a worktree of its own made from --workspace, removed when the run ends")

    from . import headless

    headless._backend_on_path()  # the factory intake lives beside `engine` in the backend, not in this package
    from factory_intake import cli as factory_cli

    factory_cli.add_parser(sub)

    args = parser.parse_args(argv)
    if args.cmd == "factory":
        return factory_cli.run(args)
    if args.cmd == "validate":
        result = validate_path(args.path)
        print(json.dumps({"ok": result.ok, "errors": result.errors}, indent=2))
        return 0 if result.ok else 1
    if args.cmd == "run":
        if args.mode == "mock" and (args.workspace or args.worktree):
            print("run refused: --workspace and --worktree need --mode live or local (mock runs touch no folder)", file=sys.stderr)
            return EXIT_INVALID
        return _run(args.path, args.json, args.mode, args.workspace, args.worktree)
    return EXIT_INVALID
