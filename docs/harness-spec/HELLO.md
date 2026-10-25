# Hello, OHarness Bundle

An **`.oharness`** file is a single JSON document that packages an agent harness: who acts (roles), how work flows (graph + gates), and the embedded markdown that drives them (skills, agents, hooks, prompts, commands, scripts).

## Minimal shape

Every bundle has six top-level keys:

| Key | Purpose |
|-----|---------|
| `schemaVersion` | Bundle schema semver (`1.0.0`) |
| `manifest` | Identity (`id`, `name`, `version`, …) |
| `graph` | Role `nodes` + gate-flow `edges` |
| `content` | Embedded maps: `prompts`, `agents`, `skills`, `hooks`, `commands`, `scripts` |
| `runtime` | Preferred runtime (`api` / CLI), env, secrets |
| `validation` | Mock/dry-run profile |

A tiny valid bundle looks like the fixture at `backend/tests/oharness/fixtures/valid-hello.oharness` — empty content maps and an empty graph are allowed.

## Schema

Authoritative JSON Schema:

[`backend/oharness/schema/oharness.schema.json`](../../backend/oharness/schema/oharness.schema.json)

Validate any file:

```bash
cd backend
python -m oharness validate path/to/bundle.oharness
```

## Agile Harness

OHarness ships the Agile Harness, an Agile/Scrum/Kanban harness adapted from the skills-framework project, as the product default:

- **Fixture:** [`backend/oharness/fixtures/default-agile.oharness`](../../backend/oharness/fixtures/default-agile.oharness)
- **Manifest id:** `oharness.default.agile`
- **Source:** `skills-framework/skills/engineering/harness/`
- **Compiler:** `oharness.compile_skills_harness.compile_skills_harness`

That bundle embeds the eight roles (PO, SM, BE, FE, QA, ARCH, TW, SEC), their agent markdown, hooks, process docs, templates, and scripts, plus a coarse gate-flow graph suitable for mock dry-runs.
