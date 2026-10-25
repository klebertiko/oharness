import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

/**
 * Static export for the Tauri webview (ADR 0001).
 *
 * Production has **no Next.js server**: no rewrites, no `app/api` proxies.
 * The UI talks to the FastAPI sidecar via `src/lib/apiBase.ts`
 * (`window.__OH_API__` or loopback). Dev (`next dev`) also uses apiBase →
 * sidecar; optional reference proxies live under `dev-proxies/` (not built).
 *
 * SEC-3 (harness Security Gate, 2026-09-11) — the sidecar now requires
 * `Authorization: Bearer <token>` on every route but /health
 * (backend/security/sidecar_token.py). This is the dev-only half of getting
 * that token to the browser: read the same file the backend persists it to
 * (`%LOCALAPPDATA%/OHarness/sidecar.token`) once, at `next dev`/`next
 * build` start, and bake it into the client bundle as
 * `NEXT_PUBLIC_OH_SIDECAR_TOKEN` — read by `src/lib/apiAuth.ts`. This works
 * today because dev always talks to a sidecar already running on this same
 * machine. It is NOT the production design: the packaged desktop build
 * doesn't yet spawn the sidecar as a Tauri-managed child at all (no
 * `externalBin` in src-tauri/tauri.conf.json), and when that integration is
 * built, Tauri's Rust side should generate this token and inject it into
 * the webview directly (the same way `window.__OH_API__` already is) —
 * never bake a token into a static-exported bundle shipped to users.
 */
function readSidecarTokenForDev(): string {
  try {
    const base = process.env.LOCALAPPDATA || os.homedir();
    const tokenPath = path.join(base, "OHarness", "sidecar.token");
    return fs.readFileSync(tokenPath, "utf-8").trim();
  } catch {
    // Backend hasn't run yet on this machine — no token to bake in. API
    // calls will 401 until the backend has started at least once and the
    // frontend dev server is restarted.
    return "";
  }
}

export default function nextConfig(phase: string): NextConfig {
  return {
    output: "export",
    reactStrictMode: true,
    images: { unoptimized: true },
    env: {
      // Production receives a per-process token from Tauri's initialization
      // script. Never bake a developer-machine token into shipped assets.
      NEXT_PUBLIC_OH_SIDECAR_TOKEN: phase === PHASE_DEVELOPMENT_SERVER ? readSidecarTokenForDev() : "",
    },
    devIndicators: { buildActivity: false, appIsrStatus: false },
  };
}
