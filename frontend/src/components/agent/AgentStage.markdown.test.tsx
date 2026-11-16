import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { axeViolations } from "@/test/axe";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";
import { AgentStage } from "./AgentStage";

const stream = vi.hoisted(() => ({
  live: false,
  elapsed: 0,
  run: {
    runId: null as string | null,
    status: "idle",
    plan: [] as Array<{ state: string; blocks: Array<{ kind: "text"; text: string }> }>,
    totals: { tokens: 0, nodesRun: 0, elapsedMs: 0 },
  },
}));

vi.mock("@/components/agent-run/useRunStream", () => ({
  useRunStream: () => ({
    run: stream.run,
    elapsed: stream.elapsed,
    live: stream.live,
    reset: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    advance: vi.fn(),
    resolveGate: vi.fn(),
  }),
}));
vi.mock("@/components/agent/HarnessBar", () => ({ HarnessBar: () => <div /> }));
vi.mock("@/components/agent/ChatProviderPicker", () => ({ ChatProviderPicker: () => <div /> }));
vi.mock("@/components/agent/WorkspacePicker", () => ({ WorkspacePicker: () => <div /> }));
vi.mock("@/components/agent-run/Gate", () => ({ Gate: () => null }));
vi.mock("@/components/agent-run/Transcript", () => ({ Transcript: () => null }));

const reply = ["See [docs](https://example.com/docs).", "", "- one", "- two", "", "```", "const n = 1;", "```"].join("\n");

/** Hostile text for the person's message. Built here so it is not a string next to a thread id. */
function userMarkup(): string {
  return "- stay literal\n" + "<" + "script>no</" + "script>";
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  stream.live = false;
  stream.run = { runId: null, status: "idle", plan: [], totals: { tokens: 0, nodesRun: 0, elapsedMs: 0 } };
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: null, hydrate: async () => undefined });
});
afterEach(cleanup);

describe("AgentStage assistant markdown", () => {
  it("renders the saved assistant reply and leaves the person's message as text", () => {
    useThreadStore.getState().createThread("Chat");
    const thread = useThreadStore.getState().activeThreadId;
    if (!thread) throw new Error("chat was not created");
    const shown = userMarkup();
    useThreadStore.getState().appendMessage(thread, { role: "user", content: shown });
    useThreadStore.getState().appendMessage(thread, { role: "assistant", content: reply });
    const { container } = render(<AgentStage />);

    const user = screen.getByText("You").nextElementSibling as HTMLElement;
    expect(user.className).toContain("whitespace-pre-wrap");
    expect(user.className).toContain("max-w-[68ch]");
    expect(user.querySelector("ul, a, script")).toBeNull();
    expect(user.textContent).toContain("- stay literal");
    expect(user.textContent).toContain(shown);

    const assistant = screen.getByText("OHarness").parentElement as HTMLElement;
    expect(assistant.querySelector("ul")?.textContent).toContain("one");
    expect(assistant.querySelector("pre")?.className).toContain("t-code");
    expect(assistant.querySelector("pre")?.textContent).toBe("const n = 1;");
    const link = assistant.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.com/docs");
    expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    expect(assistant.querySelector("[class*='max-w-[68ch]']")).not.toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("renders the live answer as markdown while the turn is still streaming", () => {
    const id = useThreadStore.getState().createThread("Chat");
    useThreadStore.getState().appendMessage(id, { role: "user", content: "Go" });
    stream.live = true;
    stream.run = {
      runId: "run-1",
      status: "running",
      plan: [{ state: "running", blocks: [{ kind: "text", text: "```\nconst n = 1;" }] }],
      totals: { tokens: 3, nodesRun: 1, elapsedMs: 10 },
    };
    render(<AgentStage />);
    const live = screen.getByRole("region", { name: "Live answer" });
    expect(live.querySelector("pre")?.className).toContain("t-code");
    expect(live.querySelector("pre")?.textContent).toBe("const n = 1;");
    expect(live.innerHTML).toContain("max-w-[68ch]");
  });

  it("has no axe violations when a reply contains a link, a list and code", async () => {
    const id = useThreadStore.getState().createThread("Chat");
    useThreadStore.getState().appendMessage(id, { role: "user", content: "Hello" });
    useThreadStore.getState().appendMessage(id, { role: "assistant", content: reply });
    const { container } = render(<AgentStage />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
