# CI, security, and release policy

OHarness uses independent quality, security, supply-chain, and release workflows. Probabilistic classifiers never decide whether code may merge or ship.

## Required branch checks

Protect `main`, require pull requests and code-owner review, dismiss stale approvals, block force pushes/deletion, and require these stable checks:

- `Quality / required`
- `Security scan / required`

Enable GitHub Code Scanning, Dependabot alerts, dependency graph, secret scanning with push protection, private vulnerability reporting, and immutable releases in repository settings. GitHub settings are not created by workflow files and must be enabled by an administrator.

## Coverage

| Workflow | Display name | Purpose | Merge blocking |
| --- | --- | --- | --- |
| `ci.yml` | Quality | frontend, backend, Rust/Tauri, website, Compose | Yes |
| `security.yml` | Security scan | Dependency review, CodeQL, OpenGrep, Trivy, Gitleaks, Zizmor; failed scanners upsert Issues | Yes |
| `scorecards.yml` | Scorecards supply-chain security | OpenSSF repository posture | Scheduled evidence |
| `sbom.yml` | SBOM CycloneDX | CycloneDX SBOMs for npm, Python and Cargo | Main/scheduled evidence |
| `owasp.yml` | OWASP Dependency-Check | OWASP Dependency-Check defense in depth | Scheduled; opens an issue on failure |
| `security-monitor.yml` | Dependency audit | npm, pip and RustSec audits | Scheduled; opens an issue on failure |
| `release.yml` | Release | version gate, Windows/Linux/macOS installers, sidecar + desktop smoke, signing when configured, checksums, SBOM, attestations, draft release | Tag: release gate. PR (desktop paths): build-only check |
| `laya-shadow.yml` | Laya triage | optional issue-triage research artifact | Never |

Failed security scanners open or update a deterministic GitHub Issue via `.github/scripts/upsert-security-issue.sh` (title + fingerprint). SARIF uploads to Code Scanning remain the alert surface; Issues are the work-tracking surface.

All external Actions are pinned to full commit SHAs. Dependabot proposes reviewed pin updates. Checkout credentials are not persisted. Jobs receive the smallest practical permissions, and issue-writing/release-writing jobs are separated from scanners.

## Aikido Safe Chain

Package installation in CI passes through Aikido Safe Chain 1.5.15. The versioned installer is downloaded and verified against its published SHA-256 before execution. Safe Chain supplements lockfiles and vulnerability scanners; it does not replace them.

## Releases

Create an annotated SemVer tag, `vX.Y.Z` or a pre-release such as `v0.0.1-alpha`, only after synchronizing the version (without the `v`) in:

- `package.json`
- `frontend/package.json`
- `website/package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`

The tag runs the Quality and Security gates, checks the versions, then builds every platform in the protected `release` environment. PyInstaller cannot cross-compile, so each runner builds its own sidecar (`scripts/build-sidecar.mjs`) and smoke-tests it (`scripts/smoke-sidecar.mjs`) before `tauri build`. Windows also runs the desktop smoke (`scripts/smoke-desktop.ps1 -WebViewOptional`): sidecar health, window close and sidecar cleanup are mandatory; the WebView DOM probe is downgraded to a warning (and a job-summary line) only when the remote-debugging endpoint never answers, which is what happens on hosted runners where WebView2 starts without the flag. An endpoint that answers but shows no page, the wrong title or an empty UI still fails the run, and the probe stays required in `install-desktop.ps1`.

| Runner | Target | Assets |
| --- | --- | --- |
| `windows-2025` | `x86_64-pc-windows-msvc` | `OHarness-windows-x64-setup.exe` (NSIS, per-user) |
| `ubuntu-22.04` | `x86_64-unknown-linux-gnu` | `OHarness-linux-x86_64.AppImage`, `OHarness-linux-amd64.deb` |
| `macos-15` | `aarch64-apple-darwin` | `OHarness-macos-arm64.dmg` |
| `macos-15-intel` | `x86_64-apple-darwin` | `OHarness-macos-x64.dmg` |

Windows ships NSIS only. WiX needs a numeric MSI version (`major.minor.patch.build`, see [`bundle.windows.wix.version`](https://v2.tauri.app/reference/config/#wixconfig)), so an MSI cannot carry a SemVer pre-release such as `0.0.1-alpha`; overriding it with `0.0.1` would give the alpha and the final 0.0.1 the same MSI version, and Windows Installer would not treat the final as an upgrade. If the runner image lacks the Evergreen WebView2 Runtime, the workflow installs it (Microsoft-signed bootstrapper only) before the desktop smoke.

Linux builds on the oldest supported Ubuntu runner, so they need glibc 2.35 or newer. macOS ships two native DMGs instead of a universal one: a PyInstaller `--onefile` sidecar can only be universal2 if Python and every native wheel are universal2, and a onefile binary cannot be merged with `lipo`.

The last job adds `SHA256SUMS` and the CycloneDX SBOM `OHarness-sbom.cdx.json` (from the source lockfiles), attests build provenance for every asset and the SBOM for every installer, and creates a **draft** GitHub Release. A tag with a SemVer pre-release suffix (a hyphen, e.g. `v0.0.1-alpha`) makes it a GitHub **pre-release**. A maintainer reviews the draft and publishes it. Asset names never contain the version, so `https://github.com/klebertiko/OHarness/releases/latest/download/<asset>` points at the newest published *stable* release. GitHub never serves a pre-release from `releases/latest`, so while only pre-releases exist, link the tag instead: `https://github.com/klebertiko/OHarness/releases/tag/v0.0.1-alpha` or `https://github.com/klebertiko/OHarness/releases/download/v0.0.1-alpha/<asset>`.

Pull requests that touch the desktop build (`src-tauri/**`, the release workflow, sidecar scripts, root `package*.json`) run the same matrix as a build-only check: no signing, no attestations, no release. `workflow_dispatch` is a dry run that uploads workflow artifacts only; its `sign` input also runs signing through the `release` environment, so a new certificate can be tested before tagging.

Verify a download:

```bash
sha256sum --check --ignore-missing SHA256SUMS
gh attestation verify OHarness-windows-x64-setup.exe --repo klebertiko/OHarness
```

### Code signing

Each platform signs only when the `release` environment holds its complete set of secrets. With none of them, it builds **unsigned**, and a `::warning::` annotation in the log, the job summary and the release notes say so, including the warning that users will see. With only part of a set, the build fails rather than shipping a half-configured signature. Set the repository variable `REQUIRE_SIGNING=true` to make a tag build fail whenever any platform would be unsigned. Pull requests never sign.

Create these as **environment secrets of `release`**, not as repository secrets, so pull-request builds can never read them.

| Platform | Secret / variable | Value |
| --- | --- | --- |
| Windows | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (secrets) | App registration with a federated credential for subject `repo:klebertiko/OHarness:environment:release` and the *Certificate Profile Signer* role on the signing account |
| Windows | `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT`, `AZURE_TRUSTED_SIGNING_PROFILE` (variables) | Endpoint URL, Artifact Signing (Trusted Signing) account name, certificate profile name |
| macOS | `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD` | Base64 of the exported *Developer ID Application* `.p12`, and its password |
| macOS | `APPLE_SIGNING_IDENTITY` | e.g. `Developer ID Application: Name (TEAMID)` |
| macOS notarization, option A | `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Apple ID e-mail, app-specific password, team ID |
| macOS notarization, option B | `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_P8` | App Store Connect API issuer ID, key ID, and the contents of the `.p8` key (the workflow writes it to `APPLE_API_KEY_PATH`) |
| Linux | `APPIMAGE_GPG_PRIVATE_KEY`, `APPIMAGE_GPG_KEY_ID`, `APPIMAGETOOL_SIGN_PASSPHRASE` | ASCII-armored GPG private key, its key ID, and its passphrase |

The names follow Tauri's own signing variables ([Windows](https://v2.tauri.app/distribute/sign/windows/), [macOS](https://v2.tauri.app/distribute/sign/macos/), [Linux](https://v2.tauri.app/distribute/sign/linux/)). On Windows the workflow signs inside out with Microsoft's `azure/artifact-signing-action` over OIDC (no client secret): first the sidecar, then `oharness.exe`, then the NSIS installer, and it verifies every signature with `Get-AuthenticodeSignature`. On macOS Tauri signs and notarizes; the workflow then checks `codesign`, `spctl` and `stapler`. Developer ID without notarization does not get past Gatekeeper, so macOS signing requires a notarization credential as well. The `.deb` carries no signature of its own (Debian signs repositories, not packages); it is covered by `SHA256SUMS` and the attestations.

What users see while a platform is unsigned:

- **Windows:** SmartScreen shows "Windows protected your PC" with an unknown publisher; *More info* then *Run anyway*.
- **macOS:** the app has an ad-hoc signature only, because Apple silicon refuses to run unsigned code. Gatekeeper blocks the first launch; *System Settings > Privacy & Security > Open Anyway*.
- **Linux:** no warning; there is no embedded AppImage signature to check.

GitHub attestations prove where an artifact came from. They do not replace Authenticode or notarization.

## Laya experiment

Set repository variable `ENABLE_LAYA_SHADOW=true` only when intentionally collecting issue-triage evidence. The workflow has read-only permissions and emits an artifact marked `authority: advisory-shadow`. It cannot label, comment, close, prioritize, suppress security findings, influence required checks, or authorize a release.

Promotion beyond shadow mode requires a versioned, human-labelled PT/EN corpus with immutable train/calibration/held-out splits; a deterministic baseline; per-class precision/recall and macro-F1; ECE/Brier calibration; drift and latency measurements; and predeclared abstention thresholds. High-impact and ambiguous cases remain human decisions.

## Website deploy (GitHub Pages)

`.github/workflows/pages.yml` publishes `website/` to https://klebertiko.github.io/OHarness/ with the official Actions flow: `configure-pages` → `npm run build:pages` → `upload-pages-artifact` → `deploy-pages`. It runs on pushes to `main` that touch `website/**` or the workflow itself, and on `workflow_dispatch`. The build installs no npm dependencies (`build-pages.mjs` uses Node built-ins), so Safe Chain is not needed there. The build job has `contents: read` + `pages: read`; only the deploy job gets `pages: write` + `id-token: write`, inside the `github-pages` environment (deployment branches: `main`, `gh-pages`). `concurrency: pages` never cancels a running deploy.

PRs cannot break the site silently: the Quality `website` job already runs `npm run build:pages`, `test:publication`, `test:i18n` and `test:security` on every PR.

Edit the site only in `website/` on `main`. Do not commit to `gh-pages` by hand.

**Cut-over (one time, repo owner):**

1. Merge the PR that adds `pages.yml`. While Pages is still in legacy mode (branch `gh-pages`), that first run may fail at `deploy`; the old site keeps serving.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Actions → Pages → Run workflow on `main` (or re-run the failed run). Confirm the `deploy` job is green and that `/`, `/en/`, `model.html`, `manifesto.html` (both languages) return 200 with the current content.
4. Keep the `gh-pages` branch as a fallback until step 3 is verified. Rollback: switch Source back to "Deploy from a branch" → `gh-pages` / root. Delete `gh-pages` only after the owner decides it is no longer needed.

## Current baseline failures

None known after the 2026-09-24 finish pass (`cargo fmt` on `src-tauri/src/lib.rs` and frontend ESLint unused-import cleanup). Treat the next CI run on GitHub as the live baseline — fix findings in ordinary reviewed changes. Do not weaken a gate merely to make it green.

## Admin checklist (not in git)

After these workflows land on the default branch:

1. Protect `main` with the ruleset in `.github/rulesets/main.json` (merge queue, required checks, linear history, no force-push/deletion; no required reviewers).
2. Require status checks: `Quality / required`, `Security scan / required`.
3. Enable Code Scanning, Dependabot alerts, dependency graph, secret scanning + push protection, private vulnerability reporting.
4. Create protected Environment `release` with required reviewers and a deployment rule limited to `v*.*.*` tags (plus `main` if signed dry runs are wanted). The workflow references it by name, and GitHub creates an *unprotected* environment of that name on first use if it does not exist yet, so create it before the first tag.
5. Add the signing secrets from [Code signing](#code-signing) to that environment when certificates are available. Until then releases are built unsigned.
6. Optionally set `ENABLE_LAYA_SHADOW=true` only when collecting advisory issue-triage artifacts.
7. Optional: `NVD_API_KEY` repository secret for faster OWASP NVD sync.
