# OHarness public harness standard

This folder is the **public entry** for the `.oharness` bundle format — the
portable packaging of an agent harness (roles, graph, gates, embedded skills /
agents / hooks).

## Start here

| Doc | What it is |
|-----|------------|
| [`HELLO.md`](HELLO.md) | Minimal shape of a valid `.oharness` file |
| [JSON Schema](../../backend/oharness/schema/oharness.schema.json) | Authoritative schema (`schemaVersion` 1.0.0) |
| [Default Agile fixture](../../backend/oharness/fixtures/default-agile.oharness) | Product default (`oharness.default.agile`) |

## Validate

```bash
cd backend
python -m oharness validate path/to/bundle.oharness
```

Exit code `0` means the document matches the schema and structural rules.
Invalid fixtures live under `backend/tests/oharness/fixtures/`.

## Design notes

- Spec: `docs/superpowers/specs/2026-09-09-oharness-design.md`
- Packaging ADR: `docs/adr/0001-desktop-packaging.md` (Tauri v2 + sidecar)
- Desktop embeds the default Agile bundle at
  `src-tauri/resources/default-agile.oharness`
