import { specOf, type Connection } from "@/components/providers/providerStore";
import { requiresModel } from "@/components/providers/catalog";

/** Can this connection answer a chat turn at all? Agent-only connections
    (Cursor) have no chat adapter in the sidecar — offering them in a chat
    picker, or letting Auto land on one, only produces a run that fails. */
export function isChatCapable(c: Connection): boolean {
  // An id this catalog does not know (a stray or newer row) is not ruled out
  // here — the sidecar still has the final word when a run resolves it.
  return specOf(c)?.capabilities.includes("chat") ?? true;
}

/** An HTTP connection (Ollama, OpenRouter) with no default model: the
    sidecar refuses every run on it until one is chosen. */
export function needsModel(c: Connection): boolean {
  const spec = specOf(c);
  return Boolean(spec) && requiresModel(spec) && !c.defaultModel;
}

export type ChatProvider = {
  /** The real connection id this resolves to, whether picked or Auto — the
      harness graph needs a concrete id to fall back to per unpinned node
      (see backend/providers/resolution.py); "Auto" is a display choice, not
      an absence of one. */
  id: string;
  /** Human name shown next to the composer. */
  label: string;
  /** How the run reaches it — never "mock". Cloud → live, on-device → local. */
  mode: "live" | "local";
  /** True when this came from the person's pick, not the Auto fallback. */
  chosen: boolean;
};

/** Six real states a connection can be in, each earning its own visual tone.
    Deliberately keeps "a credential that was tried and rejected" (failing)
    distinct from "nobody has configured or turned this on yet"
    (unconfigured) — collapsing those two into one undifferentiated word was
    the exact bug this type exists to fix. */
export type ChatProviderTone = "verified" | "unverified" | "checking" | "attention" | "failing" | "unconfigured";

/** The one place that decides whether a connection is connected. Every surface
    (Providers list + dossier + credential seal, the chat picker, Studio node
    summaries) reads this instead of mixing `enabled` / `health` / `secret` on
    its own - two surfaces reading different fields is how a provider could
    read "connected" in one panel and sit under "Needs setup" in the other.

    `enabled` is the backend's own authority on usable (the gate
    resolve_node_provider() applies to a run), so it alone decides `ready`;
    health is evidence layered on top and can only *remove* readiness
    (`fault`) or add `verified`. A passing probe on a turned-off connection is
    therefore never "connected". */
export type ProviderReadiness = {
  /** ready = can answer a run now · off = has what it needs but is switched
      off · needs-setup = nothing configured yet · fault = a probe failed. */
  state: "ready" | "needs-setup" | "off" | "fault" | "needs-model";
  /** Eligible to answer a run (enabled and not faulted). */
  ready: boolean;
  /** Ready AND the last probe said live/degraded. */
  verified: boolean;
  /** Status word (same strings `rowStatus` always returned). */
  label: string;
  tone: ChatProviderTone;
  /** What the person still has to do, or null when nothing. */
  missing: "credential" | "turn-on" | "fix-failure" | "model" | null;
};

export function providerReadiness(c: Connection): ProviderReadiness {
  const label = rowStatus(c);
  const tone = rowTone(c);
  if (c.health === "fault") {
    return { state: "fault", ready: false, verified: false, label, tone, missing: "fix-failure" };
  }
  if (!c.enabled) {
    const needsKey = specOf(c).credential.kind === "api-key" && !c.secret;
    return {
      state: needsKey ? "needs-setup" : "off",
      ready: false,
      verified: false,
      label,
      tone,
      missing: needsKey ? "credential" : "turn-on",
    };
  }
  if (needsModel(c)) {
    return { state: "needs-model", ready: false, verified: false, label, tone, missing: "model" };
  }
  return {
    state: "ready",
    ready: true,
    verified: c.health === "live" || c.health === "degraded",
    label,
    tone,
    missing: null,
  };
}

/** Why a probe failed, as far as the probe's own text lets us say. The table of
    every `detail` the adapters emit, and why each maps where it does, lives in
    docs/adr/0009-probe-detail-classification.md and is locked on the backend by
    tests/test_probe_detail_contract.py; these rules must stay in step with it. */
export type ProviderFaultClass =
  | "key-rejected"
  | "unreachable"
  | "rate-limited"
  | "out-of-credits"
  | "cli-signin"
  | "cli-missing"
  | "unknown";

const FAULT_BY_STATUS: Record<number, ProviderFaultClass> = {
  401: "key-rejected",
  403: "key-rejected",
  402: "out-of-credits",
  429: "rate-limited",
};

/** The single place a probe's `detail` becomes a class. Pure: only `health`
    and `detail` are read. A CLI that is missing or signed out reports
    `health: "setup"`, an HTTP failure `health: "fault"`; text that matches
    nothing is `unknown` (never a guess at a nearby class), and a connection
    that is neither faulted nor waiting on a CLI has no fault at all. */
export function providerFault(c: Pick<Connection, "health" | "detail">): ProviderFaultClass | null {
  const text = (c.detail ?? "").trim().toLowerCase();
  if (c.health === "setup") {
    if (text.includes(" cli not found on path.")) return "cli-missing";
    if (text.includes(" cli is installed but not logged in.")) return "cli-signin";
    return null;
  }
  if (c.health !== "fault") return null;
  const status = /^http (\d{3}) from /.exec(text);
  if (status) return FAULT_BY_STATUS[Number(status[1])] ?? "unknown";
  if (text.startsWith("401 unauthorized")) return "key-rejected";
  if (/^could not reach \S+\.$/.test(text) || /^\S+ did not respond in time\.$/.test(text)) return "unreachable";
  return "unknown";
}

const modeOf = (c: Connection): "live" | "local" => (c.residence === "cloud" ? "live" : "local");

/** The first connection ready to answer: a live cloud one wins, else a live
    local one. `enabled` is the backend's own authority on usable — the same
    gate resolve_node_provider() checks for a run — not "live", which is only
    ever set by a Test click this browser session happened to make. Requiring
    "live" would force a fresh reload to look disconnected until re-tested. */
function autoPick(connections: Connection[]): Connection | null {
  const ready = connections.filter((c) => isChatCapable(c) && providerReadiness(c).ready);
  return ready.find((c) => c.residence === "cloud") ?? ready.find((c) => c.residence === "local") ?? null;
}

/**
 * Chat is always a real conversation — never a mock. It runs against the
 * provider the person picked in the composer chip (`chosenId`). Only Auto
 * resolves another connection. An unavailable explicit choice returns null,
 * preserving the person's routing decision. The composer then asks
 * the person to connect one instead of faking an answer.
 */
export function pickChatProvider(connections: Connection[], chosenId?: string | null): ChatProvider | null {
  if (chosenId) {
    const c = connections.find((x) => x.id === chosenId && isChatCapable(x) && providerReadiness(x).ready);
    if (c) return { id: c.id, label: c.label, mode: modeOf(c), chosen: true };
    return null;
  }
  const auto = autoPick(connections);
  return auto ? { id: auto.id, label: auto.label, mode: modeOf(auto), chosen: false } : null;
}


/** Probe evidence is distinct from enabled eligibility and the person's choice. */
export function chatProviderStatus(connection: Connection): string {
  if (!connection.enabled || connection.health === "fault") return "Unavailable";
  if (connection.health !== "probing" && needsModel(connection)) return "No model chosen";
  switch (connection.health) {
    case "live": return "Verified";
    case "probing": return "Checking connection";
    case "degraded": return "Needs attention";
    case "setup": return "Not verified";
  }
}

/** The row-level leading word. `chatProviderStatus` above stays untouched
    (piece 1's trigger chip already pins its 5 return strings) — this adds
    the one new distinction the dropdown needs: a real fault always outranks
    "not enabled" as more specific evidence (a credential WAS tried and
    rejected, not merely left off), so only a non-fault, disabled connection
    reads as "Not connected" instead of "Unavailable". Exported: the
    Providers screen (`ProvidersList.tsx`, `Dossier.tsx`) reads the same
    function so a connection never wears two different status words
    depending which surface you're looking at it from. */
export function rowStatus(connection: Connection): string {
  if (!connection.enabled && connection.health !== "fault") return "Not connected";
  return chatProviderStatus(connection);
}

/** Same priority as `rowStatus`, expressed as a tone for the row's dot. */
export function rowTone(connection: Connection): ChatProviderTone {
  if (connection.health === "fault") return "failing";
  if (!connection.enabled) return "unconfigured";
  if (connection.health !== "probing" && needsModel(connection)) return "attention";
  switch (connection.health) {
    case "live": return "verified";
    case "probing": return "checking";
    case "degraded": return "attention";
    case "setup": return "unverified";
  }
}

/** What the composer tells the person when `pickChatProvider` came back null —
    never a bare "Unavailable" (design.md § Provider stance). Returns null
    once a provider actually resolves, so a caller can render this in place
    of the send affordance without a separate `!provider` check drifting out
    of sync. Credential shape comes from the catalog (`specOf`), not a
    hardcoded vendor list, so a future provider gets the right verb for free:
    `api-key` → paste a key, anything else (`cli` session or `none`) → an
    on/off switch, nothing to type. `id` is the connection this action would
    expand inline setup for — null when there is nothing concrete to expand
    (nothing chosen, or an explicit choice that no longer exists), in which
    case the caller should just open the combo. */
export function missingProviderAction(
  connections: Connection[],
  chosenId?: string | null,
): { text: string; id: string | null } | null {
  if (pickChatProvider(connections, chosenId)) return null;
  const target = chosenId ? connections.find((c) => c.id === chosenId) : null;
  if (!target || !isChatCapable(target)) {
    return { text: chosenId ? "Pick a provider to send" : "Connect a provider to send", id: null };
  }
  if (providerReadiness(target).missing === "model") {
    return { text: `Choose a model for ${target.label} to send`, id: target.id };
  }
  const spec = specOf(target);
  const article = /^[aeiou]/i.test(spec.vendor) ? "an" : "a";
  const verb =
    spec.credential.kind === "api-key" ? `Paste ${article} ${spec.vendor} key` : `Turn on ${target.label}`;
  return { text: `${verb} to send`, id: target.id };
}

/** Auto names its resolved connection; every other row states its own evidence. */
export function chatProviderOptions(connections: Connection[]) {
  const auto = autoPick(connections);
  return [
    {
      id: null as string | null,
      label: "Auto",
      detail: auto ? "Uses " + auto.label + " · " + chatProviderStatus(auto) : "No available provider",
      ready: Boolean(auto),
      tone: auto ? rowTone(auto) : ("unconfigured" as ChatProviderTone),
    },
    ...connections.filter(isChatCapable).map((c) => ({
      id: c.id as string | null,
      label: c.label,
      detail: rowStatus(c) + " · " + (
        c.health === "fault" ? "Test failed" :
        c.residence === "cloud" ? "Cloud" : "On-device"
      ),
      ready: providerReadiness(c).ready,
      tone: rowTone(c),
    })),
  ];
}
