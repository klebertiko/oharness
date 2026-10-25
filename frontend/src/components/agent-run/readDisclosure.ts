"use client";
import { create } from "zustand";
import type { Connection } from "@/components/providers/providerStore";
import type { ToolCall } from "./types";

/* ── Read disclosure (chat tools broker, threat-model T3 / contract v1.1) ──
   The moment a `read` result exists it is about to be fed back to the model.
   On a remote provider that means the file's content leaves this machine.
   Say so, in words, naming the provider — once per provider per session, so
   the sentence stays a disclosure and never decays into wallpaper. */

export type DisclosureConnection = Pick<Connection, "provider" | "residence">;

const READ_TOOLS = new Set(["read", "read_file"]);

/** The sentence to show for this call on this connection, or null when there
    is nothing to disclose: local provider, not a read, or no result yet. */
export function readDisclosure(connection: DisclosureConnection | null | undefined, call: ToolCall): string | null {
  if (!connection || connection.residence === "local") return null;
  if (!READ_TOOLS.has(call.name)) return null;
  if (call.ok !== true && call.result === undefined) return null;
  return `files it reads are sent to ${connection.provider}`;
}

interface ReadDisclosureState {
  seen: string[];
  disclosed: (provider: string) => boolean;
  markDisclosed: (provider: string) => void;
  reset: () => void;
}

/** Session memory of which providers have already been disclosed. Not
    persisted on purpose: a new session gets the sentence again. */
export const useReadDisclosureStore = create<ReadDisclosureState>((set, get) => ({
  seen: [],
  disclosed: (provider) => get().seen.includes(provider),
  markDisclosed: (provider) =>
    set((s) => (s.seen.includes(provider) ? s : { seen: [...s.seen, provider] })),
  reset: () => set({ seen: [] }),
}));
