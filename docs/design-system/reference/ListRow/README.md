A full-width, keyboard-operable row for lists of providers, harnesses, chats and files.

**You provide:** `title`, optional `description` (a second line in plain text, such as a status word and a short fix) and `meta` (machine detail in mono), `leading`, `trailing` (usually a `Badge`), and `onClick`. Mark the open item `selected`.

- Minimum height `control-lg`, so it is a comfortable target. Hover is `sub-200`, pressed `sub-300`; selected is `sub-200` with a `signal` indicator on the inline start and `aria-current`.
- Title truncates with an ellipsis, never wraps; `meta` truncates the same way. A row's height never changes with state.
- Every row can be chosen, even when not ready; readiness is shown honestly in `trailing`, and choosing a not-ready provider opens its setup in place.

**Don't:** hide the selected state in colour alone (the indicator and `aria-current` carry it), or put a mascot in a dense list.
