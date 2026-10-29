# Reference implementation

Vanilla React (classic script, no build) of Button, Input, Badge, Panel, ListRow, Kbd and Nilo, plus Notice, EmptyState, Segmented, StatusMark, ConfirmInline, Skeleton and Popover, styled only with tokens. It is the specification the real components in `frontend/src/components/ui/` are built from, and a quick way to see both themes.

- `bundle.js` assigns `window.OH`. The Nilo code is a faithful port of `frontend/src/components/brand/` (grid, frames, loop).
- `bundle.css` uses only token variables. Its first line imports the fonts from Google Fonts for this preview only; the app must self-host them (see `../adoption.md`).
- `ModelPicker/`, `Composer/` and `RunSurfaces/` are pattern previews: the model picker (chip, grouped list, scope, Needs action, Model not pulled), the composer states (queue, plan card, permission, call to action) and the run surfaces (thinking status, approval card, subagent tree, turn diff, markers). They compose the components above and mirror `../components/*.md`; the real components are in `frontend/src`.
- `*/README.md` is the usage guideline per component (the new ones are documented in `../components/`); `*/preview.html` is a small live example; `Cover/` is the brand cover.
- `index.d.ts` documents the props.

Preview locally (from the repository root):

```bash
node scripts/design-tokens.mjs --css docs/design-system/reference/tokens.css
python -m http.server 4173 --directory docs/design-system/reference
# open http://localhost:4173/?theme=dark and ?theme=light
```

`tokens.css` is generated and git-ignored; do not commit it.

`index.html` is a local preview harness: it loads each component's `preview.html` in an iframe and builds the page with DOM calls, with no HTML strings and no dynamic code. It is never published to Pages and never ships in the app. The previews load React from unpkg (pinned, with integrity hashes) and, for the preview only, the fonts from Google Fonts.
