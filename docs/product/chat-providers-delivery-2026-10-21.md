# Chat and Providers delivery

Goal authorized by the user: complete usable Chat/Providers improvements in an isolated branch; PR only, human merge. Scope excludes the parallel durable run/event/artifact implementation.

## Contract (8 points)

1. A submitted turn remains owned by its originating chat and connection while the user navigates. Drafts survive chat switches within the mounted view.
2. Streamed answer text appears without opening the trace; stopped/error states offer a way to reuse the instruction without automatically running it.
3. Messages can be copied with honest clipboard success/failure feedback, or reused in the composer. No automatic command re-execution.
4. Direct chat offers an explicit model override, sent through the existing backend `model` field. Harness runs retain their node/default model policy.
5. Chat history can be filtered, including archived chats; keyboard navigation does not intercept rename inputs or menus.
6. Provider usage can be refreshed after failure; failed budget writes keep the editor and input available. No invented metrics or credential access.
7. Composer exposes tool loading/unavailable states, handles failed skill reads, and remains responsive with visible keyboard focus.
8. Critical interaction tests, typecheck, production build, independent QA and SEC evidence are required before handoff.

DoD: all above criteria verified; no personal profile/DB, credentials or paid calls; reviewable PR with limitations. Independent reviewers read the diff and this contract in fresh contexts.

## Feature matrix

| Desired behavior | Existing support (source inspection) | This delivery / real dependency |
|---|---|---|
| Harness, workspace and provider selection | HarnessBar, WorkspacePicker, readiness-gated ChatProviderPicker | Preserve; freeze selection controls during a turn; show model and tool state |
| Model per turn | Backend direct payload already accepts `model`; graph nodes own models | Direct override only; harness explains node/default precedence |
| Attachments and context | Workspace discover/read and skills; no attachment envelope | Preserve real workspace tools; attachment ingestion deferred |
| Slash commands and shortcuts | Commands, bundled/workspace skills, read/exec presets, Ctrl/Cmd+Enter | Preserve; recover failed reads; keep keyboard navigation usable |
| Send, stream, stop, reuse and copy | SSE, stop control, optional detailed transcript | Visible streamed text, origin ownership, copy and explicit draft reuse |
| Tools and errors | Detailed transcript, gates, tool approval cards, transport notices | Preserve cards; expose recoverable failure and tool readiness in chat |
| Threads | Local persisted messages, rename/archive/delete, recency groups | Search, drafts and navigation safety; durable run history remains parallel work |
| Provider catalog/configuration/probe | Catalog, credentials via host vault, endpoint/model config, honest probe provenance | Preserve; expose direct model selection without mutating connection defaults |
| Fallback | Harness providerIds resolve with failover evidence | Preserve harness policy; no fabricated direct-chat fallback control |
| Usage/cost | Sidecar ledger, estimated-cost completeness and budget API | Refresh/recovery; retain unknown/unpriced semantics |
| Conversation memory | Thread transcript stored locally; direct request carries instruction only | Deferred: history/context contract with bounded truncation and provenance; UI must not imply past turns are sent |
| Resume across destinations/reload | Stream controller is scoped to the mounted chat view | Deferred to parallel durable run/event work; leaving Chats or reloading can detach the live stream. This cut preserves ownership while switching threads within Chats |

## Design and evidence boundaries

Reuse `design.md`: Quiet Desk reading column; Curated Library provider dossier; Sora/IBM Plex Mono and named paper/graphite/ink/mineral tokens. Stream text is the primary new reading surface, with compact actions below messages. Controls wrap on narrow screens. No new brand palette or competitor assets.

Input research: `D:/Development/src/OHarness/docs/product/harness-innovations-research-2026-10-21.md`, read directly because it is untracked in the source checkout. Reuse its behavior-level opportunities (explicit inference settings, inspectable tools, honest coverage). No new comparative claims. Source inspection is not runtime evidence; local tests use synthetic sidecar frames, not competitor runtime observations.

Integration seam: optional `model` on frontend `useRunStream.start`, forwarded only to the already-supported direct request field. No changes to backend storage, Activity/Runs, event or artifact contracts.

## Review notes

Architecture: frontend-local composition and interaction state; existing provider readiness, credential vault, default model and graph failover remain authoritative. Only execution seam changed is the optional direct `model` forwarding. Runtime connection/model evidence takes precedence over the chat default when labeling an answer. The change is reversible, with no DB or local-storage schema migration.

Security: independent delta review found no introduced defect. Existing dependency audit findings prevent an unconditional repository security gate pass; this delivery is a draft PR for review, not merge-ready. See `.harness/sprint-2026-10-21/story-CHAT-PROVIDERS/security.md` for affected packages and review scope.
