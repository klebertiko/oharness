# Design — OHarness

A locked design system for OHarness. The product is an everyday agent
workspace; its Studio is a visual Graph Engineering instrument.

## Genre

Modern-minimal editorial workspace. Quiet, warm and precise: the interface
behaves like a well-made instrument without borrowing the visual density of an IDE.

## Product hierarchy

The app is one flat set of destinations — Chats, Studio, Providers — never a
mode switch that reshuffles navigation. Each destination is a distinct
instrument with its own macrostructure family; none of them borrow another's
shape to look busy.

1. **Chats** is home: conversation, work, files, code and tasks happen here.
2. **Harness** is a visible operating mode inside a chat: on, off or replaced
   in place, never a separate screen.
3. **Studio** is Graph Engineering: people compose agents, tools, gates,
   skills, context and provider policy behind the work.
4. **Providers** is the roster of model connections: who answers, what it
   costs, whether it is reachable.
5. **OHM** is the portable result of a Studio design, never raw JSON by default.

## Provider stance — pick anything, fix it in place

A provider picker must never be a dead end. Any row can be chosen; choosing
one that is not ready opens its setup *inside the picker* (paste a key, or
turn on a keyless local/CLI connection) instead of sending the person to
another screen or ignoring the click. Readiness is shown honestly on every
row, and the composer says exactly what is missing ("Paste an Anthropic key
to send"), never a bare "Unavailable". What stays strict is runtime, not
selection: a run never silently swaps to a different provider.

## Macrostructure family

- Chats: **Quiet Desk** — one generous reading column, a single composer and
  navigation that recedes while work is happening.
- Studio: **Graph Workshop** — a working overview identifies the current
  draft and the source of each starting point. Opening one enters the graph
  editor with its palette, inspector and validation tools. Back returns to
  the overview; Continue editing keeps the same draft. Use in chat explicitly
  applies the draft to the active harness. No marketing hero over the canvas.
- Providers / Harnesses: **Curated Library** — stronger hierarchy, fewer
  visible controls, clear source and capability labels. Providers is a spec
  sheet you read: no mascot in the dense list/dossier, restraint over reach.

## Theme

Warm graphite is the default substrate; warm ivory is the optional light theme. The values below are the Ivory theme as shipped; the full token set, both themes, is `docs/design-system/tokens.json`.
The user's theme choice persists. Reading text uses neutral ink. Mineral teal
means action, focus and live state and must occupy less than five percent of a
viewport. Semantic graph colours appear only on small role markers, never on
running text.

- Paper: `oklch(0.965 0.008 82)`
- Raised paper: `oklch(0.985 0.005 82)`
- Ink (`ink-primary`): `oklch(0.235 0.012 75)`
- Body ink (`ink-dim`): `oklch(0.380 0.011 75)`
- Secondary ink (`ink-mute`): `oklch(0.470 0.010 75)`
- Quiet ink (`ink-faint`, decoration only): `oklch(0.500 0.009 75)`
- Rule: `oklch(0.810 0.011 82)`
- Accent: `oklch(0.52 0.105 190)`

## Typography and controls

- UI/display: Sora, normal 400–600. Machine detail: IBM Plex Mono 400–500.
- Reading text uses exactly three levels: ink, body ink and secondary ink. Quiet ink is a fourth, for decorative glyphs and non-essential hints; never put anything a person must read in it.
- Accent-coloured text is reserved for interactive state, never eyebrows or decoration.
- Conversation gets 24–48px breathing room; tools remain compact.
- Radii follow the shipped tokens: controls 4px, panels 6px, floats 8px (the composer uses 14px). Never full pills by default. A larger scale (10px cards, 7px controls) is an open decision for a future visual comparison; do not change radius on your own.
- Labels are sentence-like unless they represent machine data.
- Primary controls use mineral fill; secondary controls are contained surfaces.

## Shared constraints

- Header: a 48px contextual strip, brand aligned with the sidebar, current
  surface/document in the flexible centre, compact command search on the right.
  Native window controls only appear inside the desktop shell. No counters,
  segmented dashboard, or decorative status lamps inside the search control.
- Brand: preserve Nilo's shared pixel sprite and animation implementation;
  the compact mark and mascot must remain one identity, not unrelated logos.
  Where Nilo appears on a surface, her **pose says what that surface is** —
  waiting on Studio's empty canvas, idle where a surface
  is just quiet — never the same idle sprite pasted into every empty state as
  a generic mascot slot. A surface earns Nilo only when her state is true of
  that surface; Providers' dense spec-sheet screens carry no mascot at all.
- Narrow layouts hide the wordmark before squeezing document names or actions.

- Keyboard-first with obvious focus and a command palette.
- Progressive complexity: a first-day user sees the task; an expert can open
  the graph, providers, inspector and run trace.
- The Studio says **Export OHM** and **Import OHM**. `.oharness` imports only
  as a backwards-compatible migration path.
- No gradients, purple, neon, pill farms, dense all-caps UI, fake browser
  chrome, ornamental motion, invented metrics or generic bento dashboards.
