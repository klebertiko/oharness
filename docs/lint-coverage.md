# Lint coverage after the ESLint → Biome migration

Tracks the rules lost in the migration (#119) and what replaced them (#153). Config: `frontend/biome.json`; GritQL plugins: `frontend/lint/*.grit`; regression tests: `frontend/lint/lint-rules.test.ts`.

## ESLint / Next rules

| ESLint rule | Status | Replacement |
| --- | --- | --- |
| `react/no-unescaped-entities` | Covered | GritQL `no-unescaped-entities.grit` (`'` and `"` in JSX text). Biome's parser already rejects bare `>` and `}`. |
| `no-unused-expressions` | Covered | `suspicious/noUnusedExpressions` |
| `@typescript-eslint/no-require-imports` | Covered | `style/noCommonJs` |
| `@typescript-eslint/no-namespace` | Covered | `style/noNamespace` |
| `import/no-anonymous-default-export` | Covered | GritQL `no-anonymous-default-export.grit` (function, generator, async, class, arrow). |
| `@next/next/no-sync-scripts` | Covered, one justified exception | `performance/noSyncScripts`. The theme script in `src/app/layout.tsx` is blocking on purpose (the theme must be known before first paint; `async`/`defer` would flash the wrong theme), so it carries a scoped `biome-ignore`. |
| `@typescript-eslint/ban-ts-comment` | Partly covered | `@ts-ignore` is banned by `suspicious/noTsIgnore`. **Not covered:** `@ts-expect-error` without a description. Biome's GritQL cannot match comments. Decision: accept; `@ts-expect-error` fails the build once the error disappears, and descriptions are checked in review. |

## Accessibility rules re-enabled

`a11y/noStaticElementInteractions` and `a11y/useFocusableInteractive` are on again. The remaining hits are justified `biome-ignore`s at the call site:

- `CommandPalette` and `Combobox` options: ARIA combobox pattern. Focus stays on the input/trigger and `aria-activedescendant` names the active option; making options focusable would take focus off the input.
- `Combobox` popover container: delegates `keydown`/`blur` from the focusable controls inside it; it is not a control.
- `HarnessCanvas` stage: drop target for palette drags; nodes can also be added by click and from the command palette.
- `HarnessWire` label and `BaseNode`: hover only highlights/reveals the toolbar; selection and focus belong to React Flow, and a selected node shows the toolbar too.

## Other

- `useExhaustiveDependencies` ignores: each one sits directly on a single hook call (`useEffect`, `useLayoutEffect` or `useMemo`) and states why; none spans more than that hook.
- `Badge` `role` prop keeps `biome-ignore lint/a11y/useValidAriaRole`: it is a harness role token, not ARIA. Renaming is a design-system decision.
