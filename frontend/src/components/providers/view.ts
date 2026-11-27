import { isChatCapable, providerReadiness, type ChatProviderTone, type ProviderReadiness } from "@/components/agent/chatProvider";
import type { StatusTone } from "@/components/ui";
import { tr } from "@/i18n/store";
import type { MessageKey } from "@/i18n/translate";
import { closestToReady, distanceToReady, nextStep, type NextStep } from "./nextStep";
import { specOf, type Connection } from "./providerStore";

/**
 * What the Providers screen shows about one connection, derived once and read
 * by the list, the header and the tests alike. Readiness and the one next
 * step come from `providerReadiness` and `nextStep` (ADRs 0013 to 0016); this
 * file only decides the words, the marker and the group, so a connection never
 * reads two ways on one screen.
 */
export type ConnectionGroup = "action" | "ready" | "agents" | "all";

export type ConnectionView = {
  connection: Connection;
  readiness: ProviderReadiness;
  step: NextStep | null;
  /** The one status word. */
  status: string;
  tone: StatusTone;
  /** Text colour class for the status word (state colour only through its text form). */
  text: string;
  group: ConnectionGroup;
};

const MARK: Record<ChatProviderTone, StatusTone> = {
  verified: "ok",
  attention: "warn",
  failing: "fault",
  checking: "busy",
  unverified: "idle",
  unconfigured: "off",
};

const TEXT: Record<ChatProviderTone, string> = {
  verified: "text-ink",
  attention: "text-warn-text",
  failing: "text-fault-text",
  checking: "text-ink-dim",
  unverified: "text-ink-dim",
  unconfigured: "text-ink-mute",
};

const groupOf = (c: Connection, readiness: ProviderReadiness): ConnectionGroup =>
  readiness.ready ? "ready" : isChatCapable(c) ? "action" : "agents";

/** `offline`: the sidecar did not answer, so nothing here is evidence. The rows are the catalogue, and none of them claims to be connected or not. */
export function viewOf(c: Connection, offline = false): ConnectionView {
  const readiness = providerReadiness(c);
  if (offline) {
    return { connection: c, readiness, step: null, status: tr("status.cantCheck"), tone: "idle", text: "text-ink-mute", group: "all" };
  }
  const step = nextStep(c);
  return {
    connection: c,
    readiness,
    step,
    status: step?.status ?? readiness.label,
    tone: MARK[readiness.tone],
    text: TEXT[readiness.tone],
    group: groupOf(c, readiness),
  };
}

export const GROUP_ORDER: ConnectionGroup[] = ["action", "ready", "agents", "all"];

export const GROUP_LABEL: Record<ConnectionGroup, MessageKey> = {
  action: "list.group.action",
  ready: "list.group.ready",
  agents: "list.group.agents",
  all: "list.group.all",
};

/** Views grouped and ordered: "Needs action" nearest-to-ready first (the order the chat combo uses, ADR 0016), the rest in catalogue order. */
export function groupViews(connections: Connection[], offline = false): { group: ConnectionGroup; views: ConnectionView[] }[] {
  const views = connections.map((c) => viewOf(c, offline));
  return GROUP_ORDER.map((group) => {
    const inGroup = views.filter((v) => v.group === group);
    if (group === "action") inGroup.sort((a, b) => (distanceToReady(a.connection) ?? 9) - (distanceToReady(b.connection) ?? 9));
    return { group, views: inGroup };
  }).filter((g) => g.views.length > 0);
}

/** The connection the detail shows when the person has not picked one: the one nearest to answering, else the first. */
export function defaultConnectionId(connections: Connection[]): string {
  return (closestToReady(connections) ?? connections[0])?.id ?? "";
}

/** One plain word for the kind of account, instead of where it runs and how it is billed. */
export function accountKind(c: Connection): MessageKey {
  const kind = specOf(c).credential.kind;
  if (kind === "cli") return "providers.account.subscription";
  if (kind === "api-key") return "providers.account.apiKey";
  if (c.residence === "local") return "providers.account.local";
  return "providers.account.endpoint";
}

export function metaLine(c: Connection): string {
  return tr(accountKind(c));
}

/** Accounts other than `exceptId` that could answer a chat turn right now: where "Use another account" can go. */
export function otherReadyAccounts(connections: Connection[], exceptId: string): Connection[] {
  return connections.filter((c) => c.id !== exceptId && isChatCapable(c) && providerReadiness(c).ready);
}
