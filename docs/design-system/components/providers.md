# Providers

The destination where connections are set up and fixed, rebuilt in ADRs 0033 to 0035 from the audit in `../audit/providers.md`. Code: `frontend/src/components/providers/*` (`ProvidersScreen`, `ConnectionList`, `ConnectionDetail`, `ConnectionPanel`, `ModelsPanel`, `ActivityPanel`, `SpendCard`, `ModelPicker`, `view.ts`, `rows.tsx`). It is a **Curated Library** (`../README.md` § Layout): stronger hierarchy, fewer controls, a status word and one action per connection, no mascot.

**The words are the chat's words.** Readiness (`providerReadiness`), the status word and the one fix (`nextStep`) are the same functions the model picker and the composer use (ADRs 0013 to 0016), so a connection never reads two ways. They go through the `en` and `pt-BR` catalogue (ADR 0034). This is what keeps `model-picker.md` and this page in step.

## Layout (ADR 0035)

**The screen owns the stage.** There is no left panel for this destination. `ProvidersScreen` is a container (`@container`): the **list** (20rem, `sub-000`, a `line-soft` right edge) beside the **connection** when the stage is 42rem or wider (`@2xl`); below that, one pane at a time, with a **Back** ghost button ("Providers") at the top of the connection. The pane follows the stage's width, not the window's, because the shell still takes 220px from the stage. The list never hides behind a combobox: on a phone it *is* the screen.

**What opens.** `selectedId` is empty until a person picks one. With nothing picked, the open connection is the one **nearest to answering** (the order of ADR 0016), then the first; it is chosen once the sidecar has answered and held, so a connection that turns ready while you work on it does not swap the pane. Opening a connection from the chat (a Needs action row, the composer's call to action) lands directly on it.

**Headings.** A visually hidden `h1` ("Providers"), the list's `h2` ("Connections"), one `h3` per list group ("Needs action", "Ready", "Agents only"; the single offline group's is visually hidden), the connection's `h2` (`t-display`), and one `h3` per panel (`Panel level={3}`).

## Connection list

**Purpose.** What can I use, and what needs me?

**Anatomy.** A header ("Connections" and, when known, "{ready} of {total} ready"), then groups, then the **spend card** pinned at the foot. Groups: **Needs action** (nearest to ready on top), **Ready**, **Agents only** (CLIs an LLM node cannot use). Offline collapses to one group with no claim about state. Each row is a `ui/ListRow` of about 48px: a `StatusMark`, the connection name, a second line with the **status word** in its text colour and, after a dot, the short form of the fix ("add key", "turn on", "start Ollama"), and on the right where it runs ("Local" or "Cloud"). The open row carries `edge-selected` and `aria-current`.

**States.**
| State | What the list shows |
| --- | --- |
| Loading | Six `Skeleton` rows at row height inside a `role="status"` "Loading connections"; `aria-busy`. Never the offline template posing as data. |
| Nothing ready | An info `Notice`, "Nothing is connected yet. Pick a provider and add what it needs. Ollama runs on this device and needs no key." |
| Offline | One group; every row says **Can't check**, never "Not connected". |
| Normal | The three groups; empty groups are not drawn. |

**Don't.** Show a count that is not measured; colour a row; add a per-row action (the one action lives in the connection's header).

**Copy.** Needs action / Precisa de ação · Ready / Prontas · Agents only / Só para agentes · {ready} of {total} ready · Can't check / Não dá para verificar.

## Connection header

**Purpose.** Who it is, whether it answers, and the one thing to do next.

**Anatomy.** A grey two-letter **monogram** tile (deliberately not a logo or a brand colour: chroma means state, and five vendor hues would turn the list into a rainbow; a verified connection only deepens the tile's hairline), the name in `t-display`, the **status** (`StatusMark` + one word, `aria-live="polite"`), the last test's sentence (the store's detail without the status word it repeated), and a quiet line for where it runs and how it bills. On the right, **one primary** button: the `nextStep` label (Turn on, Replace key, Copy `ollama serve`, Open billing, Choose a model, Test again …), with **Test** or **Test again** as a secondary when testing makes sense.

**One primary rule.** When what is missing is a **key**, the key field in the Connection panel *is* the action and the header carries no primary: the old screen had a header button that scrolled to a field and a second "Store" primary, two primaries in one viewport (audit U4). A copy action reads "Copied" for a moment after it runs.

**States.** loading (a three-block skeleton with the final heights), testing (the Test button is `loading`, a polite "Testing the connection…"), classified failure (status word and sentence from the probe class: Key rejected, Unreachable, Rate limited, Out of credits, Sign-in needed, Not installed, Test failed), Model not pulled, needs action, connected, offline ("Couldn't check this connection." and, under it, "Key, endpoint, models and activity show here once the sidecar answers.").

## Panels

Reading order: **Connection**, **Models**, **Activity**, **About**. Each is a `ui/Panel` (`level={3}`) whose rows are a `dl` of **Row**s: a label, a value, an optional action. A Row is three columns (8rem label, value, action) when the pane is wide and stacks when it is not (container query on the pane).

### Connection

- **Key** (API-key vendors): none set, a field (placeholder "Paste your key", or the vendor prefix), "Stored in the {vault}, then never shown again, including to you.", a `warn` line when the pasted value does not start with the vendor's prefix ("{vendor} keys begin {prefix}. This one doesn't. Check it isn't from another vendor.") and **Save key**; set, the credential is shown only as a **redaction** (prefix, a drawn bar and a "{n} characters withheld" label) plus where it is kept and when it was added ("In the OS keychain · added …"), with **Replace** and **Remove**. In a browser build, where there is no OS keychain, a `warn-text` line says the key lives in memory for this session.
- **Sign-in** (CLI vendors): the account the CLI reported, or where to run the login, in mono.
- **Key not needed** (Ollama): "No key needed", with the honest note that the local daemon is unauthenticated.
- **Endpoint**: editable for the vendors that allow it, with save state ("Saving…", "Saved", "Couldn't save. Still using {current}."), fixed otherwise ("Set by the vendor.").
- **In use**: On or Off with a Turn on or Turn off button and a note ("Chats and runs can use it" / "skip it").

**Remove key is confirmed in the row** with `ConfirmInline`: "Remove the saved {vendor} key? Runs on this connection stop until you add another." with **Cancel** focused and a button named **Remove key**. No dialog.

**Credential rules (unchanged by the redesign).** The screen never renders a credential; `secretRef` stays opaque; the pasted value lives in an uncontrolled field and is never echoed in an error.

### Models

**Purpose.** Choose the one model setting a run reads: the connection's default (a node's own pin wins; ADR 0015).

**Anatomy.** A **Default model** row with the `ModelPicker` (a `Combobox`, searchable, custom names allowed, "Not in the list" detail for a saved value the list no longer has), the rule in words ("Required: this connection refuses a run without one. An agent can pin its own." or "Runs use it unless an agent pins its own. Leave the CLI default to let the CLI decide."), and a polite save line (Saving…, "Saved. Runs use {model}.", or `fault-text` "Couldn't save"). Below it, the source of the list and a **capped, searchable list**: 8 rows without a filter, more with one, "{n} more. Refine the filter to see them."; the filter appears past 8 models. Each row is a mono id and detail, with a **default** `Badge` on the chosen one and **Use** on the others (`aria-label` "Use {model} as the default").

**States.** empty ("Nothing listed yet. Test the connection to load what it serves."), local with nothing pulled ("No models are pulled on this machine. Run `ollama pull llama3.2` in a terminal, then test again."), **Model not pulled** (a `warn` `Notice`: "{model} isn't pulled on this machine. Copy the pull command, run it in a terminal, then test again."), no match ("No model matches “{query}”."). **Agent-only** connections replace the panel with a hand-off panel: two cards (cloud, local) with the command and one sentence each.

### Activity

Measured values only. **Reachability** (the probe trace and a median in ms, "Tests answered: {ok} of {total}", when it was last tested, or "Not tested yet"), the vendor's own facts from the last test, **Tokens** and **Spent** for this connection ("An estimate, not an invoice."), and a `warn` `Notice` when some usage was billed at an unknown rate ("Unpriced usage … may understate what you spent."). No usage reads "—" and "No usage recorded yet.", never a made-up zero.

### About

The vendor's summary, where it runs (this device or the cloud), and a caveat `Notice` for the vendor-specific limit (for Anthropic: "Tool execution is disabled on every call: this connection answers chat, it does not run commands or touch files."). Commands in these sentences are set in mono (`WithCode` splits on backticks, so a command is machine data, never prose).

## Spend card

**Purpose.** The one fact on this screen that is not about a single connection: the global spend and budget. It sits under the list, one line, with the editor one click away.

**Anatomy.** A `section` named "Spend": "{amount} estimated" or "Cost unknown", the budget state with a `StatusMark` (unset, ok, warning, over), **Refresh**, and a budget field in USD ("Global budget in USD", "No limit") with **Save**. A failed usage call says "Usage may be out of date. Refresh to try again.", never the raw response.

**States.** loading, refreshing, budget unset ("No budget. Set one"), budget set ("of {limit} budget"), invalid entry ("Enter zero or a positive USD amount."), save failed ("Couldn't save the budget. Your entry is kept; try again.").

## Screen states

| State | Behaviour |
| --- | --- |
| Loading | List skeleton and a three-block detail skeleton with final heights; nothing says "Not connected" yet. |
| Offline (sidecar down) | A `fault` `Notice` across the top, "Couldn't reach the sidecar. These rows are the catalogue, not the current state of your connections. Check that OHarness is running, then retry." with **Retry**; rows say Can't check; the detail shows the identity, a note in place of the Connection, Models and Activity panels, and the About panel (it needs no sidecar). A fresh install and a dead sidecar no longer look the same. |
| Fresh install | The list's info Notice and the connection nearest to answering open, with its next step as the one primary. |
| Normal | As above. |

## Accessibility

- Targets: `ui/` controls rise to `control-touch` (44px) when the primary pointer is touch (ADR 0033); the list rows and the Combobox trigger carry the same classes.
- Landmarks and headings as above; the list is an `aside` named "Connections"; every panel is a labelled region; the status line is `aria-live="polite"`; errors that need attention are `role="alert"`.
- Keyboard: the list rows are buttons in reading order; the Back button is the first stop in the narrow connection pane; the model list is a plain list of buttons, the picker a Combobox (`model-picker.md` § Combobox).
- Status is the word plus the `StatusMark`; hollow means not set up, never a colour. Reduced motion stops the busy mark and the skeletons.
- Verified in the Providers audit tooling (`frontend/scripts/audit-providers.mjs`): 0 axe violations and no horizontal overflow at 320, 375, 768 and 1280px in both themes, on a stubbed sidecar.

## Tokens and components used

`control-touch` (ADR 0033), `edge-selected` (ADR 0037) on the open row, `StatusMark` and `ConfirmInline` (the first screen to use them), `ListRow` with its `description` line, `Panel level={3}`, `Notice`, `Skeleton`, `Input compact`, `Badge`, `Button`, `Combobox`. No new token was added for this screen. `atoms.tsx` keeps `Monogram`, `ResidenceMark`, `StateRule`, `ProbeTrace` and `TONE_TEXT`; the old `ToneDot`, `Chip` and `Fact` were deleted with the rebuild (audit D13, closing D2 of `../audit/providers.md`).

## Don't

Show a credential; claim a state the sidecar did not report; put a second primary in the header; put setup forms in the chat; use a vendor colour; add a mascot to this screen.

## Copy (en / pt-BR)

Connections / Conexões · Needs action / Precisa de ação · Ready / Prontas · Can't check / Não dá para verificar · Couldn't reach the sidecar / Não foi possível falar com o sidecar · Retry / Tentar de novo · Default model / Modelo padrão · Use / Usar · default / padrão · Remove key / Remover chave · Replace / Trocar · Save key / Salvar chave · Refresh / Atualizar. The catalogue (`frontend/src/i18n/`) is the source; where it differs from this page, the catalogue wins.
