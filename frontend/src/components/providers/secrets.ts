/**
 * Credential seam.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 *   A stored provider credential is never read back into the renderer.
 *
 * Not into React state, not into a controlled input's `value`, not into
 * localStorage, not into a redux devtools snapshot, not into an error string.
 * The renderer is the surface that will eventually display model-authored text
 * and third-party MCP tool output (ADR 0001), so it is treated as hostile to
 * secrets by construction rather than by discipline.
 *
 * What the renderer is allowed to hold is a **reference**: a service name plus
 * the small amount of the key a human needs to recognise which one it is — the
 * vendor prefix and the last four characters. That is what `SecretRef` is, and
 * it is deliberately not enough to authenticate with.
 *
 * WRITE PATH (the only time a plaintext key exists in the renderer)
 *
 *   1. The user pastes into a masked, uncontrolled <input type="password">.
 *   2. On submit the value goes straight to `saveSecret()` and the input is
 *      cleared. It is never lifted into component state on the way.
 *   3. `saveSecret()` hands it to the host and returns a `SecretRef`.
 *   4. The UI states, in plain words, that it will not be shown again.
 *
 * HOST BINDINGS, in preference order
 *
 *   a. Backend (`POST /providers/{id}/secret`) — the FastAPI sidecar holds the
 *      secret in its own SecretsStore (desktop: `OH_SECRETS=file` under the app
 *      data dir, see backend/sidecar_entry.py) and is the store every probe and
 *      run reads from. Used in the desktop shell and the browser dev build
 *      alike; the renderer never sees the key again. There is no Tauri keychain
 *      command: a key saved anywhere the sidecar can't read is unusable.
 *   b. Memory — this file's fallback. Process-lifetime only, deliberately NOT
 *      persisted. A refresh loses it, which is correct: a dev fallback that
 *      quietly persisted secrets would be the exact bug this seam prevents.
 *
 * Nothing here ever touches `localStorage` or `sessionStorage`. If you are
 * editing this file and reaching for either, stop.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { apiUrl } from "@/lib/apiBase";

export type SecretVault = "os-keychain" | "backend" | "memory";

export interface SecretRef {
  /** Keychain service key, e.g. `oharness/openrouter`. Not a secret. */
  service: string;
  /** Vendor prefix as pasted, e.g. `sk-ant-`. Public by design. */
  prefix: string;
  /** Last four characters. Enough to recognise, not enough to use. */
  tail: string;
  /** Original character count — lets the seal render at true length. */
  length: number;
  vault: SecretVault;
  savedAt: string;
}

export function activeVault(): SecretVault {
  return "backend";
}

export const VAULT_LABEL: Record<SecretVault, string> = {
  "os-keychain": "OS keychain",
  backend: "backend process",
  memory: "session memory",
};

function connectionIdFromService(service: string): string {
  return service.startsWith("oharness/") ? service.slice("oharness/".length) : service;
}

/** Does a pasted value plausibly belong to this vendor? Empty/short input
    passes (nothing to contradict yet) so the warning only fires once there's
    enough text to actually disagree with `expected`. Shared by the Dossier's
    full credential entry (`CredentialSeal.tsx`) and the chat combo's inline
    setup (`ChatProviderPicker.tsx`) so the two surfaces never drift to
    different validation wording for the same mistake. */
export function prefixMatches(value: string, expected?: string): boolean {
  return !expected || value.length < expected.length || value.startsWith(expected);
}

function recognisePrefix(value: string): string {
  // Longest known vendor prefix wins, so `sk-ant-` is not reported as `sk-`.
  return (
    ["sk-ant-", "sk-or-", "crsr_", "sk-proj-", "sk-"].find((p) => value.startsWith(p)) ?? ""
  );
}

function toRef(service: string, value: string, vault: SecretVault): SecretRef {
  return {
    service,
    prefix: recognisePrefix(value),
    tail: value.slice(-4),
    length: value.length,
    vault,
    savedAt: new Date().toISOString(),
  };
}

/**
 * Ensure a connection row exists so POST /providers/{id}/secret does not 404.
 * Best-effort: 409 (already exists) is success.
 */
async function ensureBackendConnection(connectionId: string): Promise<void> {
  const provider = connectionId.replace(/-local$|-cloud$/, "") || connectionId;
  const res = await fetch(apiUrl("/providers/connections"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: connectionId,
      provider,
      label: connectionId,
      residence: connectionId.endsWith("-local") ? "local" : "cloud",
      endpoint: "",
      enabled: false,
    }),
  });
  if (res.ok || res.status === 409) return;
  // Leave failure for the secret POST to surface.
}

/** Hand the key to FastAPI once; return the opaque secretRef string or null. */
async function saveViaBackend(service: string, value: string): Promise<string | null> {
  const connectionId = connectionIdFromService(service);
  const post = () =>
    fetch(apiUrl(`/providers/${encodeURIComponent(connectionId)}/secret`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: value }),
    });

  let res = await post();
  if (res.status === 404) {
    await ensureBackendConnection(connectionId);
    res = await post();
  }
  if (!res.ok) return null;
  const body = (await res.json()) as { secretRef?: string };
  return typeof body.secretRef === "string" ? body.secretRef : null;
}

/**
 * The only function in the app that accepts a plaintext credential.
 * Takes the value, returns a reference, and drops the value on the floor.
 */
export async function saveSecret(service: string, plaintext: string): Promise<SecretRef> {
  const value = plaintext.trim();
  if (!value) throw new Error("empty credential");

  // No renderer-side fallback: a key the sidecar did not take is not stored
  // anywhere, and the caller says so. (It used to be parked in a JS Map here —
  // outside the SecretsStore boundary, and reported as if it were saved.)
  let secretRef: string | null;
  try {
    secretRef = await saveViaBackend(service, value);
  } catch {
    throw new Error("Couldn't reach the OHarness sidecar, so the key was not stored.");
  }
  if (!secretRef) throw new Error("The sidecar refused the key, so it was not stored.");
  return toRef(secretRef, value, "backend");
}

/** Nothing renderer-side to forget any more — the sidecar's
    DELETE /providers/{id}/secret is what removes a key. Kept so callers have
    one place to hook if a local cache ever returns. */
export async function forgetSecret(service: string): Promise<void> {
  void service;
}

/**
 * There is no `getSecret`. This is not an oversight — see the header. Anything
 * that needs the value runs host-side and asks the vault itself.
 */
export function assertNoReadPath(): never {
  throw new Error("credentials are never read back into the renderer");
}
