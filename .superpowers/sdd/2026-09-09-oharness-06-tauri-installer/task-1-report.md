# Task 1 report — Next static export

## Done

- `frontend/next.config.ts`: `output: "export"`, `images.unoptimized`, rewrites removed (incompatible with export).
- `frontend/src/lib/apiBase.ts`: resolves API via `window.__OH_API__` → env → `http://127.0.0.1:8000`.
- All clients (`bundlesApi`, `reposApi`, `coworkApi`, `automationsApi`, `runClient`, `api.ts`, stores, `page.tsx` health, `secrets.ts`) use `apiUrl()`.
- Former `app/api/*` proxies moved to `frontend/dev-proxies/` (reference only; not built).
- Backend CORS widened for Tauri / local static origins.
- `/dev/v/[slot]` gained `generateStaticParams` via layout for static export.

## Verify

```text
npm run build  →  Exporting succeeded; frontend/out/index.html present
```

## Documented constraint

**Production has no Next.js server.** Packaged UI is static files in the Tauri webview; the FastAPI sidecar is the only HTTP server.

## Smoke / HITL

Not run — browser/Tauri smoke left for HITL.
