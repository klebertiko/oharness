# OHarness design system

The design reference for every surface of the app. Tokens are the single vocabulary; the documents below say how to use them.

| File | What it is |
| --- | --- |
| `tokens.json` | Every token, in DTCG format, two themes. `npm test` proves the 59 colour, shape, layout and motion variables match `frontend/src/app/globals.css` and the 7 type roles match the `.t-*` rules and the `--text-*` scale in the `@theme` block of `globals.css`. |
| `README.md` | This brand book: content, visual foundations, iconography, layout, contrast audit. |
| `experience.md` | The experience contract: no flicker, shift or lag; findable and legible; honest and reversible. |
| `brand.md` | Nilo: identity, style lock, animation language, where she may appear. |
| `adoption.md` | Wiring, drift found in the app, decisions, guardrails and order of work. |
| `components/` | One page per component family (primitives, model picker, composer, run surfaces, Studio, shell), the cross-cutting `patterns.md` and, after the Providers rebuild, `providers.md`: anatomy, states, use and misuse, accessibility, copy (en, with a pt-BR reference) and a real example from the app. Start at `components/README.md`. |
| `audit/screens.md` | The screen-by-screen audit before the redesign and the same measurements after it, with captures in both themes. |
| `audit/providers.md` | The Providers screen audit before its redesign, with captures in both themes at four widths. |

Commands, from the repository root:

```bash
node scripts/design-tokens.mjs --check   # tokens.json <-> globals.css parity
node scripts/design-tokens.mjs --css     # emit CSS custom properties from tokens.json
node scripts/check-contrast.mjs --md     # regenerate the contrast table below
```

OHarness is an everyday agent workspace with a visual Graph Engineering Studio inside it. The interface behaves like a well-made instrument: quiet, warm, precise. Modern-minimal editorial, never the density of an IDE. Read `experience.md` for how it must feel and `adoption.md` for how to wire it into the app.

## Content fundamentals

- Sentence case everywhere. Uppercase only for a one-word `t-label` group name, never in a list.
- Say what is missing and what to do: "Paste an Anthropic key to send", never "Unavailable". Say what happened and what the person can do next: "Couldn't reach the sidecar. Retry, or open Providers."
- Second person, present tense, no exclamation marks. No emoji. The product is **Studio**, **Chats**, **Providers**, **Nilo**, **Export OHM** and **Import OHM**; never "framework", "template", "preset", "sample" or "Copilot".
- Machine data (ids, model names, paths, keys, durations) is set in `t-meta` or `t-code`, never in prose styles.
- Labels name the thing, not the action's mood: "Use in chat", "Export OHM", "Continue editing".

## Visual foundations

- **Substrate.** Default Graphite theme; Ivory is the light theme and the person's choice persists. The window and canvas are `sub-000`; panels, the composer and inputs are `sub-100`; inset fields, secondary buttons and user messages are `sub-200`; hover and pressed use `sub-200` then `sub-300`. `sub-400` is only for scrollbars. Elevation is a value step plus a `line` hairline; add `shadow-soft` to the composer and `shadow-float` to floats and nothing else.
- **Ink.** Reading text uses exactly three levels: `ink-primary` for titles, `ink-dim` for body, `ink-mute` for secondary copy. `ink-faint` is a fourth, quiet level for decorative glyphs and non-essential hints; it does not pass AA on most grounds, so never put anything a person must read in it.
- **Signal.** `signal` (mineral teal) means action, focus and live state, and occupies under 5% of a viewport. Primary button fill is `signal` with `signal-ink` text. Accent-coloured text is for interactive state only, never for eyebrows or decoration.
- **State colour.** `warn` is amber for attention and decisions; `fault` is red for errors. Use them as fill, marker or border. When they are text, use `warn-text` and `fault-text`, and always with a word or icon, never colour alone.
- **Roles.** The seven `role-*` hues mark graph node types on a 8 to 10px square or dot beside the role's name. Never on running text.
- **Type.** Sora for interface, IBM Plex Mono for machine data. Dense tools use `t-body` (12px) and `t-title` (13px); the conversation column uses `t-reading` (14px / 1.6) in a single column no wider than 68ch. One `t-display` per surface.
- **Space.** Four-pixel grid: `space-1` through `space-12`. Panels pad `space-3`; sibling controls sit `space-2` apart; the conversation keeps `space-6` to `space-12` of air.
- **Shape.** `radius-control` on buttons, inputs, kbd and badges; `radius-panel` on panels; `radius-float` on sheets and menus; `radius-composer` on the composer only. No full pills by default, no pill farms.
- **Borders.** A panel edge is `line`. A control edge (input, secondary button, checkbox) is `line-strong`, because a hairline at 1.6:1 does not tell someone where a field ends. Dividers inside a panel are `line-soft`.
- **Focus.** Every interactive element shows a solid 2px `signal` ring with a 2px offset on `:focus-visible`, never removed, never replaced by colour change alone. It holds 3:1 or more on every substrate in both themes (7.5:1 in Graphite, 4.6:1 in Ivory on `sub-000`).
- **Motion.** `duration-fast` (110ms) with `ease-standard` for hover, press and focus; `duration-base` for background and border; `duration-enter` with `ease-enter` for entrances, opacity and an 8px translate only. Never animate layout properties (width, height, top, left, margin). Under `prefers-reduced-motion` everything is instant except the focus ring.
- **Never.** Gradients, purple, neon, glow, decorative motion, pill farms, dense all-caps, fake browser chrome, invented metrics, generic bento dashboards, a drop shadow standing in for a border.

## Iconography and brand

- **Nilo** is the shared pixel sprite and its animation, one identity from the 16px mark to the mascot. Her pose says what the surface is, and Providers and other dense spec-sheet screens carry no mascot. Rules, animation language and assets: read `brand.md`; the sprite and its assets live in `frontend/src/components/brand/` and `brand/`, never a redrawn copy.
- Interface glyphs are single-colour line icons at 14px or 16px, inheriting `currentColor` from `ink-mute`, or `ink-primary` when active. Pair every icon-only button with an `aria-label` and a tooltip.
- Older brand marks are kept in `brand/legacy/` with a `-legacy` suffix; never delete a superseded mark.

## Layout

- Flat set of destinations: **Chats**, **Studio**, **Providers**. Navigation never reshuffles between modes.
- Chats is a **Quiet Desk**: one reading column, one composer, navigation that recedes while work is happening.
- Studio is a **Graph Workshop**: overview of the current draft, then the graph editor with palette, inspector and validation. Back returns to the overview; Continue editing keeps the draft.
- Providers and Harnesses are a **Curated Library**: stronger hierarchy, fewer controls, source and capability labels on every row.
- The header is a 48px strip (`h-titlebar`), the sidebar is `w-rail`, the status strip is `h-statusbar`. Below 640px the rail collapses to 52px and the wordmark hides before document names or actions are squeezed.

## Contrast audit

Generated, not hand-written: `node scripts/check-contrast.mjs --md` computes WCAG 2 relative luminance from the oklch values in both themes and exits non-zero if a required pair fails; `npm test` fails if this table is stale. Ratios are listed per ground in order (`sub-000` first); text needs 4.5:1, control edges, focus rings and meaningful marks need 3:1. Every row is required except those marked "Limit", which record a ground a token is not meant for: the app ships no value that misses the bar. `warn` and `fault` are fills, markers and borders; their text forms are `warn-text` and `fault-text`, text on a fault fill is `fault-ink`, and `signal` as text is `signal-text`. A panel edge (`line`) is decoration and exempt; a control edge is `line-strong`.

<!-- contrast:start -->
| Pair (`foreground` on grounds) | Min | Graphite | Ivory | Verdict |
| --- | --- | --- | --- | --- |
| `ink-primary` on `sub-000`, `sub-100`, `sub-200`, `sub-300` | 4.5:1 | 16.3 / 15.3 / 13.8 / 11.8 | 15.1 / 16.0 / 14.0 / 12.6 | Pass |
| `ink-dim` on `sub-000`, `sub-100`, `sub-200`, `sub-300` | 4.5:1 | 11.0 / 10.3 / 9.3 / 8.0 | 9.1 / 9.6 / 8.4 / 7.6 | Pass |
| `ink-mute` on `sub-000`, `sub-100`, `sub-200`, `sub-300` | 4.5:1 | 7.2 / 6.7 / 6.1 / 5.2 | 6.2 / 6.5 / 5.7 / 5.1 | Pass |
| `ink-faint` on `sub-000`, `sub-100`, `sub-200`, `sub-300` | 4.5:1 | 6.3 / 5.9 / 5.3 / 4.6 | 5.4 / 5.8 / 5.0 / 4.5 | Pass |
| `signal` on `sub-000`, `sub-100` | 4.5:1 | 7.5 / 7.0 | 4.6 / 4.9 | Pass |
| `signal-ink` on `signal` | 4.5:1 | 7.6 | 4.9 | Pass |
| `fault-ink` on `fault` | 4.5:1 | 5.0 | 5.0 | Pass |
| `warn` on `sub-000`, `sub-100` | 3:1 | 5.2 / 4.9 | 3.3 / 3.5 | Pass |
| `warn-text` on `sub-000`, `sub-100`, `sub-200`, `sub-300` | 4.5:1 | 6.3 / 5.9 / 5.4 / 4.6 | 5.5 / 5.8 / 5.1 / 4.6 | Pass |
| `fault-text` on `sub-000`, `sub-100`, `sub-200`, `sub-300` | 4.5:1 | 6.3 / 5.9 / 5.4 / 4.6 | 5.5 / 5.8 / 5.1 / 4.6 | Pass |
| `signal-text` on `sub-000`, `sub-100`, `sub-200`, `sub-300` | 4.5:1 | 7.5 / 7.0 / 6.4 / 5.4 | 5.5 / 5.8 / 5.1 / 4.6 | Pass |
| `line-strong` on `sub-000`, `sub-100`, `sub-200` | 3:1 | 3.8 / 3.5 / 3.2 | 3.6 / 3.8 / 3.3 | Pass |
| `line-strong` on `sub-300` | 3:1 | 2.7 | 3.0 | Limit |
| `signal` on `sub-000`, `sub-100`, `sub-200`, `sub-300` | 3:1 | 7.5 / 7.0 / 6.4 / 5.4 | 4.6 / 4.9 / 4.3 / 3.8 | Pass |
| `fault` on `sub-000`, `sub-100` | 3:1 | 3.6 / 3.4 | 4.7 / 5.0 | Pass |
| `role-agent` on `sub-000`, `sub-100` | 3:1 | 3.7 / 3.4 | 4.7 / 5.0 | Pass |
| `role-gate` on `sub-000`, `sub-100` | 3:1 | 5.0 / 4.7 | 3.5 / 3.7 | Pass |
| `role-hitl` on `sub-000`, `sub-100` | 3:1 | 3.9 / 3.7 | 4.4 / 4.7 | Pass |
| `role-skill` on `sub-000`, `sub-100` | 3:1 | 3.5 / 3.3 | 5.0 / 5.3 | Pass |
| `role-mcp` on `sub-000`, `sub-100` | 3:1 | 3.6 / 3.4 | 4.8 / 5.1 | Pass |
| `role-tool` on `sub-000`, `sub-100` | 3:1 | 3.2 / 3.0 | 5.4 / 5.7 | Pass |
| `role-decision` on `sub-000`, `sub-100` | 3:1 | 3.9 / 3.6 | 4.5 / 4.7 | Pass |
<!-- contrast:end -->

Corrections applied from the first audit (`audit/screens.md`): `ink-faint` to L 0.665 in Graphite and 0.500 in Ivory (4.5:1 on all four substrates), `role-tool` to L 0.50 (3:1 or better on `sub-000` and `sub-100`), and control edges and state text routed through `line-strong`, `warn-text`, `fault-text` and `signal-text`.
