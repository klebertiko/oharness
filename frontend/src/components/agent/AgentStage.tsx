"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, Code2, ListChecks, Search, Square } from "lucide-react";

import { HarnessBar } from "@/components/agent/HarnessBar";
import { ChatComposer, presetFromSlashText } from "@/components/agent/ChatComposer";
import { MessageActions } from "./MessageActions";
import { useChatTools } from "@/components/agent/useChatTools";
import { usePermissionMode } from "@/components/agent/usePermissionMode";
import { useWorkspaceTrust } from "@/components/agent/useWorkspaceTrust";
import { policyRefusals } from "@/components/agent/policyRefusals";
import { PlanArtifactCard } from "@/components/agent/PlanArtifactCard";
import { usePlanArtifact } from "@/components/agent/usePlanArtifact";
import { QueuedMessages } from "@/components/agent/QueuedMessages";
import { useMessageQueueStore } from "@/store/messageQueueStore";
import { PERMISSION_LABEL, isPermissionMode, type PermissionMode } from "@/lib/permissionMode";
import type { ToolPreset } from "@/components/agent/chatCommands";
import { ChatProviderPicker } from "@/components/agent/ChatProviderPicker";
import { WorkspacePicker } from "@/components/agent/WorkspacePicker";
import { pickChatProvider } from "@/components/agent/chatProvider";
import { missingProviderAction, performInPlace } from "@/components/providers/composerAction";
import { useChatProviderStore } from "@/store/chatProviderStore";
import { modelOverride, NEW_CHAT_KEY, useChatModelStore } from "@/store/chatModelStore";
import { useChatSetupRequestStore } from "@/store/chatSetupStore";
import { chosenWorkspace, useWorkspaceStore } from "@/store/workspaceStore";
import { Nilo } from "@/components/brand/Nilo";
import { ThinkingStatus } from "@/components/brand/ThinkingStatus";
import { Transcript } from "@/components/agent-run/Transcript";
import { HistoricalRunDetail } from "@/components/agent-run/HistoricalRunDetail";
import { RunDetailRegion, RunDetailToggle } from "@/components/agent-run/RunDetailToggle";
import { SubagentToggle } from "@/components/agent/SubagentToggle";
import { useSubagentStore } from "@/store/subagentStore";
import { ToolHooksButton } from "@/components/agent/ToolHooksSheet";
import { RunBudgetField } from "@/components/agent-run/RunBudgetField";
import { useT } from "@/i18n/store";
import { useRunStream } from "@/components/agent-run/useRunStream";
import { Gate } from "@/components/agent-run/Gate";
import { bundleGraphToEngine } from "@/lib/bundleGraph";
import { summarizeRunOutput } from "@/lib/summarizeRun";
import { useProviderStore } from "@/components/providers/providerStore";
import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { NO_HARNESS, type ThreadHarness } from "@/lib/chatHarness";
import { useChatHarness } from "./useChatHarness";
import { canForkForHarness, useThreadStore } from "@/store/threadStore";
import { Button, KbdChord, Notice } from "@/components/ui";
import { chordCaps, useIsMac } from "@/components/shell/keys";

/* Hallmark · genre: modern-minimal editorial workspace
   macrostructure: Quiet Desk · design-system: design.md · designed-as-app */
/**
 * Chats home — Cursor/Claude-like: messages for the active thread + composer.
 * The harness picker sits in the composer toolbar. Run ladder is optional.
 */
/** The first message of a new chat creates its thread; the model picked before that follows it. */
function adoptNewChat(threadId: string): string {
  useChatModelStore.getState().adopt(NEW_CHAT_KEY, threadId);
  return threadId;
}

/** Fork a fresh harness change into a new chat; the model choice for this conversation follows, the permission mode deliberately does not (the new chat asks, like any new chat). */
function moveHarnessChangeToNewChat(threadId: string) {
  const forkId = useThreadStore.getState().forkThreadForHarness(threadId);
  if (!forkId) return;
  useChatModelStore.setState((s) => (s.overrides[threadId] ? { overrides: { ...s.overrides, [forkId]: { ...s.overrides[threadId] } } } : s));
}

export function AgentStage() {
  const enabled = useHarnessSessionStore((s) => s.enabled);
  const activeBundle = useHarnessSessionStore((s) => s.activeBundle);
  const hydrated = useHarnessSessionStore((s) => s.hydrated);
  const hydrate = useHarnessSessionStore((s) => s.hydrate);

  const chatHarness = useChatHarness(true);
  const activeThreadId = useThreadStore((s) => s.activeThreadId);
  const createThread = useThreadStore((s) => s.createThread);
  const appendMessage = useThreadStore((s) => s.appendMessage);
  const messagesByThread = useThreadStore((s) => s.messagesByThread);

  const setRunning = useCanvasStore((s) => s.setRunning);
  const connections = useProviderStore((s) => s.connections);
  const chosenProviderId = useChatProviderStore((s) => s.chosenId);
  const goToProviders = useShellStore((s) => s.setSection);
  const workspace = useWorkspaceStore(chosenWorkspace);
  const provider = useMemo(
    () => pickChatProvider(connections, chosenProviderId),
    [connections, chosenProviderId],
  );
  // design.md § Provider stance: never a bare "Unavailable" — when nothing
  // resolves, the composer states exactly what's missing as an action, and
  // that action opens the combo's inline setup for the right connection.
  const missing = useMemo(
    () => missingProviderAction(connections, chosenProviderId),
    [connections, chosenProviderId],
  );
  const requestProviderSetup = useChatSetupRequestStore((s) => s.requestSetup);
  // Chat tools broker (contract v1.1): what `/` can offer for this workspace
  // with this connection. Absent workspace → the menu says why.
  const chatTools = useChatTools(
    workspace ? { rootPath: workspace.rootPath, name: workspace.name } : null,
    provider?.id,
  );

  // Permission mode of this conversation: selected here, enforced by the sidecar.
  const permission = usePermissionMode(activeThreadId);
  // Workspace trust (stored by the sidecar) only matters under Auto and Workspace write.
  const trust = useWorkspaceTrust(chatTools.workspace?.root ?? null, permission.mode === "auto_workspace" || permission.mode === "workspace_write");

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftKey = activeThreadId ?? "new";
  const instruction = drafts[draftKey] ?? "";
  const setInstruction = (value: string) => setDrafts((current) => ({ ...current, [draftKey]: value }));
  // The model comes from the chat combo: this chat's own pick, else the connection default (empty).
  const modelPins = useChatModelStore((s) => s.overrides);
  const selectedModel = provider ? modelOverride(modelPins, activeThreadId ?? NEW_CHAT_KEY, provider.id) : "";
  const connection = connections.find((c) => c.id === provider?.id) ?? null;
  const runOwner = useRef<{ threadId: string; instruction: string; providerLabel?: string; harness: ThreadHarness } | null>(null);
  const [showRunDetail, setShowRunDetail] = useState(false);
  const savedRunFor = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);
  const mac = useIsMac();
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const applySuggestion = (prompt: string) => {
    setInstruction(prompt);
    composerRef.current?.focus();
  };

  useEffect(() => {
    if (!hydrated) void hydrate().catch(() => undefined);
  }, [hydrated, hydrate]);

  useEffect(() => {
    setShowRunDetail(false);
    setFollowing(true);
  }, [activeThreadId]);

  const messages = useMemo(() => {
    if (!activeThreadId) return [];
    return messagesByThread[activeThreadId] ?? [];
  }, [activeThreadId, messagesByThread]);

  const graph = useMemo(
    () =>
      bundleGraphToEngine(
        activeBundle?.graph as { nodes?: unknown[]; edges?: unknown[] } | undefined,
        instruction.trim() || undefined,
        provider?.id
      ),
    [activeBundle, instruction, provider]
  );

  const t = useT();
  const { run, elapsed, live, reset, start, stop, resolveGate } = useRunStream({
    graph,
    harnessEnabled: enabled,
  });
  const ownerThreadId = runOwner.current?.threadId ?? activeThreadId;
  const runInCurrentChat = ownerThreadId === activeThreadId;
  const planArtifact = usePlanArtifact(activeThreadId, permission.mode === "plan", runInCurrentChat ? run.proposedPlan : undefined);
  const liveAnswer = run.plan.flatMap((segment) => segment.blocks
    .filter((block) => block.kind === "text")
    .map((block) => block.text)).join("\n\n");

  // One "run detail" control per run. A finished run saved on a chat message is
  // offered by that message (HistoricalRunDetail); the stage only offers it for
  // a run that has no message to carry it — one still in flight.
  const stageDetailId = useId();
  const runSavedOnMessage = Boolean(run.runId) && messages.some((m) => m.runId === run.runId);
  const showStageDetailControl =
    (runInCurrentChat && live) ||
    (runInCurrentChat && (run.status === "complete" || run.status === "error" || run.status === "stopped") &&
      !runSavedOnMessage);

  const pendingToolApproval = run.plan.some((segment) =>
    segment.blocks.some((block) =>
      block.kind === "tool" && Boolean(block.call.approval) &&
      !block.call.approval?.decision && !block.call.denied
    )
  );

  useEffect(() => {
    if (pendingToolApproval) setShowRunDetail(true);
  }, [pendingToolApproval]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Navigation must not cancel a turn that still belongs to another chat.
  useEffect(() => {
    if (activeThreadId !== null || live) return;
    reset();
    runOwner.current = null;
    composerRef.current?.focus();
  }, [activeThreadId, reset]);

  useEffect(() => {
    setRunning(live);
  }, [live, setRunning]);

  // Persist assistant reply onto the thread when a run finishes.
  useEffect(() => {
    if (!ownerThreadId) return;
    if (live) return;
    if (!run.runId) return;
    if (run.status !== "complete" && run.status !== "error" && run.status !== "stopped") {
      return;
    }
    if (savedRunFor.current === run.runId) return;
    const text = summarizeRunOutput(run);
    if (!text) return;
    savedRunFor.current = run.runId;
    // Deleting a chat while it runs must not resurrect its message bucket.
    if (!useThreadStore.getState().threads.some((thread) => thread.id === ownerThreadId)) return;
    appendMessage(ownerThreadId, {
      role: "assistant",
      content: text,
      // A harness may pin/fail over to a connection other than the chat default.
      // Prefer runtime evidence; the selected connection labels direct turns only.
      providerLabel: (() => {
        const segment = [...run.plan].reverse().find((segment) => segment.output?.trim());
        const actual = connections.find((connection) => connection.id === segment?.connectionId);
        if (actual) return [actual.label, segment?.model].filter(Boolean).join(" · ");
        if (runOwner.current) return runOwner.current.providerLabel
          ? [runOwner.current.providerLabel, segment?.model].filter(Boolean).join(" · ") : segment?.model || undefined;
        return provider && !provider.chosen ? provider.label : undefined;
      })(),
      // Harness-graph runs persist a replayable event log server-side
      // (ExecutionLog); a direct/no-harness turn does not, so this id
      // 404s there — HistoricalRunDetail handles that by simply not
      // offering the toggle rather than erroring.
      runId: run.runId ?? undefined,
      harness: runOwner.current?.harness,
    });
  }, [ownerThreadId, appendMessage, live, run, provider, connections]);

  useEffect(() => {
    if (following) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live, run.status, liveAnswer, following]);

  const slashPreset = presetFromSlashText(instruction);
  // A message can be composed (sent now, or queued behind the running turn) when there is a provider and text.
  const canCompose =
    chatHarness.canSend &&
    !!provider &&
    instruction.trim().length > 0 &&
    !(slashPreset && "warning" in slashPreset) &&
    (!enabled || graph.nodes.length > 0 || Boolean(slashPreset && "preset" in slashPreset));
  const canStart = !live && canCompose;
  // Commands (`/exec`, `/read`) wait for the run; only a plain message can be queued.
  const canQueue = live && canCompose && !slashPreset;
  const queueKey = activeThreadId ?? "new";
  const queued = useMessageQueueStore((state) => state.byThread[queueKey]);
  const queue = useMemo(() => queued ?? [], [queued]);

  /** A `/` Tool was chosen: one run whose first act is the preset (contract §2.4).
      `exec` parks on the approval gate; the user sees the card before anything runs. */
  const onPreset = async (preset: ToolPreset) => {
    if (live || !provider) return;
    const label =
      preset.name === "exec" ? "/exec " + preset.argv.join(" ") : preset.name === "read" ? "/read " + preset.path : "/ls";
    const threadId = activeThreadId ?? adoptNewChat(createThread(label.slice(0, 60), chatHarness.binding));
    appendMessage(threadId, { role: "user", content: label });
    runOwner.current = { threadId, instruction: label, providerLabel: provider.label, harness: NO_HARNESS };
    setInstruction("");
    savedRunFor.current = null;
    // A brand-new conversation hands its chosen mode to the sidecar before the
    // run starts; the sidecar then takes the stricter of its stored mode and this one.
    const permissionMode = activeThreadId ? permission.mode : await permission.adopt(threadId);
    start({
      instruction: "",
      mode: provider.mode,
      step: false,
      cwd: workspace?.rootPath || undefined,
      providerId: provider.id,
      model: selectedModel || undefined,
      tools: { preset, summarize: false, thread_id: threadId, permission_mode: permissionMode },
    });
  };

  const onStart = () => {
    if (canQueue) {
      // A turn is running: the message waits, visibly, and runs after it.
      if (useMessageQueueStore.getState().enqueue(queueKey, instruction)) setInstruction("");
      return;
    }
    if (!canStart || !provider) return;
    if (slashPreset && "preset" in slashPreset) { void onPreset(slashPreset.preset); return; }
    send(instruction.trim());
  };

  /** Send one turn. `shown` is what the chat records when it differs from what the provider receives. */
  const send = (text: string, shown = text, modeOverride?: PermissionMode, keepDraft = false) => {
    if (!provider) return;
    // The thread is born from the first message, not from a "New chat" click,
    // so the list never fills with empty "New chat" rows.
    setFollowing(true);
    const threadId = activeThreadId ?? adoptNewChat(createThread(shown.slice(0, 60), chatHarness.binding));
    // A chat from before the setting existed takes the harness it is about to run with.
    if (activeThreadId) useThreadStore.getState().bindThreadHarness(activeThreadId, chatHarness.binding);
    if (!activeThreadId) void permission.adopt(threadId);
    appendMessage(threadId, { role: "user", content: shown });
    runOwner.current = { threadId, instruction: shown, providerLabel: !enabled ? provider.label : undefined, harness: chatHarness.binding };
    if (!keepDraft) setInstruction("");
    savedRunFor.current = null;
    // In Plan mode the turn names its thread and mode, so the sidecar can end it in a plan that waits for approval.
    const mode = modeOverride ?? permission.mode;
    // Subagents are a harness-off feature; a Plan-mode turn answers directly, so it never starts children.
    const subagentRun = useSubagentStore.getState().enabled && !enabled && mode !== "plan";
    // Chat is never mock: it runs against the connected provider. `provider.id`
    // is also the fallback carried into the graph above — one connection,
    // decided once here, never re-derived by the backend. useRunStream also
    // gets it directly (not re-derived from the graph) so it can report this
    // run's outcome back onto the same connection once it ends.
    start({
      instruction: text,
      mode: provider.mode,
      step: false,
      cwd: workspace?.rootPath || undefined,
      providerId: provider.id,
      model: !enabled || mode === "plan" ? selectedModel || undefined : undefined,
      tools: subagentRun
        ? { subagents: true, thread_id: threadId, permission_mode: mode }
        : mode === "plan" || modeOverride ? { enabled: false, thread_id: threadId, permission_mode: mode } : undefined,
    });
  };

  const approvePlan = async () => {
    if (!provider) return; // approving consumes the plan: only do it when the approved turn can actually be sent
    const text = await planArtifact.approve();
    if (text === null) return;
    send(`Carry out this approved plan:\n\n${text}`, "Plan approved. Carry it out.", "ask");
  };

  /** Run the next queued message of this chat. A draft being typed is not touched. */
  const sendNextQueued = () => {
    if (!activeThreadId) return;
    const next = useMessageQueueStore.getState().takeNext(activeThreadId);
    if (next) send(next.text, next.text, undefined, true);
  };

  // The turn finished normally and its answer is in the chat: the next queued message starts. A stopped or failed
  // turn pauses the queue instead (QueuedMessages offers Send next / Clear queue).
  const drainedFor = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: sendNextQueued is rebuilt every render; the guards below make it run once per finished turn.
  useEffect(() => {
    if (live || run.status !== "complete" || !run.runId || !activeThreadId || ownerThreadId !== activeThreadId) return;
    if (drainedFor.current === run.runId || !(useMessageQueueStore.getState().byThread[activeThreadId]?.length)) return;
    if (savedRunFor.current !== run.runId && summarizeRunOutput(run)) return; // wait for the answer to be saved
    drainedFor.current = run.runId;
    sendNextQueued();
  }, [live, run, activeThreadId, ownerThreadId, queue]);
  const queuePaused = !live && runInCurrentChat && (run.status === "error" || run.status === "stopped");

  const gateSeg = run.plan?.find((s) => s.state === "gate" && s.gate);
  const suggestions = [
    {
      icon: Code2,
      title: "Build something",
      prompt: "Help me plan and implement a feature in this project.",
    },
    {
      icon: ListChecks,
      title: "Work through a task",
      prompt: "Break this work into clear steps and take the first one.",
    },
    {
      icon: Search,
      title: "Understand a project",
      prompt: "Explore this project and explain the important parts to me.",
    },
  ];

  return (
    <div className="oh-agent-stage flex h-full min-h-0 flex-col">
      {live && !runInCurrentChat && (
        <div className="flex-none border-b border-line-soft px-4 py-2">
          <Notice action={<Button size="sm" onClick={() => ownerThreadId && useThreadStore.getState().selectThread(ownerThreadId)}>Return to running chat</Button>}>
            A turn is still running in another chat.
          </Notice>
        </div>
      )}
      <div
        onScroll={(event) => {
          const element = event.currentTarget;
          setFollowing(element.scrollHeight - element.scrollTop - element.clientHeight < 100);
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8 lg:px-12"
      >
        {messages.length === 0 && !live ? (
          <div className="oh-agent-welcome mx-auto flex w-full max-w-[680px] flex-col pt-[clamp(2rem,10vh,7rem)]">
            <div className="mb-6 flex items-end justify-between gap-8">
              <div className="min-w-0 max-w-[560px]">
                <h1 className="t-display text-display text-ink">What are we working on?</h1>
                <p className="mt-2 text-reading text-ink-mute">Describe a task, or pick one to start.</p>
              </div>
              <Nilo className="hidden flex-none sm:block" />
            </div>

            <ul className="divide-y divide-line-soft border-y border-line-soft" aria-label="Starting prompts">
              {suggestions.map(({ icon: Icon, title, prompt }) => (
                <li key={title}>
                  <button
                    type="button"
                    className="oh-focus-inner group flex min-h-control-lg w-full items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-sub-100"
                    onClick={() => applySuggestion(prompt)}
                  >
                    <span className="grid h-8 w-8 place-items-center text-ink-mute transition-colors group-hover:text-signal-text">
                      <Icon size={16} strokeWidth={1.7} aria-hidden />
                    </span>
                    <span className="text-title text-ink-dim group-hover:text-ink">{title}</span>
                  </button>
                </li>
              ))}
            </ul>

            <p className="mt-4 flex min-h-control-md items-center text-body text-ink-mute">
              {provider ? (
                <>
                  {enabled ? `${activeBundle?.manifest?.name ?? "Your harness"} · ` : "Direct · "}
                  <span className="ml-1 text-ink-dim">{provider.label}</span>
                </>
              ) : (
                <Button variant="ghost" size="sm" className="-ml-2 text-signal-text" onClick={() => requestProviderSetup(missing?.id ?? null)}>
                  {missing?.text ?? "Connect a provider to send"}
                </Button>
              )}
            </p>
          </div>
        ) : (
          <>
          <h1 className="sr-only">Chat</h1>
          <div role="log" aria-label="Conversation" aria-busy={live || undefined} className="mx-auto flex max-w-[760px] flex-col gap-6 pb-6 pt-3">
            {messages.map((m, index) => m.role === "system" ? (
              <p key={m.id} data-testid="harness-change" className="flex flex-wrap items-center gap-x-3 gap-y-1 self-stretch text-meta text-ink-mute">
                <span aria-hidden className="h-px min-w-6 flex-1 bg-line-soft" />
                <span className="max-w-[60ch] text-center">{m.content}</span>
                {index === messages.length - 1 && canForkForHarness(messages) && !live && (
                  <Button size="sm" variant="ghost" onClick={() => activeThreadId && moveHarnessChangeToNewChat(activeThreadId)}>
                    Move to a new chat
                  </Button>
                )}
                <span aria-hidden className="h-px min-w-6 flex-1 bg-line-soft" />
              </p>
            ) : (
              <div
                key={m.id}
                className={[
                  "flex min-w-0 max-w-[95%] flex-col gap-1.5 sm:max-w-[88%]",
                  m.role === "user" ? "self-end px-4 py-3 oh-agent-message--user" : "self-start pl-4 oh-agent-message--assistant",
                ].join(" ")}
              >
                <span className="text-body font-medium text-ink-mute">
                  {m.role === "user" ? "You" : m.providerLabel ? `OHarness · ${m.providerLabel}` : "OHarness"}
                </span>
                <div className={["max-w-[68ch] whitespace-pre-wrap text-reading wrap-anywhere", m.role === "user" ? "text-ink" : "text-ink-dim"].join(" ")}>
                  {m.content}
                </div>
                <MessageActions content={m.content} onReuse={!live ? () => applySuggestion(m.content) : undefined} />
                {m.role === "assistant" && m.runId && (
                  <HistoricalRunDetail
                    runId={m.runId}
                    // The run that just finished is still in memory: hand it
                    // over (and the detail the person already opened) so this
                    // is its only control and it needs no round trip.
                    run={m.runId === run.runId && !live ? run : undefined}
                    elapsed={m.runId === run.runId && !live ? elapsed : undefined}
                    defaultOpen={m.runId === run.runId && !live ? showRunDetail : false}
                  />
                )}
              </div>
            ))}

            {live && runInCurrentChat && (
              <div className="flex flex-col gap-1">
                <ThinkingStatus
                  state={gateSeg ? "waiting" : "thinking"}
                  detail={enabled ? "Walking the harness graph." : "Waiting on the provider."}
                  elapsed={elapsed}
                  tokens={run.totals.tokens}
                />
                {liveAnswer && <div role="region" aria-label="Live answer" className="mt-3 max-w-[68ch] whitespace-pre-wrap text-reading text-ink-dim wrap-anywhere">{liveAnswer}</div>}
                {gateSeg && (
                  <div className="mt-2">
                    <Gate segment={gateSeg} onResolve={resolveGate} />
                  </div>
                )}
              </div>
            )}

            {runInCurrentChat && policyRefusals(run).map((refusal) => (
              <Notice key={refusal.callId} tone="warn">
                <p><strong>Not run:</strong> <code className="t-code wrap-anywhere">{refusal.command}</code></p>
                <p className="mt-1 wrap-anywhere">{refusal.note} Preset: {isPermissionMode(refusal.mode) ? PERMISSION_LABEL[refusal.mode] : refusal.mode}.</p>
              </Notice>
            ))}

            {runInCurrentChat && run.planNotSaved && !live && (
              <Notice tone="warn">
                The plan could not be saved, so there is nothing to approve. Send your message again to get a new plan.
              </Notice>
            )}

            {planArtifact.plan && !live && (
              <PlanArtifactCard text={planArtifact.plan.text} busy={planArtifact.busy} error={planArtifact.error}
                onApprove={() => void approvePlan()} onDiscard={() => void planArtifact.discard()} />
            )}

            {runInCurrentChat && (run.status === "error" || run.status === "stopped") && (
              <Notice
                tone={run.status === "error" ? "fault" : "info"}
                action={runOwner.current?.instruction ? <Button size="sm" onClick={() => applySuggestion(runOwner.current!.instruction)}>Reuse instruction</Button> : undefined}
              >
                <p>{run.status === "error" ? "The turn failed. Check the provider connection, then reuse your instruction to try again." : (run.budget ? t("run.notice.ceiling") : "The turn stopped. You can reuse your instruction when ready.")}</p>
                {run.notices?.map((notice, index) => <p key={index} className="mt-1 wrap-anywhere">{notice}</p>)}
              </Notice>
            )}

            {showStageDetailControl && <RunDetailToggle open={showRunDetail} onToggle={() => setShowRunDetail((v) => !v)} controlsId={stageDetailId} />}

            {showStageDetailControl && showRunDetail && (
              <RunDetailRegion id={stageDetailId}>
                <Transcript run={run} onResolve={resolveGate} elapsed={elapsed} />
              </RunDetailRegion>
            )}

            <div ref={bottomRef} />
          </div>
          </>
        )}
      </div>

      <div className="flex-none px-3 pb-4 pt-2 sm:px-6">
        {!following && <div className="mb-2 text-center"><Button size="sm" onClick={() => setFollowing(true)}>Jump to latest</Button></div>}
        <div className="oh-agent-composer mx-auto max-w-[820px]">
          {chatHarness.status.state === "missing" && (
            <div className="px-3 pb-2">
              <Notice tone="fault" action={<Button size="sm" onClick={() => chatHarness.choose(NO_HARNESS)}>Continue without a harness</Button>}>
                {chatHarness.status.name} isn't available. It may have been deleted, or the list of harnesses couldn't load. Choose another harness, or continue without one.
              </Notice>
            </div>
          )}
          <QueuedMessages items={queue} paused={queuePaused} onRemove={(id) => useMessageQueueStore.getState().remove(queueKey, id)}
            onClear={() => useMessageQueueStore.getState().clear(queueKey)} onSendNext={sendNextQueued} />
          <ChatComposer
            key={activeThreadId ?? "no-thread"}
            inputRef={composerRef}
            value={instruction}
            onChange={setInstruction}
            onSend={onStart}
            skills={activeBundle?.content?.skills}
            live={live}
            tools={chatTools}
            onPreset={onPreset}
            permissionMode={permission.mode}
            onPermissionModeChange={(mode) => void permission.setMode(mode)}
            permissionNotice={permission.error}
            workspaceTrust={chatTools.workspace ? { workspaceName: chatTools.workspace.name, trusted: trust.trusted, onChange: (value) => void trust.setTrusted(value), error: trust.error } : undefined}
          />
          {chatTools.loading && <p role="status" className="px-4 py-1 text-meta text-ink-mute">Checking workspace tools…</p>}
          {chatTools.error && <p role="status" className="px-4 py-1 text-meta text-warn-text">Workspace tools unavailable. Text chat is still available. {chatTools.error}</p>}
          {chatTools.capabilities && <p className="px-4 py-1 text-meta text-ink-mute">{chatTools.capabilities.reason === "ok" ? "Workspace tools available in / commands" : chatTools.capabilities.reason === "cli-adapter" ? "Workspace tools are managed by this provider’s CLI" : "This connection does not offer workspace tools"}</p>}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2.5 pb-2.5 pt-1">
            <fieldset disabled={live} aria-label="Run settings" className="contents disabled:opacity-60">
            <HarnessBar />
            <SubagentToggle />
            <ChatProviderPicker disabled={live} modelAppliesToChat={!enabled || permission.mode === "plan"} onConnect={() => goToProviders("providers")} />
            <WorkspacePicker />
            <RunBudgetField />
            <ToolHooksButton />
            </fieldset>
            <span className="flex-1" />
            {missing ? (
              <Button variant="ghost" size="sm" onClick={() => { performInPlace(missing.step); requestProviderSetup(missing.id); }} title={missing.id ? `${missing.text}. Opens Providers.` : missing.text} className="min-w-0 max-w-[240px] text-signal-text max-sm:hidden">
                <span className="truncate">{missing.text}</span>
              </Button>
            ) : (
              <span className="flex items-center gap-1.5 text-meta text-ink-mute max-sm:hidden">
                <KbdChord caps={chordCaps("Mod+Enter", mac)} /> to send
              </span>
            )}
            {live ? (
              <>
                <Button size="lg" disabled={!canQueue} onClick={onStart} aria-label="Queue message"
                  title={canQueue ? "Queue this message to run after the current turn" : "Type a message to queue it"}>Queue</Button>
                <Button iconOnly size="lg" onClick={stop} aria-label="Stop run" title="Stop run" icon={<Square size={11} strokeWidth={2} fill="currentColor" aria-hidden />} />
              </>
            ) : (
              <Button
                iconOnly
                size="lg"
                variant="primary"
                disabled={!canStart}
                onClick={onStart}
                title={!canStart ? (missing ? missing.text : "Type a message to send") : "Send message"}
                aria-label="Send message"
                icon={<ArrowUp size={16} strokeWidth={2.2} aria-hidden />}
              />
            )}
          </div>
          <p className="px-4 pb-2 text-meta text-ink-mute">{enabled ? "Harness agents use their pinned models or connection defaults. " : `Model: ${selectedModel || connection?.defaultModel || "provider default"}. `}Each turn sends your instruction; earlier messages are not included automatically.</p>
        </div>
      </div>
    </div>
  );
}
