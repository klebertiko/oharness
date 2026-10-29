# Components and patterns

How each piece of the interface is built and used. The tokens (`../tokens.json`) are the vocabulary, the brand book (`../README.md`) and the experience contract (`../experience.md`) are the rules; these files say how the rules land in each component, with the real example in the app that proves it. `../audit/components.md` is the inventory that lists every piece, where its code lives and which file below describes it.

| File | Covers |
| --- | --- |
| [`primitives.md`](./primitives.md) | Button, Input, Badge, Kbd, Panel, ListRow, Notice, EmptyState, Skeleton, Segmented, Sheet (everything in `frontend/src/components/ui/` but the Combobox). |
| [`model-picker.md`](./model-picker.md) | Combobox, the model picker grouped by connection with search, the `{connection} · {model}` chip, the "Needs action" group, connection states, "Model not pulled", the per-chat model scope. |
| [`composer.md`](./composer.md) | The chat composer: slash commands, permission presets and Plan mode, the plan card, the message queue, the harness switch, the workspace chip, subagents, tool hooks, the token ceiling. |
| [`run-surfaces.md`](./run-surfaces.md) | The transcript, tool and approval cards, the human gate, the transport bar and run ladder, the Runs panel and resume, the subagent tree, the turn diff, the thinking status. |
| [`studio.md`](./studio.md) | Studio overview, actions bar, canvas, node plates, viewport dock, graph audit, ValidateDock, inspector and field assist, the agentic panel (Nilo) with proposals, the harness library. |
| [`shell.md`](./shell.md) | Title bar, rail, status bar, split handle, command palette, keymap sheet, threads sidebar, the two Panel and ListRow implementations. |
| [`patterns.md`](./patterns.md) | Cross-cutting patterns: empty, error and loading states, one action per state, density, motion, i18n and copy. |
| [`providers.md`](./providers.md) | The Providers destination after its rebuild (ADRs 0033 to 0036): layout, list, connection header, panels, spend, states, accessibility. |

## How each component is described

1. **Purpose**: what question it answers for the person.
2. **Anatomy**: the parts, with the tokens that style them.
3. **States and variants**: every state the code can reach, and which variant to pick.
4. **Use and misuse**: when it is the right piece, and what to reach for instead.
5. **Accessibility**: keyboard, focus, ARIA and reduced motion.
6. **Copy**: the strings as shipped (English) with a pt-BR translation reference. The interface has `en` and `pt-BR` catalogues, but only the Providers vocabulary is translated so far (`patterns.md` § i18n); for everything else the pt-BR here is the reference for when it moves into the catalogue.
7. **Example**: a real use in the app, by file.

A new component or pattern enters the app with its row in `../audit/components.md` and its section here, in the same pull request.

The runnable counterpart is `../reference/`: the primitives plus `Notice`, `EmptyState`, `Segmented`, `StatusMark`, `ConfirmInline`, `Skeleton` and `Popover`, and three pattern previews (`ModelPicker`, `Composer`, `RunSurfaces`) that show the states these pages describe, in both themes (`?theme=dark|light`).
