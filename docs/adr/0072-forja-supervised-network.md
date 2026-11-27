# 0072 — Supervised network access for Forja commands

Date: 2026-11-27
Status: proposed

The local command executor does not isolate network access at OS level. A program
can construct a destination at runtime, so a command-line host check alone cannot
confine it. Forja must remain usable while making this limitation visible.

All stage commands pass through a supervisor before execution. The current
executor reports `isolation: none`, `mode: supervised` in the run journal and API;
the factory, work item and Inbox display the supervised state. There is no
capability flag that lets a definition claim OS isolation.

Only the fixed `git --version` and `git version` diagnostics proceed without a
network checkpoint. Other programs, repository commands, shells, scripts and
package managers require a person. Explicit host denials and protected git
operations remain denied. This intentionally favors additional approvals over
guessing that an arbitrary command is local.

A checkpoint persists the redacted command, hosts, run and request ID in the
item history. The live coroutine waits; other items may use the remaining runner
slots. The existing human credential is required to approve once, remember a
host, or deny. Generic answers and Inbox dismissal do not authorize execution.
The audit commits before execution resumes. Every approved use is also recorded
in the run journal, including uses of remembered consent.

Reusable host consent is limited to `curl --disable https://<host>/...`, with one
canonical host, no userinfo or additional options. The leading `--disable`
prevents curl config loading. Redirects, proxies, wrappers, interpreters and MCP
processes cannot inherit host consent. Consent is scoped to the factory, agent
and hash of the complete definition; a policy/definition change asks again.
It records permission to run a recognized command, not a network firewall.

MCP processes use the same supervisor before startup, including their initial
protocol exchange. In-process test transports do not start a subprocess. Stop,
cancel, park and claim invalidate pending decisions. Restart expires orphaned
checkpoints and asks a normal recovery question, so a stale approval never
executes a command or leaves the item permanently blocked.

The next boundary is an actual OS sandbox for `sandbox_exec.run`. That work is
separate. No proxy or OS confinement is implemented by this decision, and an
approved opaque command may access any network destination. The UI states that
network access is supervised and not isolated by the OS.
