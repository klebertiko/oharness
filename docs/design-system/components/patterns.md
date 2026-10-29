# Patterns

Rules that cut across components. Each pattern names where the app already follows it, so it can be checked against real code, and where it does not yet.

## Empty, error and loading

Every list and panel has all three, designed (`../experience.md`). Each says what is true and what to do next.

| State | What it shows | Component | Example in the app |
| --- | --- | --- | --- |
| **Loading, nothing yet** | A skeleton with the exact size of the content, announced once. | `SkeletonRows` | `StudioOverview` ("Loading your harnesses"). |
| **Loading, content present** | The previous content stays; the region is `aria-busy`. | none: an attribute | The chat log while a turn streams (`role="log"`, `aria-busy`). |
| **Loading, short** | A one-line status in the panel's text style. | plain `role="status"` text | `HarnessSwitch` ("Loading harnesses…", with "No harness" still choosable). |
| **Empty** | A sentence that says what is true, then the one action that changes it. | `EmptyState`, or the panel's own title + line | Threads ("No chats yet. Start one and it shows up here."); Activity ("No activity yet. A chat with the harness on, or a test run in Studio, shows up here."). |
| **Error, recoverable** | What happened, then what to do, with the action beside it. | `Notice tone="fault"` (`role="alert"`) | The plan card when approving fails; the composer when a mode change is refused. |
| **Error, inline** | The reason in the row it belongs to, in `fault-text`. | text with `role="alert"` | A refused revert in the turn diff; a failed subagent cancel. |
| **Blocked** | The control stays visible, says why in place and offers the fix. Disabled is explained. | `Notice tone="warn"` or a tooltip plus a line | An unavailable harness blocks sending and offers "Continue without a harness". |

**Copy for errors.** Two short sentences: what happened, what the person can do. "Couldn't reach the activity log" followed by the panel's retry, not "Error 500". Never blame, never an exclamation mark, never a raw exception text as the only message (the exception can follow in `t-code`).

**Gaps found.** The Activity panel loads with plain text where a skeleton would reserve the rows (audit D6 follow-up); `ui/Input` has one consumer outside the catalogue (the chat search), so hand-made field classes exist in at least six places (Inspector, hooks form, token ceiling, chat rename, tool decision note, search); fold them into `Input` as screens are touched.

## One action per state

A surface offers **one primary** for the state it is in, and the state decides which one. Everything else is secondary or ghost.

| Surface | State | The one action |
| --- | --- | --- |
| Composer | something can answer | Send |
| Composer | a turn is running | Queue (Stop is an icon button, not a competing primary) |
| Composer | nothing can answer | the fix for the nearest connection (Turn on, Paste an Anthropic key, Copy `ollama serve` …) |
| Plan card | a plan awaits | Approve plan |
| Tool card | waiting for approval | Approve |
| Human gate | the run is blocked | Approve & continue |
| Transport bar | idle / parked / running | Run / Step / Stop |
| Studio overview | no draft / draft open | Draft with Nilo / Continue editing |
| Proposal card | pending / applied | Apply {n} changes / Keep |
| Queue | paused | Send next |

The same fix has **the same words everywhere** (ADR 0016): the label of `nextStep` is the text in the Providers list, the dossier, the model picker and the composer.

## Destructive and trust-raising actions

Prefer undo to a dialog. Where a dialog is right, it is inline, names the act on its button, and **Cancel has the focus**: "Use Full" / Cancel, "Trust" / Cancel, "Delete harness", "Confirm delete". Raising what the machine may do on its own (Full, trusting a workspace, registering a hook) is always a deliberate step, never reachable by a cycle key or a default.

## Density

Two registers, set by the surface, not by the person's mood:

- **Reading** (Chats, the Studio describe box): `t-reading` 14/1.6, one column of 60 to 68ch, `space-6` to `space-12` of air, `control-lg` buttons.
- **Working** (Studio canvas and inspector, run surfaces, lists): `t-body` 12 and `t-title` 13, `control-sm`/`control-md`, panels padded `space-3`, siblings `space-2` apart, one `t-label` group name at most per panel.

Rules in both: machine data (ids, models, paths, keys, durations, argv) is `t-meta` or `t-code`, never prose; numbers that update are tabular; targets are 24px on desktop and 36px below 640px; a row never carries more than one state signal.

## Motion

- Hover, press and focus: `duration-fast` (110ms) with `ease-standard`, on `background-color` and `border-color` only.
- Entrances (sheets, the welcome block, cards appearing): `duration-enter` (420ms) with `ease-enter`, opacity and an 8px translate only.
- Never width, height, top, left, margin or a shadow blur. Collapsing animates `opacity` and `transform`.
- Live state is a travelling tick or a step, not a pulse: a running plate gets a 1px sweep, a live wire a dash march, a probe in progress a dot that pulses (the only pulse, and only while the probe runs).
- **Reduced motion**: `prefers-reduced-motion: reduce` makes every animation and transition instant (the global reset in `globals.css`), `Skeleton` and the Button spinner stop (`motion-reduce:animate-none`), Nilo shows one still pose per state, and the canvas camera jumps. Nothing relies on motion to convey state: every animated marker has a word beside it.

## i18n and copy

- The interface is **English only today**. `frontend/src/design-system/guardrails.test.ts` fails on accented characters in source, so a Portuguese string cannot slip into a component by accident. When a locale lands, strings move to a catalogue; until then, the docs in this folder give a **pt-BR translation reference** next to each string so tone and length are already checked: pt-BR is usually longer than English, so no control may depend on a label's exact width (use truncation with a tooltip, as the model chip does, and `min-w-0`).
- Names that are part of the product do not translate: **Studio**, **Chats**, **Providers**, **Nilo**, **Export OHM** / **Import OHM**, the permission mode names, `.ohm`. Never "framework", "template", "sample" or "preset" for a harness, and never "Copilot" (the permission modes may be called presets: they are a fixed table).
- Sentence case. Second person, present tense, no exclamation marks, no emoji. Say what is missing and what to do. Machine strings (model ids, paths, commands) are never translated and sit in `t-meta` or `t-code`.
- Dates and durations come from one formatter each (`formatRelativeTime`, `clock`), so a locale changes one place. Numbers in mono and tabular digits.
- pt-BR microcopy conventions used in this folder: "você" (not "tu"), infinitive for buttons ("Aprovar plano", "Descartar plano"), "provider" stays in English as the product term, "chat" and "harness" likewise.

## Status is never colour alone

A state is a word or a shape plus a colour. `Badge` always carries a word. `warn` and `fault` as text use `warn-text` and `fault-text` and sit beside an icon or label. The six connection tones differ in shape as well as colour (filled, hollow ring, pulsing). Run markers differ in shape (diamond, filled square, hollow square, dashed square). The guardrail test fails a raw `text-warn`, `text-fault` or `text-signal` class.
