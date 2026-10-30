# ADR 0037 — Design-system documentation structure and the `edge-selected` token

Status: accepted

## Decision
- Component and pattern documentation lives in `docs/design-system/components/`, one file per family (primitives, model picker, composer, run surfaces, Studio, shell, patterns, Providers). Each component states anatomy, states, variants, use and misuse, accessibility, copy (English as shipped, pt-BR as the translation reference) and a real example from the app. `reference/` stays the runnable specification of the seven primitives; it grows with the new states, it does not become a second app.
- `components/ui/` is the specified set. New work uses it. `shell/Panel` and `shell/ListRow` stay until a dedicated pull request merges them, because they differ in markup and in tests (audit finding D6).
- `audit/components.md` is the inventory of what the app uses against what the system documents, with counts that anyone can reproduce with `git grep`. A change that adds a component or pattern to the app adds its row there and its section in `components/`.
- One token is added: `edge-selected` (`--edge-selected: inset 2px 0 0 var(--signal)`, utility `shadow-selected`). It replaces the same arbitrary shadow written in four components. It is an edge, not an elevation, so it does not change the rule that only the composer and floats carry a shadow.

## Why this is hard to reverse
Token names are public to every later component and to the reference. Renaming `edge-selected` after the docs, the reference and other sessions' screens use it would touch all of them. The folder layout is linked from the README, the site and later ADRs.

## Conservative choices
- No other token is added. Marker sizes (5, 7 and 9px), node-plate internals and reading measures stay as documented deviations until a visual-change pull request can show before and after.
- The guardrail test forbids the old arbitrary form, so the token cannot be bypassed quietly.
