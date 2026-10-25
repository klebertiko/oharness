/**
 * Resolve the FastAPI sidecar base URL.
 *
 * Production (Tauri static export) has **no Next.js server** — rewrites and
 * `app/api/*` proxies do not exist. The UI talks to the sidecar on loopback.
 *
 * Preference order:
 *   1. `window.__OH_API__` — injected by the Tauri shell at startup
 *   2. `NEXT_PUBLIC_API_URL` / `OHARNESS_BACKEND_URL` (build-time / env)
 *   3. Default sidecar loopback (`http://127.0.0.1:8000`)
 */

declare global {
  interface Window {
    /** Injected by Tauri before the UI loads, e.g. `http://127.0.0.1:18765`. */
    __OH_API__?: string;
  }
}

const DEFAULT_SIDECAR = "http://127.0.0.1:8000";

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Absolute origin of the FastAPI sidecar (no trailing slash). */
export function apiBase(): string {
  if (typeof window !== "undefined" && typeof window.__OH_API__ === "string") {
    const injected = window.__OH_API__.trim();
    if (injected) return stripTrailingSlash(injected);
  }

  const env =
    process.env.NEXT_PUBLIC_API_URL?.trim() ||
    process.env.OHARNESS_BACKEND_URL?.trim() ||
    // Legacy name from before the OHarness rebrand.
    process.env.OPENHARNESS_BACKEND_URL?.trim();
  if (env) return stripTrailingSlash(env);

  return DEFAULT_SIDECAR;
}

/** Join sidecar base with a path that starts with `/`. */
export function apiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${apiBase()}${p}`;
}

/**
 * SEC-3 (harness Security Gate, 2026-09-11) — the sidecar now requires
 * `Authorization: Bearer <token>` on every route but /health
 * (backend/security/sidecar_token.py). Rather than touch every call site
 * that does `fetch(apiUrl(...))` across this codebase, `window.fetch` is
 * patched once, here, to inject that header on any request whose URL starts
 * with the sidecar's own origin — every existing and future call to the
 * sidecar gets authenticated automatically, with zero per-call-site changes.
 *
 * Token source, in order:
 *   1. `window.__OH_TOKEN__` — where a real Tauri-spawns-sidecar integration
 *      should inject it (not built yet; see next.config.ts's doc comment).
 *   2. `NEXT_PUBLIC_OH_SIDECAR_TOKEN` — baked in at `next dev`/`next build`
 *      time from the token file on this machine (next.config.ts). Covers
 *      today's actual setup: dev always talks to a sidecar already running
 *      locally.
 * Requests to any other origin (a repo provider's real API, a CDN, …) are
 * left untouched — this only ever adds the header for calls to this app's
 * own sidecar.
 */
declare global {
  interface Window {
    __OH_TOKEN__?: string;
  }
}

function sidecarToken(): string {
  if (typeof window !== "undefined" && typeof window.__OH_TOKEN__ === "string" && window.__OH_TOKEN__) {
    return window.__OH_TOKEN__;
  }
  return process.env.NEXT_PUBLIC_OH_SIDECAR_TOKEN?.trim() || "";
}

/**
 * SEC gate 2026-09-24 (gates/sec-fe-2026-09-24.md, P2-FE-2) — `url.startsWith
 * (apiBase())` was a string-prefix check, not an origin check. Userinfo
 * syntax defeats it: `http://127.0.0.1:8000@attacker.tld/x` starts with the
 * sidecar's origin character-for-character while the browser sends the
 * request to `attacker.tld`. Not exploitable while every connection is
 * hardcoded loopback, but `openai`/`ollama` connections have
 * `endpoint.editable: true` — one repointed endpoint away from leaking the
 * bearer token off-machine. `new URL(...).origin` normalizes userinfo,
 * path and query away, leaving only scheme+host+port to compare — the
 * property that actually decides where a request goes.
 */
function sameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url, typeof window !== "undefined" ? window.location.href : base).origin === new URL(base).origin;
  } catch {
    return false;
  }
}

if (typeof window !== "undefined" && !(window as unknown as { __ohFetchPatched__?: boolean }).__ohFetchPatched__) {
  (window as unknown as { __ohFetchPatched__?: boolean }).__ohFetchPatched__ = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (sameOrigin(url, apiBase())) {
      const token = sidecarToken();
      if (token) {
        const headers = new Headers(init?.headers ?? (typeof input === "object" && "headers" in input ? input.headers : undefined));
        headers.set("Authorization", `Bearer ${token}`);
        return nativeFetch(input, { ...init, headers });
      }
    }
    return nativeFetch(input, init);
  };
}
