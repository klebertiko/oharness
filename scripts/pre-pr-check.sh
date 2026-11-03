#!/usr/bin/env bash
# Pre-PR gate: catches locally what CI catches late (docs/process/pre-pr-checklist.md).
# Usage: scripts/pre-pr-check.sh [base-ref]   (default: origin/main). Exit 1 on any failure.
set -u
base="${1:-origin/main}"
fail=0
say() { printf '%s\n' "$*" >&2; }
bad() { say "FAIL: $*"; fail=1; }

git rev-parse --verify -q "$base" >/dev/null || { say "pre-pr-check: base $base not found (run: git fetch origin main)"; exit 1; }
changed="$(git diff --name-only --diff-filter=d "$base"...HEAD 2>/dev/null)"
[ -z "$changed" ] && { say "pre-pr-check: no changes against $base"; exit 0; }

# 1. branch must be up to date with the base and must not carry foreign (stacked) commits
if ! git merge-base --is-ancestor "$base" HEAD; then
  bad "branch is behind $base: merge $base first (and never stack on an open PR)"
fi

# 2. generated files that never belong in a PR
if printf '%s\n' "$changed" | grep -Eq '(^|/)(tsconfig\.tsbuildinfo|next-env\.d\.ts)$'; then
  bad "generated file in the diff (tsbuildinfo / next-env.d.ts): git rm --cached it"
fi

# 3. personal data / local paths in added lines
added="$(git diff -U0 "$base"...HEAD -- . ':(exclude)*.png' ':(exclude)*.webp' ':(exclude)*.lock' | grep -E '^\+[^+]' || true)"
if printf '%s\n' "$added" | grep -Eiq '@gmail\.com|[A-Za-z]:\\+Users\\+[A-Za-z0-9._-]+|/home/[a-z][a-z0-9_-]+/|/Users/[A-Za-z0-9._-]+/'; then
  bad "personal e-mail or local path in added lines"
fi

# 4. risky constructs (OpenGrep / CodeQL)
if printf '%s\n' "$added" | grep -Eq 'shell *= *True'; then bad "shell=True in added lines"; fi
if printf '%s\n' "$added" | grep -Eq 'new RegExp\([^"'"'"'`]|re\.compile\([a-z_]+\)'; then
  say "WARN: dynamic RegExp in added lines (OpenGrep flags it): escape the literal or compare strings"
fi

# 5. unused imports / variables (CodeQL) in changed Python, tests included
py="$(printf '%s\n' "$changed" | grep -E '\.py$' || true)"
if [ -n "$py" ]; then
  if command -v ruff >/dev/null 2>&1; then
    # shellcheck disable=SC2086
    ruff check --select F401,F841 --no-cache $py >&2 || bad "unused import/variable in Python (ruff F401,F841)"
  else say "WARN: ruff not installed; skipped F401/F841"; fi
fi

# 6. frontend lint (Biome) on changed TS/TSX, when installed
ts="$(printf '%s\n' "$changed" | grep -E '^frontend/.*\.(ts|tsx|mjs)$' || true)"
if [ -n "$ts" ] && [ -x frontend/node_modules/.bin/biome ]; then
  # shellcheck disable=SC2086
  (cd frontend && ./node_modules/.bin/biome lint --error-on-warnings $(printf '%s\n' "$ts" | sed 's#^frontend/##')) >&2 || bad "Biome lint"
elif [ -n "$ts" ]; then say "WARN: frontend deps not installed; Biome skipped"; fi

# 7. secrets (Gitleaks), when installed
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks detect --no-banner --redact --log-opts "$base..HEAD" >&2 || bad "gitleaks found a secret-like value in the PR range"
else say "WARN: gitleaks not installed; skipped (CI will run it)"; fi

[ "$fail" = 0 ] && say "pre-pr-check: OK"
exit "$fail"
