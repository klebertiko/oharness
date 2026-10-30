"""``oharness factory submit|list|status|comment|cancel|claim|release|metrics|inbox`` (ADR 0064).

Every command takes ``--json`` and then prints exactly one JSON object that was validated against ``oharness/schema/factory.schema.json``
before it left; errors are a JSON object on stderr. Exit codes: 0 ok, 1 the factory refused or failed, 2 usage or no factory here. Nothing
here merges or pushes, and no command approves, answers or confirms anything a person decides.
"""
from __future__ import annotations

import argparse
import getpass
import json
import re
import sys
import uuid
from pathlib import Path

import functools

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "oharness" / "schema" / "factory.schema.json"
EXIT_OK, EXIT_FAILED, EXIT_USAGE = 0, 1, 2
_CONTROL = re.compile(r"[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f]")  # controls, line separators, bidi overrides, zero-width marks
COMMANDS = ("submit", "list", "inbox", "status", "comment", "cancel", "claim", "release", "metrics")
STATES = ["queued", "running", "awaiting_human", "waiting_merge", "claimed", "parked", "done", "cancelled", "failed"]


# stdlib only above this line: the parser is built on every `oharness` run, the factory's dependencies load only when a factory command runs


class ContractError(RuntimeError):
    """The CLI built output the published schema rejects."""


def add_commands(group) -> None:
    def command(name: str, help_text: str, *arguments):
        parser = group.add_parser(name, help=help_text)
        for flag, kwargs in arguments:
            parser.add_argument(flag, **kwargs)
        parser.add_argument("--json", action="store_true", help="print one JSON object (schema/factory.schema.json)")
        return parser

    command("submit", "put work into the factory", ("title", {}), ("--note", {"default": "", "help": "what the foreman starts from"}),
            ("--ref", {"help": "your own id for this work; the same ref twice is one item"}))
    command("list", "list work items, newest first", ("--state", {"choices": STATES}), ("--limit", {"type": int, "default": 20}))
    command("inbox", "items waiting for a person's decision")
    command("status", "one work item", ("id", {}))
    command("comment", "tell the factory something about an item", ("id", {}), ("text", {}))
    command("cancel", "cancel an item", ("id", {}))
    command("claim", "take an item to work on locally (the factory's own run is suspended)", ("id", {}),
                    ("--holder", {"help": "who holds it (default: cli/<your user>)"}),
                    ("--worktree", {"type": Path, "metavar": "REPO", "help": "also make a managed git worktree of this repository and record it on the claim"}))
    command("release", "give a claimed item back; it goes to review, never to done", ("id", {}), ("--summary", {"required": True}),
            ("--status", {"choices": ("needs_review", "abandoned"), "default": "needs_review"}), ("--branch", {"help": "the branch you pushed"}))
    command("metrics", "throughput and cost figures", ("--window-days", {"type": int, "default": 7}))


def _item(view) -> dict:
    return view.model_dump(mode="json")


def _plain(text) -> str:
    return _CONTROL.sub("?", str(text))  # an item's text can come from anywhere: no terminal escape sequences


def _line(item: dict) -> str:
    return f"{_plain(item['id'])}  {_plain(item['state']):<14} {_plain(item['source']['kind']):<9} {_plain(item['title'])}"


def _user() -> str:
    try:
        return getpass.getuser()
    except Exception:  # a uid with no passwd entry and no USER variable
        return "unknown"


@functools.cache
def _validator():
    from jsonschema import Draft202012Validator

    return Draft202012Validator(json.loads(SCHEMA_PATH.read_text(encoding="utf-8")))


def _emit(command: str, payload: dict, as_json: bool, text) -> None:
    out = {"command": command, **payload}
    problem = next(iter(sorted(_validator().iter_errors(out), key=lambda e: list(e.path))), None)
    if problem is not None:  # never print what the published schema rejects
        raise ContractError(f"{command} output breaks the schema at {'/'.join(str(p) for p in problem.absolute_path) or '<root>'}: {problem.message}")
    print(json.dumps(out, ensure_ascii=False) if as_json else "\n".join(text()))


def _make_worktree(repo: Path):
    from workspaces.service import WorkspaceService

    info = WorkspaceService().create(str(repo), "HEAD")  # a managed worktree (ADR 0008): rescue ref on removal, never outside the managed root
    return info["id"], info["path"]


def _drop_worktree(repo: Path, workspace_id: str) -> bool:
    from workspaces.service import WorkspaceService

    try:
        service = WorkspaceService()
        service.remove(str(repo), workspace_id, service.removal_check(str(repo), workspace_id)["confirmation_token"])
        return True
    except Exception:  # best effort: a leftover is listed as an orphaned workspace by the manager
        return False


def run(args: argparse.Namespace, port) -> int:
    from pydantic import ValidationError

    from .pipeline import deliver
    from .port import FactoryError, ReleaseResult, SourceRef, WorkItemDraft

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):  # a title with an emoji must not crash a command that already took effect
            stream.reconfigure(encoding="utf-8", errors="replace")
    name, as_json = args.factory_cmd, args.json
    try:
        if name == "submit":
            ref = args.ref or uuid.uuid4().hex
            draft = WorkItemDraft(source=SourceRef(kind="cli", ref=f"cli:{ref}"[:200]), title=args.title, body=args.note, requested_by=f"cli:{_user()}"[:200],
                                  idempotency_key=f"cli:{ref}"[:200], is_reply=True)
            result = deliver(port, draft)
            item = _item(result.item)
            _emit(name, {"outcome": result.outcome, "item": item}, as_json, lambda: [f"{result.outcome}: {_line(item)}"])
        elif name in ("list", "inbox"):
            items = [_item(i) for i in port.list("awaiting_human" if name == "inbox" else args.state, None, max(1, min(getattr(args, "limit", 50), 200)))]
            _emit(name, {"items": items}, as_json, lambda: [_line(i) for i in items] or ["(none)"])
        elif name == "status":
            item = _item(port.get(args.id))
            _emit(name, {"item": item}, as_json, lambda: [_line(item), f"stage: {item.get('stage')}  cost_tokens: {item['cost_tokens']}  pr: {_plain(item.get('pr_url') or '-')}"])
        elif name == "comment":
            port.comment(args.id, args.text, f"cli:{_user()}")
            _emit(name, {"ok": True}, as_json, lambda: ["comment added"])
        elif name == "cancel":
            item = _item(port.cancel(args.id))
            _emit(name, {"item": item}, as_json, lambda: [_line(item)])
        elif name == "claim":
            holder = (args.holder or f"cli/{_user()}")[:100]
            made = None
            if args.worktree is not None:
                try:
                    made = _make_worktree(args.worktree)
                except Exception as exc:  # no worktree, no claim: the factory keeps running its own work
                    _fail("worktree_failed", f"could not make the worktree ({type(exc).__name__}); nothing was claimed", as_json)
                    return EXIT_FAILED
            try:
                claimed = port.claim(args.id, holder, made[0] if made else None)
            except BaseException:
                if made and not _drop_worktree(args.worktree, made[0]):
                    print(f"note: a worktree was left at {_plain(made[1])}; remove it with the workspace manager", file=sys.stderr)
                raise
            item = _item(claimed)
            _emit(name, {"item": item, "worktree": None if made is None else {"id": made[0], "path": made[1]}}, as_json,
                  lambda: [_line(item)] + ([f"worktree: {_plain(made[1])}  (detached: create a branch there, e.g. git switch -c factory/{args.id})"] if made else [])
                  + [f"when done: push your branch, then oharness factory release {args.id} --summary ... --branch <branch>"])
        elif name == "release":
            item = _item(port.release(args.id, ReleaseResult(summary=args.summary, branch=args.branch, status=args.status)))
            _emit(name, {"item": item}, as_json, lambda: [_line(item)])
        elif name == "metrics":
            figures = port.metrics(max(1, min(args.window_days, 365)))
            _emit(name, {"metrics": figures}, as_json, lambda: [json.dumps(figures, indent=2)])
    except FactoryError as exc:
        _fail(exc.code, exc.message, as_json)
        return EXIT_FAILED
    except ContractError as exc:  # the command already took effect; say so rather than look like a failed request
        _fail("contract_error", f"the command ran but its output did not match the schema ({exc}); check the item with `status`", as_json)
        return EXIT_FAILED
    except ValidationError:  # a bad branch name, an over-long title...
        _fail("invalid_argument", "an argument is not acceptable", as_json)
        return EXIT_USAGE
    return EXIT_OK


def _fail(code: str, message: str, as_json: bool) -> None:
    print(json.dumps({"error": {"code": code, "message": message}}) if as_json else f"{_plain(code)}: {_plain(message)}", file=sys.stderr)
