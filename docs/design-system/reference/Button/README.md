The control that starts an action. One `primary` per view, at most; everything else is `secondary`, `ghost` or `danger`.

**You provide:** a text label as children (sentence case, a verb: "Use in chat"), an `onClick`, and for `iconOnly` an `aria-label`.

- `primary` is the `signal` fill with `signal-ink` text; it is the single main action and answers "what happens next". Never two in a row.
- `secondary` has a `line-strong` edge on `sub-200`; it is the default.
- `ghost` lives in toolbars and panel headers. `danger` names the destructive act ("Delete harness"), never "OK".
- Use `loading` for any wait over 100 ms: the button keeps its exact width, shows a spinner, ignores clicks and sets `aria-busy`. Do not swap the label or disable it with no reason.
- Disabled needs a visible reason nearby; prefer leaving it enabled and explaining on press.
- Height follows `control-sm`, `control-md` or `control-lg`. Focus ring is the shared 2px `signal` ring.

**Don't:** put two primaries side by side, use colour alone to separate danger from secondary (the label does it), or animate width.
