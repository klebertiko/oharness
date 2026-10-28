# Bar — Cursor Cloud Agents + Automations (fetched 2026-09-11)

Real reference for the Automate gauntlet loop. Fetched live from
cursor.com/docs (Cloud Agents, Automations) and from two screenshots the
project owner supplied of the actual product UI. Read this before building or
judging any Automate piece — do not compare against a description of Cursor
from memory.

## Screenshots (the actual UI — open these, don't just read this summary)
- `C:\Users\<user>\Pictures\Screenshots\Captura de tela 2026-09-10 163443.png`
  — Cursor sidebar: background/cloud-agent tasks listed under a repository
  ("NightwolfRGB project e...", "Workbench subagent drive", "Product page
  design ide...") each with an elapsed-time chip (4m / 36m / 16h) and a status
  glyph. This is the "what's running / what ran" list.
- `C:\Users\<user>\Pictures\Screenshots\Captura de tela 2026-09-10 163504.png`
  — one automation's detail view: title, Active/Inactive toggle, repository
  selector, author; **Settings | Run History** tabs; a **Triggers** section
  (schedule in plain language, "+ Add Trigger"); an **Agent Instructions**
  textarea with a model picker; a **Tools** section (Memories, "Send to
  Slack — Requires connection", "+ Add Tool or MCP") with an inline warning
  when a tool needs authentication.

## Cloud Agents — mechanics (docs.cursor.com/background-agent)
- Run in isolated VMs, in parallel, without the local machine staying connected.
- Started from many surfaces: the agent input's Cloud dropdown, cursor.com/agents,
  iOS app, Slack `@cursor`, a GitHub/Bitbucket PR comment, Linear, or the API.
- A dashboard shows every agent: which environment/build it used, version
  history; hovering the repo name on an agent's page shows the environment
  used for that run.
- Environment setup (deps, secrets, startup commands) is called out as *the*
  lever for whether an agent can actually close the loop on its work — not
  just write code, but run tests and verify.

## Automations — mechanics (docs.cursor.com/automations)
- An automation = **trigger(s) + instructions + tools + scope**, saved and
  activated. Created from the Agents Window, cursor.com/automations, a plain-
  language `/automate` skill, or a marketplace template.
- **Triggers** (an automation can have more than one; fires on any):
  - Scheduled — presets or a raw cron expression.
  - Source control — PR/push events (opened, pushed, merged, label changed,
    CI completed, review submitted, comment added, ...). GitHub is the richest
    provider; GitLab/Bitbucket support the core set.
  - Slack — new message in a channel (with keyword/regex filter), emoji
    reaction, channel created.
  - Webhook — a generic inbound trigger (page was cut off before detail).
- **Tools** the agent may use during a run: Memories, "Send to Slack" (shown
  greyed with "Requires connection" until authorized, with a "Connect" CTA and
  a page-level warning banner), "Comment on Pull Request", or anything from
  MCP, added via "+ Add Tool or MCP".
- **Scope**: none, one repo, or multiple repos; required for source-control
  triggers.
- Three Cursor-managed automations ship built in: Bugbot (PR review), Security
  Agents (vuln scan), PR Routing & Approval.

## What this means for OHarness's Automate (do not copy verbatim — adapt)
- Cursor's "Instructions + Tools" per automation is *our* harness (OHarness
  puts reusable instructions/tools in the harness graph, not in each job) —
  keep "What runs" as a harness picker, not a duplicate textarea.
- Cursor's "Tools → Send to Slack, requires connection, greyed with a Connect
  CTA" is exactly the pattern for how OHarness should show a not-yet-
  connected MCP notification target — greyed, honest, one click to Providers/
  connect, never silently skipped.
- Cursor's background-agent list (elapsed time + status per running/finished
  task) is the pattern for "what's running now" inside Automate — reuse
  StatusDot + relative time, already built for Chats/Runs.
- Scope: Cursor's is a connected repo. Ours is a Cowork-style folder/repo,
  merged into the job instead of living in a separate surface.
