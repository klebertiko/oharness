"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import { useChatModelStore, modelOverride, NEW_CHAT_KEY } from "@/store/chatModelStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";
import { useThreadStore } from "@/store/threadStore";
import { useT } from "@/i18n/store";
import { nextStep, distanceToReady } from "@/components/providers/nextStep";
import { AUTO_ID, buildComboOptions, filterComboOptions, modelOptionId, parseOptionId, selectedOptionId } from "./chatCombo";

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

/* Hallmark · component: provider picker · design-system: design.md
 * Built on the shared Combobox. The list answers one question — "which
 * connection answers this chat?" — so it holds Auto and the connections that
 * can answer right now. Anything still to configure lives on the Providers
 * screen; the footer says how many and goes there (design.md § Provider
 * stance: one place to fix a connection, no second setup form to keep honest).
 */
export function ChatProviderPicker({
  onConnect,
  disabled = false,
  modelAppliesToChat = true,
}: {
  onConnect: () => void;
  disabled?: boolean;
  /** False while a harness runs the turn: it uses its own models, so a model pinned to this chat alone would change nothing. */
  modelAppliesToChat?: boolean;
}) {
  const t = useT();
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
    // A connection that only lacks a model (none chosen, or the default is not pulled) is listed too:
    // picking a model from it is exactly how it becomes ready.
    const pickable = (id: string | null) => {
      const missing = connections.find((c) => c.id === id && isChatCapable(c));
      const m = missing ? providerReadiness(missing).missing : null;
      return m === "model" || m === "model-not-pulled";
    };
    const usable = rest.filter((r) => r.ready || r.id === chosenId || pickable(r.id));
    if (chosenId && !usable.some((r) => r.id === chosenId)) {
      usable.push({ id: chosenId, label: "Unavailable provider", detail: "Connection no longer available", ready: false, tone: "unconfigured" });
    }
    return {
      rows: [auto, ...usable],
      needSetup: rest.filter((r) => !r.ready && !pickable(r.id)).length,
    };
  }, [connections, chosenId]);
  // Connections that cannot answer yet, nearest to ready first (at most three are shown), each with its one action.
  const needsAction = useMemo(
    () =>
      connections
        .filter((c) => isChatCapable(c) && c.id !== chosenId && !rows.some((r) => r.id === c.id))
        .map((c) => ({ c, d: distanceToReady(c), step: nextStep(c) }))
        .filter((x): x is typeof x & { d: number; step: NonNullable<typeof x.step> } => x.d !== null && x.step !== null)
        .sort((a, b) => a.d - b.d)
        .map(({ c, step }) => ({ connection: c, detail: `${step.status ?? providerReadiness(c).label} · ${step.label}` })),
    [connections, chosenId, rows],
  );
  const readyCount = rows.filter((r) => r.id !== null && r.ready).length;

  const threadKey = useThreadStore((s) => s.activeThreadId) ?? NEW_CHAT_KEY;
  const overrides = useChatModelStore((s) => s.overrides);
  const setOverride = useChatModelStore((s) => s.setOverride);
  const setDefaultModel = useProviderStore((s) => s.setDefaultModel);
  const [scope, setScope] = useState<"default" | "conversation">("default");
  const liveThreadIds = useThreadStore((s) => s.threads.map((t) => t.id).join("|"));
  const pruneOverrides = useChatModelStore((s) => s.prune);
  // Pins of chats that were deleted must not pile up in storage; the pre-chat key stays.
  useEffect(() => {
    pruneOverrides([NEW_CHAT_KEY, ...liveThreadIds.split("|").filter(Boolean)]);
  }, [liveThreadIds, pruneOverrides]);

  const connection = connections.find((c) => c.id === (chosenId ?? provider?.id));
  const status = connection ? rowStatus(connection) : "Unavailable";
  // The model in effect: this conversation's own pick, else the connection's default.
  const pinned = connection ? modelOverride(overrides, threadKey, connection.id) : "";
  const model = provider && connection ? pinned || connection.defaultModel || null : null;
  // One readiness rule app-wide: the chip's dot reads the same tone the
  // dropdown rows do, instead of re-deriving it from status text.
  const readiness = connection ? providerReadiness(connection) : null;
  const dotClass = toneDotClass(readiness?.tone ?? "unconfigured");
  // Real evidence only: an unprobed connection never grows a timestamp.
  const lastChecked = connection?.lastProbe ? t("chat.provider.checked", { rel: formatRelativeTime(connection.lastProbe) }) : null;
  // Auto that resolves to nothing has no status of its own to add.
  const unresolvedAuto = !chosenId && !provider;
  // `{connection} · {model}`; Auto names where it lands: `Auto → {connection} · {model}`.
  const named = connection ? connection.label + " · " + (model ?? status) : "Unavailable provider";
  const label = chosenId ? named : provider ? "Auto → " + named : "Auto · No available provider";
  const statusLine = unresolvedAuto
    ? label
    : label + (model ? " · " + status : "") + (pinned ? " · this conversation only" : "") + (lastChecked ? " · " + lastChecked : "");
  const chipText = label;

  const [open, setOpen] = useState(false);

  const options = useMemo(() => {
    const built = buildComboOptions({
        connections,
        chosenId,
        autoDetail: rows[0].detail,
        autoTone: <span className={"h-1.5 w-1.5 flex-none rounded-full " + toneDotClass(rows[0].tone)} aria-hidden />,
        usable: rows
          .slice(1)
          .map((r) => connections.find((c) => c.id === r.id))
          .filter((c): c is NonNullable<typeof c> => Boolean(c)),
        overrideFor: (id) => modelOverride(overrides, threadKey, id),
        toneDot: (c) => <span className={"h-1.5 w-1.5 flex-none rounded-full " + toneDotClass(providerReadiness(c).tone)} aria-hidden />,
        rowDetail: (c) => rows.find((r) => r.id === c.id)?.detail ?? "",
        needsAction,
    });
    // A choice whose connection is gone stays listed so the selection is never invisible.
    const stale = rows.find((r) => r.id && !connections.some((c) => c.id === r.id));
    if (stale?.id) {
      built.push({
        id: stale.id,
        label: stale.label,
        detail: stale.detail,
        leading: <span className={"h-1.5 w-1.5 flex-none rounded-full " + toneDotClass(stale.tone)} aria-hidden />,
      });
    }
    return built;
  }, [connections, chosenId, rows, overrides, threadKey, needsAction]);

  // A model the list does not carry (a new release, a custom id) can still be typed for the connection in use.
  const searchOptions = useCallback(
    (all: ComboOption[], query: string) => {
      const found = filterComboOptions(all, query);
      const typed = query.trim();
      const target = connection;
      if (!target || !typed || all.some((o) => o.label === typed && o.group === target.label)) return found;
      return [
        ...found,
        { id: modelOptionId(target.id, typed), label: `Use “${typed}”`, detail: "Not in the list. Sent as typed.", group: target.label },
      ];
    },
    [connection],
  );

  const goToProviders = useCallback(
    (id: string | null) => {
      if (id && connections.some((c) => c.id === id)) selectConnection(id);
      setOpen(false);
      onConnect();
    },
    [connections, selectConnection, onConnect],
  );

  const choose = useCallback(
    (id: string, meta?: { shift: boolean }) => {
      const parsed = parseOptionId(id);
      if (!parsed) return;
      // A connection that needs action is fixed on its Providers page, not selected here.
      if (parsed.fix && parsed.connectionId) {
        goToProviders(parsed.connectionId);
        return;
      }
      if (parsed.auto || !parsed.connectionId) {
        setChosen(null);
        return;
      }
      setChosen(parsed.connectionId);
      if (!parsed.model) return;
      // Shift flips the scope for this one pick; the radio sets it for the next ones (touch has no Shift).
      const forConversation = modelAppliesToChat && (scope === "conversation") !== Boolean(meta?.shift);
      if (forConversation) {
        setOverride(threadKey, parsed.connectionId, parsed.model);
      } else {
        // Enter: the connection default for new chats; this chat follows it, so its own pin goes once the save took.
        const { connectionId, model } = parsed;
        void setDefaultModel(connectionId, model).then((saved) => {
          if (saved) setOverride(threadKey, connectionId, "");
        });
      }
    },
    [scope, modelAppliesToChat, setChosen, setOverride, setDefaultModel, threadKey, goToProviders],
  );

  const optionValue = chosenId && connection ? selectedOptionId(connection, pinned || connection.defaultModel) : chosenId ?? AUTO_ID;

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
      value={optionValue}
      options={options}
      searchable
      searchPlaceholder="Find a model"
      filter={searchOptions}
      onChange={choose}
      open={open}
      onOpenChange={setOpen}
      width={340}
      header={
        readyCount === 0
          ? "No provider is ready to answer. Set one up in Providers."
          : "Enter sets the default for new chats. Shift+Enter applies to this chat only. Agents with a pinned connection use their own provider."
      }
      panel={
        !modelAppliesToChat ? (
          <p className="mx-3 mb-1 text-meta text-ink-mute">A running harness uses its own models. A pick here sets the connection default.</p>
        ) : (
        <fieldset className="mx-1 mb-1 flex gap-1 border-0 p-0" aria-label="A model you pick applies to">
          {(["default", "conversation"] as const).map((v) => (
            <label key={v} className="flex min-h-control-md flex-1 cursor-pointer items-center justify-center rounded-control px-2 text-meta text-ink-dim has-checked:bg-sub-300 has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-signal max-sm:min-h-control-lg">
              <input
                type="radio"
                name="model-scope"
                value={v}
                checked={scope === v}
                onChange={() => setScope(v)}
                className="sr-only"
              />
              {v === "default" ? "Connection default" : "This chat only"}
            </label>
          ))}
        </fieldset>
        )
      }
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
