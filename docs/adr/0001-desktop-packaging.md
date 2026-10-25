# ADR 0001 — Desktop packaging: Tauri v2

- **Status:** Accepted
- **Date:** 2026-09-04
- **Scope:** Shell & visual identity workstream. Decides the packaging target and
  what it implies for window chrome. Does **not** wire the packaging up.

## Context

OHarness is becoming a desktop application: a canvas where a person wires an
agent harness, plus interactive coding-agent behaviour driven by that harness.
It runs on the user's own provider subscriptions — Anthropic, Cursor, OpenAI,
OpenRouter, Ollama (local and cloud).

Two facts about the codebase drive this decision more than anything else:

1. **The heavy lifting already lives outside the shell.** Execution, adapters and
   persistence are a separate FastAPI process (`backend/`). The desktop shell
   renders a graph, streams events, and edits config. It does not need to *be*
   the runtime.
2. **The app holds long-lived provider credentials.** Not one key for one
   vendor — a wallet of them, plus whatever local endpoints the user points at.
   Credential handling is a first-order requirement, not a later hardening pass.

The `sumi` desktop-app-design guidance was consulted. It is explicit about what
the shell must deliver — invisible chrome, keyboard-first interaction, spatial
memory, persisted panel geometry, resizable split panes, detachable panels for
multi-monitor work — and it is silent on packaging frameworks. The reasoning
below is therefore derived from those requirements rather than quoted from it.

## Decision

**Package with Tauri v2.** Ship the Next.js frontend as a static export inside a
Tauri window; supervise the FastAPI backend as a Tauri sidecar process.

### Why not Electron

Electron is the obvious counter-proposal and it is not a weak one. It is what
VS Code and Cursor ship, its multi-window and detachable-panel story is mature,
and its bundled Node runtime makes spawning local agent processes trivial. If
OHarness had no backend process, Electron would probably win on the strength
of that last point alone.

It does have a backend process. That removes Electron's biggest advantage and
leaves its costs standing:

| | Tauri v2 | Electron |
|---|---|---|
| Installer size | ~10–30 MB | ~120–150 MB |
| Idle memory | one system WebView | full Chromium per window |
| Web runtime | OS WebView (WebView2 / WKWebView / WebKitGTK) | pinned Chromium |
| Secret storage | OS keychain via plugin, never in renderer | main-process code you write |
| Privilege model | capabilities allow-list per window, deny by default | contextIsolation + your own IPC discipline |
| Sidecar process | first-class (`shell` plugin, sidecar binaries) | `child_process`, hand-rolled lifecycle |

The security column is the decider. Tauri's capability system means the renderer
— the surface that will eventually run model-authored content and third-party
MCP tool output — starts with *no* filesystem, shell or network privileges and
receives them one named command at a time. Getting the equivalent posture in
Electron means never slipping on contextIsolation, sandbox, and IPC validation
across the whole life of the project. For an app whose renderer will routinely
display untrusted model output, deny-by-default is worth more than a mature
multi-window API.

### What we accept

- **Rendering varies by platform.** WebView2, WKWebView and WebKitGTK are not
  the same engine. The design leans on this being fine: no CSS that only
  Chromium implements, and `oklch()` — used throughout the token layer — is
  supported across all three current targets. Cross-platform visual QA is a
  standing cost, not a one-off.
- **Detachable panels are harder.** Multi-window in Tauri v2 is workable but
  less trodden than Electron's. Panels are dockable in v1; detaching is deferred.
- **A Rust toolchain enters the build.** Acceptable — it is already a workspace
  dependency elsewhere.

## Consequences for the shell

This is where the decision touches the design directly.

1. **Native decorations are off** (`decorations: false`). The title bar in
   `components/shell/TitleBar.tsx` *is* the window's title bar, not an
   illustration of one. It owns the drag region, and it is why the app has a
   34px chrome band with a live readout in it rather than an OS-drawn strip with
   a document name.
2. **Window controls are ours on Windows and Linux.** `TitleBar` draws
   minimise / maximise / close as 10px glyphs in 44px hit targets, with close
   hovering to `--fault`. They call `getCurrentWindow()` through a guarded
   lookup, so the same component runs unchanged in a browser during development
   (the buttons are inert there).
3. **macOS keeps its traffic lights.** Use `titleBarStyle: "Overlay"` rather
   than drawing our own: people reach for those three dots by muscle memory and
   a hand-drawn copy is always slightly wrong. `TitleBar` reserves a 68px inset
   on macOS and suppresses our own buttons there.
4. **Drag regions are declared with `data-tauri-drag-region`**, not Electron's
   `-webkit-app-region` CSS. Anything interactive inside the bar is a real
   element and therefore already excluded.
5. **Panel geometry persists in `localStorage`** (`shellStore.ts`), which is per
   WebView origin and survives across launches. When settings move server-side
   this should migrate to the Tauri store plugin; the store's API does not
   change either way.
6. **Provider credentials must never reach the renderer.** The inspector's
   current plain-text API-key field is POC scaffolding. Under Tauri they belong
   in the OS keychain behind a named command, with the UI holding a reference
   and never a value. Flagged here for the provider-connection workstream.

## Follow-up

- Wire `src-tauri/` with `decorations: false`, `titleBarStyle: "Overlay"` on
  macOS, a minimum window size around 720×480, and the FastAPI sidecar.
- Verify the token layer renders identically on WebKitGTK and WKWebView.
- Move API keys to the keychain before any provider ships.
