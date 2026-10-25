# CI / security pipeline — completion (2026-09-24)

Closes the ChatGPT share work
(https://chatgpt.com/s/cx_6ab4bebdfa3481919b8e7d417aa7c99f): bar-3 OpenSSF /
GitButler-aligned delivery gates for OHarness, plus OpenGrep, Aikido Safe
Chain, CycloneDX, OWASP Dependency-Check, and optional Laya shadow.

## Delivered on disk

| Artifact | Role |
| --- | --- |
| `.github/workflows/ci.yml` | Quality — Frontend, Backend, Rust, Website, Compose → `Quality / required` |
| `.github/workflows/security.yml` | Security scan — Dependency review, CodeQL, OpenGrep, Trivy, Gitleaks, Zizmor → `Security scan / required`; failed scanners upsert Issues |
| `.github/actions/setup-safe-chain/action.yml` | Aikido Safe Chain 1.5.15 with SHA-256 verify (Unix + Windows); PATH fixed same-step |
| `.github/scripts/upsert-security-issue.sh` | Title-primary issue upsert with Fingerprint body marker |
| `.github/workflows/sbom.yml` | SBOM CycloneDX for root/frontend/website npm, backend pip, Tauri cargo |
| `.github/workflows/owasp.yml` | OWASP Dependency-Check 12.1.8; opens tracking issue on CVSS ≥ 7 |
| `.github/workflows/scorecards.yml` | Scorecards supply-chain security — SARIF → Code Scanning |
| `.github/workflows/security-monitor.yml` | Dependency audit — scheduled npm / pip-audit / cargo-audit + issue upsert |
| `.github/workflows/release.yml` | Tag `vX.Y.Z` → reusable Quality + Security scan → Windows NSIS + smoke + attestations |
| `.github/workflows/laya-shadow.yml` | Advisory · Laya issue triage (`ENABLE_LAYA_SHADOW`); never merge authority |
| `.github/dependabot.yml` | npm ×3, pip, cargo, github-actions |
| `docs/ci-security.md` | Policy + admin checklist |
| `scripts/laya_issue_shadow.py` | Non-authoritative Laya Router evidence writer |
| `SECURITY.md` | Private vulnerability reporting |

## Finish-pass changes (this session)

- Applied `cargo fmt` to `src-tauri/src/lib.rs` (was documented baseline failure).
- Cleared frontend ESLint unused-import / unused-prop debt so `npm run lint` is green.
- Linked README → `docs/ci-security.md`.
- Expanded admin checklist in `docs/ci-security.md`.

## Explicitly out of scope (unchanged)

- Laya production authority / merge decisions — shadow only; promotion bar stays in `docs/ci-security.md`.
- Desktop sidecar crash / HITL packaging beyond what `release.yml` already smoke-tests.
- Authenticode / EV signing (documented as remaining before production distribution).
- Git commit / push — files remain untracked or dirty until HITL asks to commit.

## HITL next (admin + git)

1. Review and commit the `.github/**` pack + finish-pass fixes on a dedicated PR (do not mix with unrelated dirty harness/desktop WIP unless intentional).
2. After merge to `main`, run the admin checklist in `docs/ci-security.md`.
3. Optionally set `ENABLE_LAYA_SHADOW=true` only when collecting advisory artifacts.
