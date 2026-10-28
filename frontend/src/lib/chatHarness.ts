/**
 * What "the harness of a chat" means (ADR 0011): a setting of the conversation
 * that applies to its *next* turns. It is neither frozen at the first message
 * nor chosen per run. Every reply records the harness that produced it, so
 * history never changes when the setting does.
 */
import type { HarnessBundle } from "@/store/harnessSessionStore";

export type ThreadHarness = { kind: "none" } | { kind: "harness"; id: string; name: string };

export const NO_HARNESS: ThreadHarness = { kind: "none" };

export type HarnessStatus =
  | { state: "none" }
  | { state: "ready"; id: string; name: string }
  | { state: "loading"; id: string; name: string }
  | { state: "missing"; id: string; name: string };

/** The in-app session choice (what a new chat starts with) as a binding. */
export function harnessFromSession(enabled: boolean, bundle: HarnessBundle | null): ThreadHarness {
  const id = bundle?.manifest?.id;
  if (!enabled || !id) return NO_HARNESS;
  return { kind: "harness", id, name: bundle.manifest.name || id };
}

/** Is the harness a chat points at still there? Never "missing" while the library is still loading. */
export function resolveHarness(binding: ThreadHarness, available: { id: string; name: string }[], libraryReady: boolean): HarnessStatus {
  if (binding.kind === "none") return { state: "none" };
  const found = available.find((h) => h.id === binding.id);
  if (found) return { state: "ready", id: found.id, name: found.name || binding.name };
  return { state: libraryReady ? "missing" : "loading", id: binding.id, name: binding.name };
}

export const sameHarness = (a: ThreadHarness, b: ThreadHarness) =>
  a.kind === b.kind && (a.kind === "none" || (b.kind === "harness" && a.id === b.id));

export const harnessLabel = (h: ThreadHarness) => (h.kind === "none" ? "No harness" : h.name);

export const switchNotice = (_from: ThreadHarness | undefined, to: ThreadHarness) =>
  `Harness changed to ${harnessLabel(to)}. It applies from your next message; earlier replies stay as they were.`;
