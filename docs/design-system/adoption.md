# Adoption

How the app reaches this system without a rewrite. Counts below were measured on 2026-10-22 at commit `4a91a2d` (main with #140, before any visual change) with `git grep -o -h -E '<pattern>' 4a91a2d -- frontend/src | wc -l`, test files included, not estimated. After the screens redesign the same patterns give zero outside tests, enforced by `frontend/src/design-system/guardrails.test.ts`.

## Principle

First the tokens mirror exactly what the code does today: parity, zero visual change, proved by `npm test`. After that, each correction that changes pixels goes in its own pull request labelled **visual change**, with before and after in both themes, so the change is seen at merge.

## Wiring

- `frontend/src/app/globals.css` stays the runtime source of the variables until the Tailwind 4 `@theme` migration (#120) lands. `docs/design-system/tokens.json` is the spec it must match, name for name: `scripts/design-tokens.mjs --check` fails on any value that differs, any variable `globals.css` declares that no token maps to, and any theme override the tokens do not describe. After #120, update the `css` mapping in the tokens (and the parser's block selectors) to the `@theme` names; the contract does not change.
- `tokens.json` marks every token with a status: `code` (mirrors a variable in `globals.css`), `hardcoded` (the value lives in a component, no variable yet), `tailwind` (comes from the Tailwind scale) or `proposed` (new, not yet in the app).
- Components live in `frontend/src/components/ui/` (Button, Input, Badge, Kbd, Panel, ListRow, Notice, EmptyState, Skeleton, Segmented, Sheet, plus the existing Combobox), tested with vitest and axe, and shown at `/dev/design-system`. The reference implementation in `docs/design-system/reference/` remains the specification. The screens redesign (`audit/screens.md`) adopted them across every destination, including `agent/`, `providers/` and `agent-run/`; only presentation changed in those modules, not their stores, hooks or reducers, so their owners should review the diff for that boundary.

## Drift found in the app

| Finding | Where | Decision |
| --- | --- | --- |
| ~~Fonts are named but never loaded~~ | `globals.css` `--font-ui`, `--font-mono` | **Done** in `frontend/src/app/fonts.ts`: Sora 400/500/600 and IBM Plex Mono 400/500 self-hosted with `next/font/local` (woff2, `latin` subset, SIL OFL 1.1 licences beside the files), `font-display: swap`, fallback with generated `size-adjust` and `ascent-override`. `latin-ext` is not shipped: `next/font/local` has no `unicode-range`, so a second file would load on every page. Revisit when a locale needs it. |
| `design.md` said cards 10px and controls 7px; code ships 4, 6 and 8 | `design.md` vs `--r-*` | Code is v1; `design.md` now states the code's radii. "Radii 10 and 7" stays an open decision for a future visual comparison. Do not change radius on your own. |
| Hardcoded radii 12, 14 and 18px | composer, prompt card, Studio welcome | Tokens `radius-composer` (14) and `radius-hero` (18) record them; fold or justify later. |
| 89 uses of `text-[12px]`, 48 of `text-[11px]`, 33 of `text-[13px]`, 3 of `text-[15px]`, 4 of `text-[14px]` | across `src` | 12 is `t-body`, 13 is `t-title`. `t-meta` is 11px in the target (fractional sizes blur and differ by DPI); the code ships 10.5px today, so the change belongs in the typography visual-change pull request. |
| 26 uses of `rounded-[1px]` and 5 of `rounded-[2px]` | across `src` | Off the scale. Use `radius-control` or none, in a visual-change pull request. |
| Four ink levels in code, three in `design.md` | `--ink-*` | `ink-faint` stays for decoration only; reading text uses three. |
| Raw hex in one file | `src/app/dev/v/[slot]/page.tsx` | Dev route; replace with tokens or exclude. |
| Known contrast defects | `ink-faint`, `line` as a control edge, `warn` and `fault` as text, `signal` as text in Ivory on `sub-200`, `role-tool` on Graphite | Measured in the README. `warn-text`, `fault-text` and `signal-text` meet 4.5:1 on all four substrates; `line-strong` meets 3:1 on `sub-000` to `sub-200`, the grounds a control sits on (on `sub-300`, the pressed ground, it measures 2.74 in Graphite and 2.97 in Ivory); `ink-faint` and `role-tool` need new values. Done in the screens redesign. |

## Guardrails

- **Parity test.** `frontend/src/design-system/tokens.test.ts` runs `scripts/design-tokens.mjs --check` and checks the README contrast table is current. It only reads `globals.css`; it never writes it.
- **Contrast.** `scripts/check-contrast.mjs` exits non-zero when a required pair falls below 4.5:1 (text) or 3:1 (control edges, focus rings, marks) in either theme.
- **Lint (later).** Forbid arbitrary Tailwind values for colour, radius and font size (`text-[…]`, `rounded-[…]`, `bg-[#…]`), with an allow-list for layout.
- **Visual (later).** A catalogue page per component state in both themes, with Playwright snapshots.
- **Review.** A change to a token is a change to `tokens.json` first, then `globals.css`, in one pull request.

## Status and next steps

Done: tokens in DTCG format, the brand book, the experience contract, the Nilo rulebook, parity and contrast checks (no known defects left), self-hosted fonts, theme before paint, the corrected and new tokens in `globals.css`, the `ui/` components with tests, the guardrail test, and the redesign of every destination (`audit/screens.md`, with before and after captures in both themes).

After the roadmap (2026-10-29): `audit/components.md` inventories every component and pattern the app gained and the deviations found; one token was added (`edge-selected`, ADR 0037).

Still open:

1. The Tailwind 4 `@theme` migration (#120) and Biome (#119): done. The type scale, spacing, radii and colours now live in the `@theme` block of `globals.css`, and `scripts/design-tokens.mjs` checks the `.t-*` roles against `--text-*` there.
2. `latin-ext` for the two faces, when a locale needs it.
3. Playwright pixel snapshots of `/dev/design-system` in both themes.
4. ~~Decide whether the Providers screen should open on the first provider rather than OpenRouter.~~ Done in ADR 0035: with nothing picked, `selectedId` is empty and the screen opens the connection nearest to answering.
5. Open decision kept from before: radius 10 and 7 against the shipped 4, 6 and 8.
