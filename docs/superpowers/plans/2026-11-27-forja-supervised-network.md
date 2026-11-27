# Forja supervised network implementation plan

**Goal:** Keep the factory usable with explicit human consent when OS network isolation is absent.
**Architecture:** A supervisor wraps stage commands and MCP startup. Durable Inbox checkpoints and human decisions precede execution; the existing journal records isolation and approved accesses.
**Tech stack:** Python asyncio, FastAPI, SQLAlchemy; React and the existing Forja UI.
**Spec:** docs/adr/0072-forja-supervised-network.md.

## Constraints

- Stack on PR #543; no dependency changes, suppression, issue creation or merge.
- Current executor always reports `none`; an author cannot claim `os` in a definition.
- Approval is bound to a live request; durable host consent is scoped to factory/agent/definition.
- Checkpoints and audit must redact run secrets.

## Tasks

- [x] Add failing classifier and live authorization tests; implement conservative local diagnostics and host consent grammar in `backend/factory/network_supervision.py`.
- [x] Connect `network_approvals.py`, `dispatch.py`, MCP and human-only HTTP decisions to durable Inbox checkpoints; test wrong credentials, stale/replay, scope, denial and MCP startup.
- [x] Record isolation and each authorized access; invalidate stopped/orphaned waits and test recovery, including parked items.
- [x] Show supervision on factory/items and actionable Inbox details with localized copy; test once/host/deny, stale state and polling during a waiting run.
- [x] Run affected backend/frontend checks and independent review. Publication remains a draft stacked on the policy branch for human QA/SEC.

## Review focus

- Scripts that construct destinations at runtime require individual consent.
- Host consent never covers redirect/config options, interpreters or MCP.
- Stop races, cross-thread port actions and restart cannot consume a pending decision.
- A persisted question must not trap an item in an unrecoverable status.
- The open item sheet must discover successive requests while the start route waits.
