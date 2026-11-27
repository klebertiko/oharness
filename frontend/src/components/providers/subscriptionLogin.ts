import { apiUrl } from "@/lib/apiBase";
import { specOf, type Connection } from "./providerStore";

export const LOGIN_POLL_MS = 2000;
export const LOGIN_POLL_LIMIT_MS = 5 * 60 * 1000;

const CLI_ID: Record<string, string> = {
  "claude login": "claude",
  "codex login": "codex",
  "cursor-agent login": "cursor",
};

export function loginCliId(connection: Connection): string | null {
  const login = specOf(connection).credential.login;
  return login ? CLI_ID[login] ?? null : null;
}

export type LoginDecision = "wait" | "signed-in" | "timeout" | "cancelled";

export function decideLogin(elapsedMs: number, signedIn: boolean, cancelled: boolean): LoginDecision {
  if (cancelled) return "cancelled";
  if (signedIn) return "signed-in";
  if (elapsedMs >= LOGIN_POLL_LIMIT_MS) return "timeout";
  return "wait";
}

export function readSignedIn(body: { clis?: { id?: string; loggedIn?: boolean; signed_in?: boolean }[] } | null, cliId: string): boolean {
  const row = body?.clis?.find((cli) => cli.id === cliId);
  return row?.signed_in === true || row?.loggedIn === true;
}

/** Why a sign-in did not start. An unreachable sidecar or an unexpected reply counts as `not-started`. */
export type LoginRefusal = "not-started" | "not-installed";
export type LoginStart = { ok: true; id: string } | { ok: false; reason: LoginRefusal };

export async function requestLogin(cliId: string): Promise<LoginStart> {
  try {
    const res = await fetch(apiUrl(`/providers/clis/${encodeURIComponent(cliId)}/login`), { method: "POST" });
    const body = (await res.json()) as { id?: unknown; reason?: unknown };
    if (res.ok && typeof body.id === "string") return { ok: true, id: body.id };
    return { ok: false, reason: body.reason === "not-installed" ? "not-installed" : "not-started" };
  } catch {
    return { ok: false, reason: "not-started" };
  }
}

export async function cancelLoginRequest(sessionId: string): Promise<void> {
  await fetch(apiUrl(`/providers/clis/login/${encodeURIComponent(sessionId)}`), { method: "DELETE" }).catch(() => undefined);
}
