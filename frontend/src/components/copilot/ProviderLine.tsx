"use client";
import { useEffect, useState } from "react";
import { ChatProviderPicker } from "@/components/agent/ChatProviderPicker";
import { chatProviderStatus } from "@/components/agent/chatProvider";
import { useProviderStore } from "@/components/providers/providerStore";
import { useShellStore } from "@/components/shell/shellStore";
import { useAssistProvider } from "@/lib/copilot/useAssistProvider";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";

/**
 * Which provider Copilot and Assist will use, as one quiet line. Clicking it
 * opens the same picker the chat composer has, so a provider is chosen and
 * fixed in one place everywhere. With none ready, the line offers the honest
 * offline draft instead of a dead end.
 */
export function ProviderLine({ onUseOffline, canUseOffline }: { onUseOffline: () => void; canUseOffline: boolean }) {
  const { provider } = useAssistProvider();
  const connection = useProviderStore((s) => s.connections.find((c) => c.id === provider?.id));
  const setSection = useShellStore((s) => s.setSection);
  const setupToken = useChatSetupRequestStore((s) => s.token);
  const [expanded, setExpanded] = useState(false);

  // A setup request raised anywhere (the composer's missing-provider action) opens the picker here.
  useEffect(() => {
    if (setupToken > 0) setExpanded(true);
  }, [setupToken]);

  if (!provider) {
    return (
      <div className="flex items-center justify-between gap-2 border-b border-line-soft px-3 py-1.5">
        <span className="t-meta text-ink-mute">No provider ready</span>
        <button
          type="button"
          disabled={!canUseOffline}
          onClick={onUseOffline}
          className="h-6 rounded-control border border-line px-2 text-body text-ink hover:bg-sub-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal disabled:cursor-not-allowed disabled:opacity-40"
        >
          Use offline draft
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-line-soft px-3 py-1.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => {
          if (expanded) {
            setExpanded(false);
            return;
          }
          // Mounting the picker with a request pending opens its menu straight away.
          useChatSetupRequestStore.getState().requestSetup(null);
          setExpanded(true);
        }}
        className="t-meta text-ink-mute hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
      >
        Answers with {provider.label} · {connection ? chatProviderStatus(connection) : "Unavailable"}
      </button>
      {expanded && (
        <div className="mt-1.5">
          <ChatProviderPicker onConnect={() => setSection("providers")} />
        </div>
      )}
    </div>
  );
}
