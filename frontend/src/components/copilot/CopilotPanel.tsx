"use client";
import { Button } from "@/components/ui/Button";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Panel } from "@/components/shell/Panel";
import { useShellStore } from "@/components/shell/shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useAssistProvider } from "@/lib/copilot/useAssistProvider";
import { useCopilotStore, type Turn } from "@/store/copilotStore";
import { ProposalCard } from "./ProposalCard";
import { ProviderLine } from "./ProviderLine";

const MAX_PROMPT = 2000;
const COUNTER_FROM = 1800;
const STARTERS = [
  "Build a research → writing → review workflow",
  "Add an agent and help me define how it should behave",
  "Add a skill with a clear outcome and a human approval gate",
];

function useElapsed(active: boolean) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  return seconds;
}

function TurnView({ turn }: { turn: Turn }) {
  const send = useCopilotStore((s) => s.send);
  const setSection = useShellStore((s) => s.setSection);
  const { mode, connectionId } = useAssistProvider();

  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="t-body max-w-[88%] whitespace-pre-wrap wrap-break-word rounded-float bg-sub-300 px-3 py-2 text-ink">{turn.text}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {turn.text && <p className="t-body whitespace-pre-wrap wrap-break-word text-ink-dim">{turn.text}</p>}
      {turn.source === "offline" && <span className="t-meta text-ink-mute">Offline draft</span>}
      {turn.error && (
        <div role="alert" className="space-y-1.5">
          <p className="t-body text-fault-text">{turn.error.text}</p>
          <div className="flex items-center gap-2">
            {turn.error.retry && (
              <button
                type="button"
                onClick={() => void send(turn.error!.retry!, { mode, connectionId })}
                className="h-7 rounded-control border border-line px-2.5 text-body font-medium text-ink hover:bg-sub-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
              >
                Try again
              </button>
            )}
            {turn.error.link === "providers" && (
              <button type="button" onClick={() => setSection("providers")} className="t-body text-signal-text underline-offset-2 hover:underline">
                Open Providers
              </button>
            )}
          </div>
        </div>
      )}
      {turn.proposal && <ProposalCard turnId={turn.id} proposal={turn.proposal} />}
    </div>
  );
}

export function CopilotPanel() {
  const turns = useCopilotStore((s) => s.turns);
  const status = useCopilotStore((s) => s.status);
  const send = useCopilotStore((s) => s.send);
  const cancel = useCopilotStore((s) => s.cancel);
  const close = useCopilotStore((s) => s.close);
  const isRunning = useCanvasStore((s) => s.isRunning);
  const { mode, connectionId, provider, missing, requestSetup } = useAssistProvider();
  const [draft, setDraft] = useState("");
  const working = status === "working";
  // A proposal still waiting for review is what this request refines.
  const refining = turns.some((t) => t.proposal?.state === "pending");
  const seconds = useElapsed(working);
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, working]);

  // Grow from one row to six as the prompt does.
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 20 + 12)}px`;
  }, [draft]);

  const blocked = working || isRunning;
  /** `offline` forces the rule-based draft; otherwise the chat's provider answers. */
  const submit = (text: string, offline = false) => {
    const message = text.trim();
    if (!message || blocked || (!provider && !offline)) return;
    setDraft("");
    void send(message, offline ? { mode: "mock", connectionId: null } : { mode, connectionId });
  };

  return (
    <Panel
      title="Nilo"
      className="h-full"
      actions={
        <button
          type="button"
          onClick={close}
          aria-label="Close Nilo"
          className="grid h-6 w-6 place-items-center rounded-control text-ink-mute hover:bg-sub-300 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
        >
          <X size={13} aria-hidden />
        </button>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <ProviderLine onUseOffline={() => submit(draft, true)} canUseOffline={!blocked && draft.trim() !== ""} />
        <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {turns.length === 0 && (
            <div className="space-y-3">
              <div>
                <p className="t-body font-medium text-ink">Build the graph in plain language</p>
                <p className="t-body mt-1 text-ink-mute">Describe the outcome, who should act, and where a person must review. Nilo proposes one reversible graph change at a time.</p>
              </div>
              <div className="flex flex-col items-start gap-1.5">
                {STARTERS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={blocked}
                    onClick={() => (provider ? submit(s) : setDraft(s))}
                    className="rounded-control border border-line px-2.5 py-1.5 text-left text-body text-ink hover:bg-sub-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {turns.map((t) => (
            <TurnView key={t.id} turn={t} />
          ))}
          {working && (
            <div role="status" className="flex items-center gap-2">
              <span className="t-meta text-ink-mute">{refining ? "Refining the proposal" : "Drafting"} · {seconds}s</span>
              <button
                type="button"
                onClick={cancel}
                className="h-6 rounded-control border border-line px-2 text-body text-ink hover:bg-sub-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        <div className="flex-none border-t border-line p-2.5">
          {isRunning && (
            <p role="status" className="mb-1.5 text-body text-warn-text">
              Stop the run to ask Nilo.
            </p>
          )}
          <textarea
            ref={field}
            rows={1}
            value={draft}
            disabled={blocked}
            id="nilo-composer"
            aria-label="Ask Nilo"
            placeholder="Describe the change…"
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_PROMPT))}
            onKeyDown={(e) => {
              if (e.key === "Escape" && working) {
                e.preventDefault();
                cancel();
              } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit(draft);
              }
            }}
            className="w-full resize-none rounded-control border border-line-strong bg-sub-200 px-2 py-1.5 text-title leading-5 text-ink placeholder:text-ink-mute hover:bg-sub-300 disabled:opacity-50"
          />
          <div className="mt-1.5 flex items-center justify-between">
            <span className="t-meta text-ink-mute">{draft.length > COUNTER_FROM ? `${draft.length} / ${MAX_PROMPT}` : "Enter to send · Shift+Enter for a new line"}</span>
            {provider ? (
              <Button variant="primary" disabled={blocked || draft.trim() === ""} onClick={() => submit(draft)}>
                Send
              </Button>
            ) : (
              <Button variant="primary" onClick={requestSetup}>
                {missing?.text ?? "Connect a provider to send"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}
