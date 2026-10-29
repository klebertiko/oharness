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
- Live state is a travelling tick or a step, not a pulse: a running plate gets a 1px sweep, a live wire a dash march, the only pulses are a probe or run step in progress (`StatusMark` `busy`, the picker's `checking` dot, a live step), and `Skeleton`, all of which stop under reduced motion.
- **Reduced motion**: `prefers-reduced-motion: reduce` makes every animation and transition instant (the global reset in `globals.css`), `Skeleton` and the Button spinner stop (`motion-reduce:animate-none`), Nilo shows one still pose per state, and the canvas camera jumps. Nothing relies on motion to convey state: every animated marker has a word beside it.

## i18n and copy

- **Two catalogues.** `frontend/src/i18n/` holds `messages.en.ts` (the source) and `messages.pt-BR.ts`, typed with the same keys, so a missing key is a type error; `translate(locale, key, vars)` fills `{name}` and falls back to English, never to the key (ADR 0034). The locale is the saved choice, else the browser's first language (any `pt` is `pt-BR`), else `en`; it starts as `en` on the server and the first render so static HTML and hydration agree. The switch is a command in the palette ("Language: Português (Brasil)" / "Language: English"); there is no settings screen for it.
- **Coverage today.** Only the Providers vocabulary and the state words and fix labels it shares (`rowStatus`, `chatProviderStatus`, `nextStep`) are translated, so the list, the model picker and the composer say the same thing in each language (ADR 0016). Chats, Studio and the palette are still English, so in pt-BR the interface is mixed until another delivery; this is the most visible limit of the layer.
- **Where Portuguese may live.** The guardrail test now fails accented characters outside `src/i18n`: Portuguese text is only ever in the catalogue, never loose in a component. Commands, ids, model names and machine labels never pass through a catalogue (a test checks that the text between backticks is identical in both languages).
- **This folder.** The component pages give a **pt-BR reference** next to each string for the parts not yet in a catalogue, so tone and length are already checked: pt-BR is usually longer than English, so no control may depend on a label's exact width (truncate with a tooltip, as the model chip does, and keep `min-w-0`). When a string moves into the catalogue, the catalogue wins.
- Names that are part of the product do not translate: **Studio**, **Chats**, **Providers**, **Nilo**, **Export OHM** / **Import OHM**, the permission mode names, `.ohm`. Never "framework", "template", "sample" or "preset" for a harness, and never "Copilot" (the permission modes may be called presets: they are a fixed table).
- Sentence case. Second person, present tense, no exclamation marks, no emoji. Say what is missing and what to do. Machine strings (model ids, paths, commands) sit in `t-meta` or `t-code`.
- No plural forms in the catalogue yet: write the sentence so it needs none ("Models: 3"), or use `Intl.PluralRules` when a case appears. Dates and numbers use the browser's formatting, not the chosen locale (ADR 0034 limit).
- pt-BR conventions: "você" (not "tu"), infinitive for buttons ("Aprovar plano", "Descartar plano"), "provider", "chat" and "harness" stay in English as product terms.

## Status is never colour alone

A state is a word or a shape plus a colour. `Badge` always carries a word. `warn` and `fault` as text use `warn-text` and `fault-text` and sit beside an icon or label. The word beside a state marker carries the meaning; the connection tones add shape only where they can (hollow ring for not connected, pulsing for checking), so the filled ones (verified, not verified, needs attention, unavailable) rely on the word. Run markers differ in shape (diamond, filled square, hollow square, dashed square). The guardrail test fails a raw `text-warn`, `text-fault` or `text-signal` class.
