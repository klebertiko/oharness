# Task 2 report — Shutdown / port module (TDD)

## Done

- RED: `scripts/desktop-shutdown.test.mjs` failed (module missing).
- GREEN: `scripts/desktop-shutdown.mjs` — `portsEqual`, `parseListeningPorts`, `shouldKillProcess`, `pidsToKill`.
- Numeric port equality only; `51730` ≠ `5173`.
- Kill gated by allowlisted image names (`oharness-sidecar`, `python`, `uvicorn`).

## Verify

```text
node --test scripts/desktop-shutdown.test.mjs  →  7 pass
```

## HITL

Live process kill / tree-kill on a real sidecar not exercised here — unit seam only.
