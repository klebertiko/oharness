"use client";
import { create } from "zustand";
import { useShellStore } from "@/components/shell/shellStore";
import { planGraphEdit } from "@/lib/copilot/api";
import { describeFailure } from "@/lib/copilot/errors";
import type { Op, RequestMode } from "@/lib/copilot/contract";
import { describeOps, diffMarks, materializeOps, validateOps, type OpLine } from "@/lib/copilot/ops";
import { previewProposal, selectedOps, type Mark } from "@/lib/copilot/preview";
import { PROPOSAL_STATES, nextState, toggleOp, type ProposalEvent, type ProposalState } from "@/lib/copilot/rules";
import { toCopilotGraph } from "@/lib/copilot/serialize";
import { useCanvasStore } from "./canvasStore";

/**
 * A graph change Nilo proposed (ADR 0010). It stays `pending` — previewed as
 * ghosts, canvas untouched — until Apply commits the kept changes as one undo
 * step. Which states exist and what each allows lives in `lib/copilot/rules.ts`.
 */
export interface Proposal {
  state: ProposalState;
  ops: Op[];
  lines: OpLine[];
  /** Indices of ops the person dropped before applying. */
  excluded: number[];
  /** `canvasStore.headSeq()` right after Apply; null until then. */
  seq: number | null;
  /** Why a pending proposal cannot be applied right now. */
  notice?: string;
  /** The review card already took focus once; a remount must not do it again. */
  seen?: boolean;
}

export interface TurnError {
  text: string;
  /** The prompt to resend on "Try again". */
  retry?: string;
  link?: "providers";
}

export interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  source?: "model" | "offline";
  error?: TurnError;
  proposal?: Proposal;
}

type Tab = "inspector" | "copilot";
type Marks = Record<string, Mark>;

interface CopilotState {
  open: boolean;
  tab: Tab;
  turns: Turn[];
  status: "idle" | "working" | "error";
  marks: Marks;
  abort: AbortController | null;

  openCopilot: () => void;
  close: () => void;
  setTab: (tab: Tab) => void;
  send: (text: string, opts?: { mode?: RequestMode; connectionId?: string | null }) => Promise<void>;
  cancel: () => void;
  markSeen: (turnId: string) => void;
  toggleOp: (turnId: string, index: number) => void;
  apply: (turnId: string) => void;
  reject: (turnId: string) => void;
  /** Mark a pending proposal stale when the live graph no longer accepts it. */
  revalidate: (turnId: string) => void;
  keep: (turnId: string) => void;
  undo: (turnId: string) => void;
  undoAvailable: (turnId: string) => boolean;
  reset: () => void;
}

const HISTORY_TURNS = 6;
/** The backend refuses a history turn longer than this. */
const HISTORY_TEXT_MAX = 2000;
const CONFLICT = "The graph changed since Nilo proposed this, so it no longer fits.";
const newId = () => crypto.randomUUID();

const isAbort = (err: unknown) => err instanceof DOMException && err.name === "AbortError";

const proposalOf = (turns: Turn[], turnId: string) => turns.find((t) => t.id === turnId)?.proposal;

function patchProposal(turns: Turn[], turnId: string, patch: Partial<Proposal>): Turn[] {
  return turns.map((t) => (t.id === turnId && t.proposal ? { ...t, proposal: { ...t.proposal, ...patch } } : t));
}

/** Apply `event` to every proposal that allows it (e.g. a new prompt). */
function settle(turns: Turn[], event: ProposalEvent): Turn[] {
  return turns.map((t) => {
    const next = t.proposal && nextState(t.proposal.state, event);
    return t.proposal && next ? { ...t, proposal: { ...t.proposal, state: next } } : t;
  });
}

/** What Nilo is told about an earlier turn, so a refinement knows what is still on the table. */
function historyText(t: Turn): string {
  const p = t.proposal;
  if (!p) return t.text;
  const kept = p.lines.filter((_, i) => !p.excluded.includes(i)).map((l) => l.text);
  const dropped = p.lines.filter((_, i) => p.excluded.includes(i)).map((l) => l.text);
  const status = {
    pending: "proposed, not applied yet",
    stale: "proposed, out of date",
    applied: "applied",
    kept: "applied and kept",
    undone: "applied then undone",
    rejected: "discarded by the person",
    replaced: "proposed, never applied; the next message refines it",
  }[p.state];
  const text = `${t.text} [${status}: ${kept.join("; ") || "nothing"}${dropped.length ? `; dropped: ${dropped.join("; ")}` : ""}]`;
  return text.length > HISTORY_TEXT_MAX ? `${text.slice(0, HISTORY_TEXT_MAX - 1)}…` : text;
}

function previewMarks(proposal: Proposal): Marks {
  const live = useCanvasStore.getState();
  return previewProposal(live.nodes, live.edges, proposal.ops, proposal.excluded).marks;
}

export const useCopilotStore = create<CopilotState>((set, get) => ({
  open: false,
  tab: "inspector",
  turns: [],
  status: "idle",
  marks: {},
  abort: null,

  openCopilot: () => {
    set({ open: true, tab: "copilot" });
    useShellStore.getState().setRightOpen(true);
  },
  close: () => set({ open: false, tab: "inspector" }),
  setTab: (tab) => set({ tab }),

  send: async (text, opts = {}) => {
    const canvas = useCanvasStore.getState();
    const history = get()
      .turns.filter((t) => !t.error)
      .slice(-HISTORY_TURNS)
      .map((t) => ({ role: t.role, text: historyText(t) }));
    const controller = new AbortController();
    get().abort?.abort();
    set({
      turns: [...get().turns, { id: newId(), role: "user", text }],
      status: "working",
      abort: controller,
    });

    const fail = (error: TurnError) =>
      set({ turns: [...get().turns, { id: newId(), role: "assistant", text: "", error }], status: "idle", abort: null });

    try {
      const res = await planGraphEdit(
        {
          message: text,
          history,
          graph: toCopilotGraph(canvas.nodes, canvas.edges),
          mode: opts.mode ?? "mock",
          connection_id: opts.connectionId ?? null,
        },
        controller.signal,
      );
      if (controller.signal.aborted) return;

      // The graph can change while the model is thinking: re-validate against
      // the live canvas, never against the snapshot we sent.
      const live = useCanvasStore.getState();
      const liveGraph = toCopilotGraph(live.nodes, live.edges);
      const ops = Array.isArray(res.ops) ? res.ops : null;
      const checked = ops && validateOps(liveGraph, ops);
      if (!ops || !checked || !checked.ok) return fail({ text: "The graph changed while Nilo was working", retry: text });

      const proposal: Proposal | undefined =
        ops.length > 0 ? { state: "pending", ops, lines: describeOps(ops, liveGraph), excluded: [], seq: null } : undefined;
      // Moving on keeps what was applied and replaces what was only proposed — once the answer is here,
      // so a failed or cancelled request leaves the proposal on screen to apply or discard.
      set({
        turns: [
          ...settle(get().turns, "newPrompt"),
          { id: newId(), role: "assistant", text: String(res.summary ?? ""), source: res.source, proposal },
        ],
        marks: proposal ? previewMarks(proposal) : {},
        status: "idle",
        abort: null,
      });
    } catch (err) {
      if (isAbort(err) || controller.signal.aborted) return;
      fail({ ...describeFailure(err), retry: text });
    }
  },

  cancel: () => {
    get().abort?.abort();
    set({ status: "idle", abort: null });
  },

  markSeen: (turnId) => set({ turns: patchProposal(get().turns, turnId, { seen: true }) }),

  toggleOp: (turnId, index) => {
    const p = proposalOf(get().turns, turnId);
    if (!p || !PROPOSAL_STATES[p.state].canToggle) return;
    const next: Proposal = { ...p, excluded: [...toggleOp(p.ops, new Set(p.excluded), index)].sort((x, y) => x - y), notice: undefined };
    set({ turns: patchProposal(get().turns, turnId, next), marks: previewMarks(next) });
  },

  revalidate: (turnId) => {
    const p = proposalOf(get().turns, turnId);
    if (!p || p.state !== "pending") return;
    const live = useCanvasStore.getState();
    // The whole proposal, not the person's selection: only a change in the graph makes it stale.
    if (validateOps(toCopilotGraph(live.nodes, live.edges), p.ops).ok) return;
    set({ turns: patchProposal(get().turns, turnId, { state: nextState("pending", "conflict")!, notice: CONFLICT }), marks: {} });
  },

  apply: (turnId) => {
    const p = proposalOf(get().turns, turnId);
    if (!p || !PROPOSAL_STATES[p.state].canApply) return;
    const chosen = selectedOps(p.ops, p.excluded);
    const live = useCanvasStore.getState();
    if (chosen.length === 0 || live.isRunning) return;
    const graph = toCopilotGraph(live.nodes, live.edges);
    const checked = validateOps(graph, chosen);
    if (!checked.ok) {
      const stale = !validateOps(graph, p.ops).ok;
      set({
        turns: patchProposal(get().turns, turnId, stale ? { state: nextState(p.state, "conflict")!, notice: CONFLICT } : { notice: checked.errors[0].message }),
        marks: stale ? {} : get().marks,
      });
      return;
    }
    const next = materializeOps(live.nodes, live.edges, chosen);
    const seq = live.applyGraphPatch(next.nodes, next.edges);
    if (seq === null) return;
    set({
      turns: patchProposal(get().turns, turnId, { state: nextState(p.state, "apply")!, seq, notice: undefined }),
      marks: diffMarks(live.nodes, next.nodes),
    });
  },

  reject: (turnId) => {
    const p = proposalOf(get().turns, turnId);
    const next = p && nextState(p.state, "reject");
    if (!next) return;
    set({ turns: patchProposal(get().turns, turnId, { state: next, notice: undefined }), marks: {} });
  },

  keep: (turnId) => {
    const p = proposalOf(get().turns, turnId);
    const next = p && nextState(p.state, "keep");
    if (!next) return;
    set({ turns: patchProposal(get().turns, turnId, { state: next }), marks: {} });
  },

  undoAvailable: (turnId) => {
    const p = proposalOf(get().turns, turnId);
    return !!p && PROPOSAL_STATES[p.state].canUndo && p.seq !== null && useCanvasStore.getState().headSeq() === p.seq;
  },

  undo: (turnId) => {
    if (!get().undoAvailable(turnId)) return;
    useCanvasStore.getState().undo();
    set({ turns: patchProposal(get().turns, turnId, { state: "undone" }), marks: {} });
  },

  reset: () => {
    get().abort?.abort();
    set({ turns: [], status: "idle", marks: {}, abort: null });
  },
}));
