"use client";
import { useCallback, useMemo } from "react";
import { pickChatProvider, type ChatProvider } from "@/components/agent/chatProvider";
import { missingProviderAction } from "@/components/providers/composerAction";
import { useProviderStore } from "@/components/providers/providerStore";
import { useShellStore } from "@/components/shell/shellStore";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";
import type { RequestMode } from "./contract";

export interface AssistProvider {
  /** `live` / `local` when a provider is ready, `mock` (offline) otherwise. */
  mode: RequestMode;
  connectionId: string | null;
  provider: ChatProvider | null;
  /** What to tell the person when no provider can answer; `null` once one can. */
  missing: { text: string; id: string | null } | null;
  /** Fix the missing provider in place, or open Providers when there is nothing concrete to fix. */
  requestSetup: () => void;
}

/**
 * Copilot and field assist answer with the provider the chat composer uses
 * (spec §3.4): same choice, same readiness rule, same words for what is
 * missing. An explicit but unavailable choice never falls back to another
 * connection; it falls back to the honest offline draft.
 */
export function useAssistProvider(): AssistProvider {
  const connections = useProviderStore((s) => s.connections);
  const chosenId = useChatProviderStore((s) => s.chosenId);
  const provider = useMemo(() => pickChatProvider(connections, chosenId), [connections, chosenId]);
  const missing = useMemo(() => missingProviderAction(connections, chosenId), [connections, chosenId]);

  const requestSetup = useCallback(() => {
    if (missing?.id) useChatSetupRequestStore.getState().requestSetup(missing.id);
    else useShellStore.getState().setSection("providers");
  }, [missing]);

  return {
    mode: provider ? provider.mode : "mock",
    connectionId: provider ? provider.id : null,
    provider,
    missing,
    requestSetup,
  };
}
