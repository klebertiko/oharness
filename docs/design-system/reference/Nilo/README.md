Nilo, the OHarness owl: a 16 by 13 pixel sprite that acts out what the agent is doing. She is the product's identity and its only mascot. Read `Nilo` in the brand sections for when she may appear.

**You provide:** a `state` (`idle`, `thinking`, `working`, `waiting`, `success`, `error`, `sleeping`), an integer `cell` size (6 for Chats home, 4 inside a narrower panel), and a `label` when she is not decorative. Add `interactive` for the one hero placement on a surface; it renders a button.

- Her pose must be true of the surface: `waiting` on Studio's empty canvas, `idle` where it is merely quiet, `thinking` and `working` only while a run is live, `error` only for a real failure. Never one idle sprite pasted into every empty state.
- Providers and other dense spec-sheet screens carry no Nilo. At most one Nilo per surface.
- `interactive` follows the pointer, reacts to clicks (hop, wink, head turn, ruffle, hoot; five fast clicks make her dizzy) and dozes off after 90 s idle. A static Nilo still blinks and glances.
- Under `prefers-reduced-motion` she holds one still pose per state; pass `still` to force it. Her animation runs at 110 ms per frame and moves only whole pixel cells.
- Render at an integer `cell` size with crisp edges. Never scale with CSS transforms, add outlines, shadows, gradients or accessories. Use `crop="face"` for inline status lines.
- The body takes `--nilo-body` (the live `signal`); every other part has a fixed `nilo-*` colour so her face reads the same in both themes.
