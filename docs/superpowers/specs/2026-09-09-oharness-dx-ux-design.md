# OHarness — DX / UX Design

Date: 2026-09-09  
Status: approved (brainstorming sections 1–3)  
Supersedes UI naming: **Wallet → Providers** (user-facing).  
Companion: [`2026-09-09-oharness-design.md`](./2026-09-09-oharness-design.md), [`../../design.md`](../../design.md), [`../../brand/README.md`](../../brand/README.md).

## Product stance

OHarness is a **desktop instrument** (Tauri), not a browser product. Chat is the **home** because that is where the user *sees the harness work for real*. Studio is where they *see and validate the graph* without spending provider tokens. The product is not “another chat app”; chat is the proof surface.

Inspiration: Cursor / Claude / Codex desktop shells + NightwolfRGB brand recipe + desktop-app-design (density, keyboard-first, progressive complexity).

## Locked decisions

| Topic | Decision |
|---|---|
| Ship surface | Tauri desktop window — browser `:3000` is eng fallback only |
| Cold start | **Agent · Chat** with threads sidebar |
| Harness default | **ON** + default Agile `.oharness` |
| Live provider | Auto-probe **Claude CLI → Cursor CLI → API keys**; else **mock** + clear copy |
| Harness chrome | Bar **above the composer**: On/Off · bundle name · Provider chip · “Open in Studio” |
| Providers | User-facing name **Providers** only — never “Wallet” |
| Cowork / Automations / Git | Removed from Chat tabs → **command palette / menu** |
| Studio | Same window, mode switch; shared active bundle; Validate = mock / dry-run |
| Brand mark | Nightwolf-style plate: `brand/mark.svg` + `brand/icon.png` |

## Shell — Agent home

```
┌──────────────────────────────────────────────────────────┐
│ Titlebar · mark · OHarness · Agent | Studio · win ctl │
├────────────┬─────────────────────────────────────────────┤
│ Threads    │ Transcript                                  │
│ (+ New)    │                                             │
│            │ ── Harness [On|Off] · bundle · Provider chip│
│            │    · Open in Studio                         │
│            │ Composer                                    │
├────────────┴─────────────────────────────────────────────┤
│ Status · mock|live · probe · keymap hint                 │
└──────────────────────────────────────────────────────────┘
```

### Desktop-app-design mapping

- **Master–detail:** threads (master) + chat (detail); arrow keys / Enter / Esc.
- **Keyboard-first:** Ctrl/Cmd+K palette; Alt+1 Agent, Alt+2 Studio, Alt+4 Providers; `?` keymap.
- **Progressive complexity:** Chat surface simple; Studio + Providers + palette for depth.
- **Information density:** meta in status + harness bar; no dashboard cards on home.
- **Spatial memory:** modes and panel positions persist across sessions.
- **Empty states:** first thread CTA; if no provider live → mock with “Connect a provider”.

## Shell — Studio

- Canvas + Validate dock + node inspector (right).
- Same active bundle as Chat.
- Validate / mock dry-run **must not** bill the subscription or API.
- Entry: titlebar mode, harness-bar link, or palette.

## Providers

- List of connections (local vs cloud), health, billing (subscription / metered).
- Detail: probe, seal secret if needed, set Chat default.
- Credentials never in the renderer (existing vault ADR).
- Chip on composer opens this surface.

## Brand / icon

Follow NightwolfRGB `brand/` convention:

- `mark.svg` — 64², `rx=12`, graphite plate, orthogonal harness glyph, **one** cyan accent.
- `icon.png` — taskbar / Tauri source.
- Generate installer icons: `npm run tauri -- icon brand/icon.png`.

In-app titlebar mark stays geometrically aligned with `mark.svg` (input → junction → output).

## Implementation slices

1. Rename Wallet → Providers (UI strings, panel titles, docs).
2. Agent home: threads sidebar + Chat; harness bar; strip Cowork/Automations/Git tabs → palette.
3. Provider auto-probe + composer chip + mock fallback.
4. Studio link + shared bundle + Validate-without-tokens guarantee in UX copy + runtime.
5. DX: `npm run desktop` (tauri:dev + sidecar); README desktop-first; brand icons wired.
6. Later: durable threads; palette entries for Cowork/Automations/Git.

## Out of scope (this cycle)

- Per-node canvas visual redesign.
- NSIS installer polish beyond icon stamp.
- New provider vendors beyond probe of existing CLIs/APIs.

## Success criteria

1. Launch **desktop** app → land on Chat with harness ON.
2. Send a message → see harness run (live via CLI if probed, else mock).
3. Open Studio → validate mock without token spend.
4. No user-visible string “Wallet”.
5. Taskbar / window icon matches `brand/` Nightwolf-style mark.
