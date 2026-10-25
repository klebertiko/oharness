A raised surface with an optional header row. Panels hold related content; they are not decoration.

**You provide:** children, and for a header `title` plus `titleId` (labels the section for assistive tech) with optional `actions` (ghost buttons).

- `panel` is `sub-100`, `radius-panel`, a `line-soft` edge and a 1px inner highlight; no drop shadow.
- `float` is for sheets, menus and the palette: `line` edge, `radius-float`, `shadow-float`.
- `inset` is a contained field inside a panel: `sub-200`, no highlight.
- Header height is `h-panelhead`; body pads `space-3`. Do not nest panels more than one level; use `line-soft` dividers instead.

**Don't:** use a card for every group, add a coloured left border, or put a second shadow on a panel.
