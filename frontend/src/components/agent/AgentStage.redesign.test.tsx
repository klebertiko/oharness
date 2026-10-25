import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { axeViolations } from "@/test/axe";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";
import { AgentStage } from "./AgentStage";

vi.mock("@/components/agent-run/useRunStream", () => ({
  useRunStream: () => ({
    run: { runId: null, status: "idle", plan: [], totals: { tokens: 0, nodesRun: 0, elapsedMs: 0 } },
    elapsed: 0, live: false, reset: vi.fn(), start: vi.fn(), stop: vi.fn(), advance: vi.fn(), resolveGate: vi.fn(),
  }),
}));
vi.mock("@/components/agent/HarnessBar", () => ({ HarnessBar: () => <div /> }));
vi.mock("@/components/agent/ChatProviderPicker", () => ({ ChatProviderPicker: () => <div /> }));
vi.mock("@/components/agent/WorkspacePicker", () => ({ WorkspacePicker: () => <div /> }));
vi.mock("@/components/agent-run/Gate", () => ({ Gate: () => null }));
vi.mock("@/components/agent-run/Transcript", () => ({ Transcript: () => null }));

const scrollIntoView = vi.fn();
beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: null, hydrate: async () => undefined });
});
afterEach(cleanup);

describe("AgentStage (Quiet Desk)", () => {
  it("welcome has one h1, three starting prompts and a named send control that explains why it is off", () => {
    render(<AgentStage />);
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Starting prompts" }).querySelectorAll("button")).toHaveLength(3);
    const send = screen.getByRole("button", { name: "Send message" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    // Disabled is explained, not silent.
    expect(send.title).not.toBe("");
  });

  it("a starting prompt fills the composer and moves focus to it", () => {
    render(<AgentStage />);
    fireEvent.click(screen.getByRole("button", { name: "Build something" }));
    const box = screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
    expect(box.value).toContain("plan and implement a feature");
    expect(document.activeElement).toBe(box);
  });

  it("a conversation is a named live log with the messages in it", () => {
    const id = useThreadStore.getState().createThread("Chat");
    useThreadStore.getState().appendMessage(id, { role: "user", content: "Hello there" });
    useThreadStore.getState().appendMessage(id, { role: "assistant", content: "Hi. What are we building?" });
    render(<AgentStage />);
    const log = screen.getByRole("log", { name: "Conversation" });
    expect(log.textContent).toContain("Hello there");
    expect(log.textContent).toContain("Hi. What are we building?");
  });

  it("follows new messages only while the person is at the bottom", () => {
    const id = useThreadStore.getState().createThread("Chat");
    useThreadStore.getState().appendMessage(id, { role: "user", content: "one" });
    const { container } = render(<AgentStage />);
    const scroller = container.querySelector(".overflow-y-auto") as HTMLElement;
    const setScroll = (top: number) => {
      Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
      Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });
      scroller.scrollTop = top;
      fireEvent.scroll(scroller);
    };
    // Scrolled up to read: a new message must not move the view.
    setScroll(100);
    scrollIntoView.mockClear();
    useThreadStore.getState().appendMessage(id, { role: "assistant", content: "two" });
    return Promise.resolve().then(() => {
      expect(scrollIntoView).not.toHaveBeenCalled();
      // Back at the bottom: it follows again.
      setScroll(600);
      useThreadStore.getState().appendMessage(id, { role: "assistant", content: "three" });
    }).then(() => Promise.resolve()).then(() => {
      expect(scrollIntoView).toHaveBeenCalled();
    });
  });

  it("has no axe violations on the welcome and on a conversation", async () => {
    const { container, unmount } = render(<AgentStage />);
    expect(await axeViolations(container)).toEqual([]);
    unmount();
    const id = useThreadStore.getState().createThread("Chat");
    useThreadStore.getState().appendMessage(id, { role: "user", content: "Hello" });
    const view = render(<AgentStage />);
    expect(await axeViolations(view.container)).toEqual([]);
  });
});
