"""Non-authoritative Laya issue triage experiment.

The output is evidence only. It must never decide CI, severity, release eligibility,
or mutate a GitHub issue.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from time import perf_counter

from laya import Router


def _load_event() -> dict:
    return json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))


def _fetch_issue(number: str | int) -> dict:
    """Load issue JSON via gh (static argv; avoids dynamic urllib OpenGrep finding)."""
    repo = os.environ["GITHUB_REPOSITORY"]
    issue_no = int(number)
    try:
        raw = subprocess.check_output(
            ["gh", "api", f"repos/{repo}/issues/{issue_no}"],
            text=True,
            stderr=subprocess.STDOUT,
            env=os.environ,
        )
    except subprocess.CalledProcessError as exc:
        raise SystemExit(
            f"Failed to fetch issue #{issue_no} via gh api: {exc.output}"
        ) from exc
    return json.loads(raw)


def _resolve_issue(event: dict) -> dict:
    if isinstance(event.get("issue"), dict):
        return event["issue"]
    number = os.environ.get("LAYA_ISSUE_NUMBER") or (event.get("inputs") or {}).get(
        "issue_number"
    )
    if not number:
        raise SystemExit(
            "No issue payload in GITHUB_EVENT_PATH and LAYA_ISSUE_NUMBER / "
            "inputs.issue_number unset (workflow_dispatch requires an issue number)."
        )
    return _fetch_issue(number)


def main() -> None:
    event = _load_event()
    issue = _resolve_issue(event)
    state = {
        "title": issue.get("title", "")[:500],
        "body": issue.get("body", "")[:6000],
    }
    questions = {
        "component": {
            "type": "choice",
            "instructions": "Which OHarness component most likely owns this issue?",
            "criteria": {
                "backend": "Python API, execution engine, adapters, storage or scheduler",
                "frontend": "Next.js interface, state, components or accessibility",
                "desktop": "Tauri, Rust, Windows installer or sidecar packaging",
                "ci_security": "CI, release, dependencies, supply chain or security tooling",
                "documentation": "Documentation, examples or contributor experience",
                "unknown": "Insufficient information or cross-cutting concern",
            },
        },
        "kind": {
            "type": "choice",
            "instructions": "What kind of work does this issue primarily describe?",
            "criteria": {
                "bug": "Existing behavior is incorrect or broken",
                "feature": "New user-visible capability",
                "security": "Vulnerability, hardening or trust boundary concern",
                "maintenance": "Dependencies, refactoring, CI or operational upkeep",
                "question": "Clarification or support request",
                "unknown": "Insufficient information",
            },
        },
        "needs_human_triage": {
            "type": "noul",
            "instructions": "Is the issue ambiguous, cross-cutting, or high impact enough to require human triage?",
        },
    }
    started = perf_counter()
    result = Router(max_loaded=1).predict(state, questions)
    evidence = {
        "schema_version": "oharness-issue-triage-v1",
        "authority": "advisory-shadow",
        "issue_number": issue["number"],
        "model_result": result,
        "latency_ms": round((perf_counter() - started) * 1000, 2),
    }
    output = Path(os.environ.get("LAYA_OUTPUT", "laya-shadow-result.json"))
    output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
