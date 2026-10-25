# Experience contract

The system is judged by how it feels under use. These rules are testable; each one names the token or component that carries it and how to check it. A screen that breaks one is a defect, not a preference.

## No flicker, no shift

- **Fonts load before first paint.** Self-host Sora (400, 500, 600) and IBM Plex Mono (400, 500) as `woff2`, preload the two used above the fold, and declare `font-display: swap` with a metric-matched fallback (`size-adjust`, `ascent-override`) so the swap moves nothing. Check: reload with cache disabled; text must not change size or reflow.
- **Theme is applied before React.** An inline script in `<head>` sets `data-theme` from storage before first paint. A flash of Graphite on an Ivory user is a defect. `color-scheme` and the `theme-color` meta follow the theme.
- **Cumulative layout shift stays at 0 on route and state change.** Anything that loads reserves its final size first: a skeleton with the exact row height, an image with width and height, a message slot in `Input` that exists whether or not there is an error. Check: Performance panel, Layout Shift track empty.
- **Loading never replaces content with a spinner.** Keep the previous content on screen and mark it stale with `aria-busy`; show a skeleton only when there is nothing to show. `Button` in `loading` keeps its width.
- **Never unmount to hide.** Collapsing a panel animates `opacity` and `transform`, not height; long lists are virtualised.

## No lag

- **Feedback within 100 ms.** Press, toggle and select respond on `pointerdown` or the next frame; use optimistic update for local state and reconcile after. Anything that will take longer than 400 ms shows progress at 100 ms. Interaction to Next Paint stays under 200 ms (the Core Web Vitals "good" threshold) on the target hardware.
- **Animate only `transform` and `opacity`.** Never width, height, top, left, margin or box-shadow blur. Hover states change `background-color` and `border-color` only, at `duration-fast`.
- **Typing never waits.** The composer and every `Input` are uncontrolled-fast: no network, validation or re-render of siblings on a keystroke; debounce validation to blur or 250 ms.
- **Streaming text is appended, not re-rendered.** A message that streams must not re-mount earlier messages or move the scroll position; scroll follows only if the person is already at the bottom.
- **Canvas stays at frame rate.** Studio's graph pans and zooms at 60 fps with 200 nodes: memoise node components, keep inline styles out of node renders, no layout reads in drag handlers.

## Findable and legible

- **One focus ring, always visible.** Solid 2px `signal`, 2px offset, on `:focus-visible`; never `outline: none` without a replacement. Tab order follows reading order. Sheets trap focus and return it to the opener.
- **Keyboard first.** Every action has a path without a pointer. The command palette lists every command with its `Kbd`. Shortcut hints in menus and tooltips use `Kbd`.
- **Navigation shows where you are.** The current destination in the rail has `aria-current="page"`, `ink-primary` and a `signal` indicator; the header names the current document. Back never loses a draft.
- **Reading measure.** Conversation text is a single column of 60 to 68ch in `t-reading`; code and traces may run wider in `t-code`.
- **Status is never colour alone.** `Badge` always carries a word; `fault-text` and `warn-text` always carry an icon or label.
- **Targets.** Pointer targets are at least 24px (`control-sm`) on desktop and 36px (`control-lg`) on narrow layouts.
- **Empty, loading, error and success are designed states of every list and panel.** Each says what is true and what to do next.

## Honest and reversible

- **Never a dead end.** A control that cannot act says why in place and offers the fix (the provider picker pattern in design.md). Disabled is explained, not silent.
- **Destructive actions are undoable or confirmed.** Prefer undo over a dialog; if a dialog, the button names the action ("Delete harness") and `Cancel` is the default focus.
- **Reduced motion is respected.** Under `prefers-reduced-motion: reduce`, durations become 0 except the focus ring; nothing relies on motion to convey state.
- **No invented numbers.** Metrics shown are measured. A figure with no source is not shown.

## How to check

1. Reload cold with the cache disabled; text and theme must not change after first paint.
2. Throttle CPU 4x and drag a node, type in the composer, open the palette; no dropped input.
3. Tab through the screen with the pointer unplugged; every control is reached, ringed and operable.
4. Toggle reduced motion and the other theme; nothing breaks, nothing shifts.
5. Run the contrast audit in the README after any colour change.
