import { isChatCapable, providerReadiness } from "@/components/agent/chatProvider";
import type { Connection } from "./providerStore";

/** Drag the preferred account to the front. The engine walks this order. */
export function movePreference(ids: string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = ids.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Accounts that can answer a chat now, in the saved order (ranked first), the rest in list order after them. */
export function accountOrder(connections: Connection[]): Connection[] {
  const ready = connections.filter((c) => isChatCapable(c) && providerReadiness(c).ready);
  const rankOf = (c: Connection) => (typeof c.rank === "number" ? c.rank : Number.POSITIVE_INFINITY);
  return ready
    .map((c, index) => ({ c, index }))
    .sort((a, b) => rankOf(a.c) - rankOf(b.c) || a.index - b.index)
    .map(({ c }) => c);
}

/** True once a person saved an order: the sidecar then falls back along it. */
export function hasSavedOrder(connections: Connection[]): boolean {
  return connections.filter((c) => typeof c.rank === "number").length >= 2;
}
