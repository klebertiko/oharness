# SDD ledger plan 06
Branch: feature/oharness-06-tauri-installer
BASE: 790b6028c317dbb359ba9a86290751bf7ab1533b

| Task | Status | Notes |
|------|--------|-------|
| 1 Next static export | done | `out/` built; apiBase → sidecar |
| 2 Shutdown / port module | done | node:test 7 pass; numeric ports |
| 3 Scaffold Tauri v2 | done | `6855093` src-tauri + root package.json |
| 4 Keychain wire-up | done | `1fc23d6` OH_SECRETS; 14 pass / 1 skip |
| 5 Installer | done | `73ec8f3` NSIS docs; no fake build claim |
| 6 Workspace index sync | done | `7272195` README note; CLAUDE/AGENTS/GEMINI/mdc updated outside git |

## HEADs (plan 06 commits)

| SHA | Summary |
|-----|---------|
| ff4e488 | feat(frontend): static export + apiBase |
| 7a8df4d | test(desktop): numeric port equality shutdown helpers |
| 6855093 | feat(desktop): scaffold Tauri v2 shell with FastAPI sidecar |
| 1fc23d6 | feat(secrets): KeychainSecrets behind OH_SECRETS |
| 73ec8f3 | docs(desktop): NSIS install path and harness-spec |
| 7272195 | docs(workspace): index OHarness in place of HarnessSimulator |

Branch HEAD: `6f2afaf81c99872aa4732a376775f20673700237` (includes SDD ledger commit)
