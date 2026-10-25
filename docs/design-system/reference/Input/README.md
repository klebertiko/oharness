A single-line text field with a label, helper text and an error line that never shifts the layout.

**You provide:** `label` (always; placeholder is not a label), optional `hint`, and `error` when invalid. Pass normal input props (`value`, `onChange`, `type`, `name`).

- The message line reserves one row whether or not it has text, so an error appearing moves nothing.
- The edge is `line-strong` (3:1 or better) so the field is findable; focus turns it `signal` with the shared ring; invalid turns it `fault` and the message uses `fault-text`, announced with `role="alert"`.
- Use `mono` for keys, ids, paths and ports. Secrets use `type="password"` and say where they are stored in `hint`.
- Validate on blur or after 250 ms of silence, never per keystroke. Typing must never wait on the network.

**Don't:** use placeholder as the only label, show an error before the person has left the field, or clear a value on error.
