A compact status label: a marker square and a word. Status is always a word, never colour alone.

**You provide:** a short lowercase word as children ("ready", "needs key", "unreachable") and either a `tone` or a graph `role`.

- Tones: `neutral` (default), `signal` (live or ready), `warn` (needs attention), `fault` (failed). Warn and fault text use `warn-text` and `fault-text`.
- `role` paints the marker with `--role-<name>` for graph node types; the role name stays beside it. Use only in Studio and Providers lists, never in running prose.
- Machine-style text in `t-meta` on a `line-strong` edge, 20px tall, `radius-control`. No pills.

**Don't:** stack more than two badges on a row, use a badge as a button, or invent a tone.
