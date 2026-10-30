# Model picker

The chat's answer to one question: **which connection and which model answers this chat?** It is the shared `Combobox` configured in `agent/ChatProviderPicker.tsx`, its option builder `agent/chatCombo.ts`, and the readiness rules in `agent/chatProvider.ts`. Decisions: ADR 0013 (probe details), 0014 (model scope), 0015 (model list shape), 0016 (Needs action). Connections are fixed in Providers, never here (`../../../design.md` § Provider stance): the picker lists what can answer now and links to the one place to fix the rest.

## Combobox

**Purpose.** The one picker every provider, model, harness and folder choice uses, so all of them behave alike.

**Anatomy.** A trigger `<button aria-haspopup="listbox">` and a popover portalled to `document.body`: an optional `header` line, the search input (when `searchable`), a `panel` slot, the `role="listbox"` of options in groups, and a `footer`. An option has a `label`, an optional `detail`, a `leading` mark (a tone dot), a `trailing` slot and may be `disabled`. The popover is `radius-float`, `line` edge, `shadow-float` (class `oh-float`), 340px wide in the chat, clamped to the viewport, opened on the side with more room and re-measured on resize and scroll rather than closed.

**States.** closed, open, searching (a typed query), `status`: `loading` (`loadingText`), `error` (`errorText`), ready with no match (`emptyText`), disabled. A typed value with no exact match can be offered as a choice (`allowCustom`, used by the picker as `Use “name”`).

**Keyboard.** Enter or the arrows open it; the arrows move (`aria-activedescendant` on the search field, or on the listbox when there is no search); Enter chooses; **Shift+Enter** passes `meta.shift` to `onChange`; Escape closes and returns focus to the trigger (an inner panel can consume Escape first through `onEscape`); Tab leaves. A press or focus inside a popover opened from this one does not close it (`data-combobox-popover`).

**Accessibility.** The trigger's accessible name includes the current value ("Chat provider: Anthropic · claude-… · Verified"); the list is named by `label`; groups carry their heading; loading is announced as a status.

**Don't.** Build a second dropdown; put a form inside the popover (the picker hands setup over to Providers); more than one `keepOpen` behaviour.

## The model picker in the chat

**Anatomy.**
1. **Trigger chip**: a 6px tone dot, then `{connection} · {model}`, truncated, `max-w-[260px]`, `control-md` high. With Auto it reads `Auto → {connection} · {model}`; with nothing usable, `Auto · No available provider`.
2. **Header line**: with nothing ready, "No provider is ready to answer. Set one up in Providers."; otherwise "Enter sets the default for new chats. Shift+Enter applies to this chat only. Agents with a pinned connection use their own provider."
3. **Scope toggle** (`panel`): a two-option radio group, "Connection default" and "This chat only". It sets what a pick applies to; Shift flips it for one pick (touch has no Shift). While a harness runs the turn the toggle is replaced by one line, "A running harness uses its own models. A pick here sets the connection default.", because a model pinned to the chat alone would change nothing.
4. **Search**: "Find a model". Matching is on the model name the person reads, never the option id; each group is capped and says how many are hidden ("12 more. Type to search."). A model the list does not carry can be typed and sent as typed ("Not in the list. Sent as typed.").
5. **Groups**: Auto first (it names where it lands), then one group per **usable connection** holding its models, the model in effect first. Two connections with the same name get "(2)". A connection with no model list is a single row.
6. **Needs action** group (below): connections that cannot answer yet.
7. **Footer**: "Manage providers" with, on the right, "{n} needs setup" or "{n} need setup".

**Models and scope.** Choosing a model with **Enter** saves the connection's default (used by new chats and by chats that follow the default; any pin of this chat on that connection is removed once the save took). **Shift+Enter** or the "This chat only" scope pins the model to this conversation (`chatModelStore`, persisted per thread, pruned when a thread is deleted). The chip then ends with "· this conversation only" in its status line.

**Use.** One picker per composer. Show the model in effect on screen before anything is typed.

**Don't.** List a connection that cannot answer among the usable ones; show a model list for a harness-run turn as if it applied; repeat the setup form that Providers owns.

**Copy.** Find a model / Buscar um modelo · Connection default / Padrão da conexão · This chat only / Só este chat · Manage providers / Gerenciar providers · {n} needs setup / {n} precisa de configuração · No provider is ready to answer. Set one up in Providers. / Nenhum provider está pronto para responder. Configure um em Providers.

## Connection states

One rule decides how a connection reads on every surface (`providerReadiness`, `rowStatus`, `rowTone`): the picker, the Providers list, the Studio node summary. Never re-derive it.

| Tone | Dot (`toneDotClass`) | Status word | Meaning |
| --- | --- | --- | --- |
| `verified` | filled `signal` | Verified | Enabled and the last probe said live. |
| `unverified` | filled `ink-faint` | Not verified | Enabled, no probe result yet (CLI waiting on setup). |
| `checking` | `ink-faint`, pulsing | Checking connection | A probe is running. |
| `attention` | filled `warn` | Needs attention, No model chosen, Model not pulled | Works, or nearly, but one thing needs a person. |
| `failing` | filled `fault` | Unavailable | A probe failed: a credential was tried and rejected, or the host is unreachable. |
| `unconfigured` | hollow ring, `ink-faint` edge | Not connected | Not turned on or no credential yet. |

`failing` and `unconfigured` are deliberately different shapes: a credential that was tried and rejected must never look like a connection nobody has set up. The dot is 6px and sits beside the word, never replaces it. Pulse stops under reduced motion.

**Model not pulled** (ADR 0013). A local model server (Ollama) that lists models but not the chosen one reads "Model not pulled" with the `attention` dot, and the next step is a copy action, **Copy `ollama pull {model}`**. It is listed under the connection (picking a model is how it becomes ready), not under Needs action.

**Fault classes.** The probe's detail maps to one of seven classes (key rejected, unreachable, rate limited, out of credits, CLI sign-in, CLI missing, unknown), each with one action and its own status word ("Key rejected", "Unreachable", "Rate limited", "Out of credits", "Sign-in needed", "Not installed", "Test failed"). A class the text does not match is `unknown`, never a guess at a nearby one.

## Needs action

**Purpose.** Show, inside the picker, the connections one step from working, so the fix is one click away and the words are the same everywhere (ADR 0016).

**Anatomy.** A group titled "Needs action", at most three rows, nearest to ready first (0 choose a model, 1 turn on, 2 fix a failure, 3 get something: install the CLI, get a key). Each row is `{connection}` with the detail `{status} · {action}`. A disabled last row counts the rest: "{n} more need setup. Open Manage providers."

**Behaviour.** Choosing a row **does not select** it: it opens that connection in Providers, where the form and "Test again" live. The picker never carries a setup form.

**One action, one text.** The label of `nextStep` (Turn on, Replace key, Copy `ollama serve`, Open billing, Paste an Anthropic key, Choose a model, Test again, Check endpoint, Open install guide) is the text in the Providers list, the dossier, this group and the composer button. Where the row has no room for the connection's name (the composer), the text takes " · {connection}" unless the label already names it.

**Copy.** Turn on / Ligar · Replace key / Substituir chave · Open billing / Abrir cobrança · Paste an Anthropic key / Cole uma chave da Anthropic · Test again / Testar de novo.

## Composer call to action

**Purpose.** When nothing can answer, the composer's send area becomes the single action that fixes it (ADR 0016).

**Anatomy.** A ghost `sm` button in the composer toolbar, in `signal-text`, up to 240px wide and truncated; it takes the place of the "Ctrl Enter to send" hint and is hidden below 640px, where the disabled Send button carries the same text as its `title`. On the chat home the same words are the link under the greeting, with "Connect a provider to send" as the fallback when no connection exists at all.

**Behaviour.** With Auto and nothing ready, the action of the connection nearest to ready; with an explicit choice, that connection's action. It does what the label says when no form is needed (copy the command, open the billing or install page) and otherwise opens the connection in Providers. When something can answer, the hint and a working Send are back and the CTA is gone.

**Don't.** Show "Connect a provider to send" when a connection is one step away; show two buttons.

**In the app.** `agent/AgentStage.tsx` (the `missing` action), `providers/composerAction.ts`.
