"use client";

import { useEffect, useMemo, useState } from "react";

import {
  chatProviderOptions,
  isChatCapable,
  pickChatProvider,
  providerReadiness,
  rowStatus,
  type ChatProviderTone,
} from "@/components/agent/chatProvider";
import { formatRelativeTime } from "@/lib/time";
import { useProviderStore } from "@/components/providers/providerStore";
import { ComboAction, Combobox, type ComboOption } from "@/components/ui/Combobox";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";

/** Dropdown-row dot per tone. A distinct pulsing "checking" state, and a
 * hollow ring for "unconfigured" — never the same filled dot as "failing",
 * so a credential that was tried and rejected never looks like a connection
 * nobody has configured yet.
 */
function toneDotClass(tone: ChatProviderTone): string {
  switch (tone) {
    case "verified": return "bg-signal";
    case "attention": return "bg-warn";
    case "checking": return "bg-ink-faint animate-pulse";
    case "failing": return "bg-fault";
    case "unverified": return "bg-ink-faint";
    case "unconfigured": return "border border-ink-faint";
  }
}

/** Option id for "Auto" — no connection id is empty. */
const AUTO_ID = "";

/* Hallmark · component: provider picker · design-system: design.md
 * Built on the shared Combobox. The list answers one question — "which
 * connection answers this chat?" — so it holds Auto and the connections that
 * can answer right now. Anything still to configure lives on the Providers
 * screen; the footer says how many and goes there (design.md § Provider
 * stance: one place to fix a connection, no second setup form to keep honest).
 */
export function ChatProviderPicker({ onConnect, disabled = false }: { onConnect: () => void; disabled?: boolean }) {
  const connections = useProviderStore((s) => s.connections);
  const selectConnection = useProviderStore((s) => s.select);
  const chosenId = useChatProviderStore((s) => s.chosenId);
  const setChosen = useChatProviderStore((s) => s.setChosen);
  const setupRequestToken = useChatSetupRequestStore((s) => s.token);
  const setupRequestId = useChatSetupRequestStore((s) => s.id);
  const provider = useMemo(() => pickChatProvider(connections, chosenId), [connections, chosenId]);

  const { rows, needSetup } = useMemo(() => {
    const all = chatProviderOptions(connections);
    const [auto, ...rest] = all;
    // Auto + what can answer now. A choice that has since stopped being ready
    // (or vanished) stays listed so the selection is never invisible.
    const usable = rest.filter((r) => r.ready || r.id === chosenId);
    if (chosenId && !usable.some((r) => r.id === chosenId)) {
      usable.push({ id: chosenId, label: "Unavailable provider", detail: "Connection no longer available", ready: false, tone: "unconfigured" });
    }
    return {
      rows: [auto, ...usable],
      needSetup: rest.filter((r) => !r.ready).length,
    };
  }, [connections, chosenId]);
  const readyCount = rows.filter((r) => r.id !== null && r.ready).length;

  const connection = connections.find((c) => c.id === (chosenId ?? provider?.id));
  const status = connection ? rowStatus(connection) : "Unavailable";
  const label = chosenId
    ? connection?.label ?? "Unavailable provider"
    : provider ? "Auto · " + provider.label : "Auto · No available provider";
  // One readiness rule app-wide: the chip's dot reads the same tone the
  // dropdown rows do, instead of re-deriving it from status text.
  const readiness = connection ? providerReadiness(connection) : null;
  const dotClass = toneDotClass(readiness?.tone ?? "unconfigured");
  // Real evidence only: an unprobed connection never grows a timestamp.
  const lastChecked = connection?.lastProbe ? "checked " + formatRelativeTime(connection.lastProbe) : null;
  const model = provider && connection?.defaultModel ? connection.defaultModel : null;
  // Auto that resolves to nothing has no status of its own to add.
  const unresolvedAuto = !chosenId && !provider;
  const statusLine = unresolvedAuto
    ? label
    : label + " · " + status + (model ? " · " + model : "") + (lastChecked ? " · " + lastChecked : "");
  const chipText = unresolvedAuto ? label : label + " · " + status;

  const [open, setOpen] = useState(false);

  const options: ComboOption[] = rows.map((r) => ({
    id: r.id ?? AUTO_ID,
    label: r.label,
    detail: r.detail,
    leading: <span className={"h-1.5 w-1.5 flex-none rounded-full " + toneDotClass(r.tone)} aria-hidden />,
  }));

  const goToProviders = (id: string | null) => {
    if (id && connections.some((c) => c.id === id)) selectConnection(id);
    setOpen(false);
    onConnect();
  };

  // An external control (the composer's "what's missing" action) asked for
  // setup. A named connection is fixed on the Providers screen; with no name
  // there is nothing to open, so show the list. `token` fires even on a
  // repeat request for the same id.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Fires only when a new setup request arrives (token); connections and handlers are read at that moment
  useEffect(() => {
    if (setupRequestToken === 0) return;
    const target = setupRequestId && connections.some((c) => c.id === setupRequestId && isChatCapable(c)) ? setupRequestId : null;
    if (target) goToProviders(target);
    else setOpen(true);
  }, [setupRequestToken]);

  return (
    <Combobox
      label="Chat provider"
      disabled={disabled}
      triggerLabel={"Chat provider: " + statusLine}
      title={statusLine}
      value={chosenId ?? AUTO_ID}
      options={options}
      onChange={(id) => setChosen(id === AUTO_ID ? null : id)}
      open={open}
      onOpenChange={setOpen}
      header={readyCount === 0 ? "No provider is ready to answer. Set one up in Providers." : "Chat default. Agents with a pinned connection use their own provider."}
      triggerClassName="h-control-md max-w-[260px] px-2 text-body font-medium text-ink-dim max-sm:h-control-lg"
      trigger={
        <>
          <span className={"h-1.5 w-1.5 flex-none rounded-full " + dotClass} aria-hidden />
          <span className="min-w-0 truncate">{chipText}</span>
        </>
      }
      footer={({ close }) => (
        <ComboAction
          onClick={() => {
            close(false);
            goToProviders(chosenId);
          }}
        >
          <span className="truncate">Manage providers</span>
          {needSetup > 0 && (
            <span className="ml-auto flex-none text-meta font-normal text-ink-mute">
              {needSetup} {needSetup === 1 ? "needs" : "need"} setup
            </span>
          )}
        </ComboAction>
      )}
    />
  );
}
