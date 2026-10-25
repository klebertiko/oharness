import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useThreadStore } from "@/store/threadStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useCanvasStore } from "@/store/canvasStore";
import { startDirectRun } from "@/components/agent-run/runClient";
import { AgentStage } from "./AgentStage";

// Keep the real stores, run reducer, gate and transcript; substitute the sidecar boundary.
vi.mock("@/components/agent-run/runClient", () => ({
  startDirectRun: vi.fn(() => vi.fn()),
  startRun: vi.fn(() => vi.fn()),
  sendControl: vi.fn(async () => undefined),
}));

describe("AgentStage composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
    useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: null });
    useCanvasStore.setState({ executionMode: "mock", isRunning: false });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterEach(cleanup);

  it("offers a labelled composer and focuses an editable task suggestion without starting a run", () => {
    render(<AgentStage />);
    expect(screen.getByRole("heading", { name: "What are we working on?" })).toBeTruthy();
    const input = screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
    fireEvent.click(screen.getByRole("button", { name: "Work through a task" }));
    expect(input.value).toBe("Break this work into clear steps and take the first one.");
    expect(document.activeElement).toBe(input);
    expect(startDirectRun).not.toHaveBeenCalled();
    expect(screen.queryByText(/Your active harness will shape/)).toBeNull();
  });
});
