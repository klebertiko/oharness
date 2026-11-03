#!/usr/bin/env bash
# Claude Code PreToolUse hook (Bash): blocks `git push` and PR creation when scripts/pre-pr-check.sh fails.
# Fail-open only when the tooling itself is missing, never when a check fails.
input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
case "$cmd" in
  *"git push"*|*"repos/"*"/pulls -X POST"*|*"-X POST repos/"*"/pulls"*) ;;
  *) exit 0 ;;
esac
# pushing to main / force pushes are never allowed from a session
if printf '%s' "$cmd" | grep -Eq 'git push[^|;&]*( --force| -f |--force-with-lease)[^|;&]*( main| origin main)|git push[^|;&]*(origin )?main( |$)'; then
  echo "pre-push-guard: pushing to main or force-pushing it is not allowed (governance). Use a branch and a PR." >&2
  exit 2
fi
root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -x "$root/scripts/pre-pr-check.sh" ] || exit 0
git -C "$root" fetch -q origin main:refs/remotes/origin/main 2>/dev/null
if ! out="$("$root/scripts/pre-pr-check.sh" 2>&1)"; then
  printf '%s\n' "$out" >&2
  echo "pre-push-guard: fix the failures above (docs/process/pre-pr-checklist.md), then push again." >&2
  exit 2
fi
exit 0
