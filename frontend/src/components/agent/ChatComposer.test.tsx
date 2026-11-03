import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useShellStore } from "@/components/shell/shellStore";
import { useThreadStore } from "@/store/threadStore";
import { ChatComposer } from "./ChatComposer";
const send = vi.fn();
function Composer({ skills = {}, live = false }: { skills?: unknown; live?: boolean }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  return <ChatComposer value={value} onChange={setValue} onSend={send} inputRef={ref} skills={skills} live={live} />;
}
function type(value: string) {
  const input = screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
  input.focus(); fireEvent.change(input, { target: { value } }); return input;
}
beforeEach(() => {
  vi.clearAllMocks();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  useShellStore.setState({ section: "chats", libraryOpen: false, keymapOpen: false });
  useThreadStore.setState({ activeThreadId: null, threads: [], messagesByThread: {} });
});
afterEach(cleanup);
it("opens on slash, keeps input focus and executes the highlighted action with arrows and Enter", () => {
  render(<Composer />); const input = type("/");
  expect(screen.getByRole("listbox", { name: "Commands and skills" })).toBeTruthy();
  expect(screen.getAllByRole("option")).toHaveLength(5);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  const option = screen.getByRole("option", { name: /\/studio/ });
  expect(input.getAttribute("aria-activedescendant")).toBe(option.id);
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(useShellStore.getState().section).toBe("studio");
  expect(input.value).toBe(""); expect(send).not.toHaveBeenCalled();
});
it("filters commands and selects with Tab without sending slash text", () => {
  render(<Composer />); const input = type("/pro");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  fireEvent.keyDown(input, { key: "Tab" });
  expect(useShellStore.getState().section).toBe("providers");
  expect(input.value).toBe(""); expect(send).not.toHaveBeenCalled();
});
it("Escape dismisses without erasing, and ordinary URLs or paths do not open a menu", () => {
  render(<Composer />); const input = type("/studio");
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull(); expect(input.value).toBe("/studio");
  type("https://example.com/path"); expect(screen.queryByRole("listbox")).toBeNull();
  type("/usr/local"); expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }); expect(send).toHaveBeenCalledOnce();
});
it("inserts only an actual bundled skill as editable plain text, without executing it", () => {
  const content = "# Review\nCheck the diff. <script>untrusted()</script>";
  render(<Composer skills={{ review: content, empty: "", malformed: { code: "no" } }} />);
  const input = type("/skill:rev");
  fireEvent.click(screen.getByRole("option", { name: /\/skill:review/ }));
  expect(input.value).toBe(content); expect(document.activeElement).toBe(input);
  expect(screen.queryByRole("listbox")).toBeNull(); expect(document.querySelector("script")).toBeNull();
  expect(send).not.toHaveBeenCalled();
});
it("unknown commands do not submit, and IME Enter does not choose an action", () => {
  render(<Composer />); const input = type("/nonexistent");
  expect(screen.getByRole("status").textContent).toContain("No matching commands");
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true }); expect(send).not.toHaveBeenCalled();
  type("/studio"); fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(useShellStore.getState().section).toBe("chats"); expect(input.value).toBe("/studio");
});
it("keeps commands unavailable during a running turn", () => {
  render(<Composer live />); const input = type("/new");
  expect(screen.getByRole("option").getAttribute("aria-disabled")).toBe("true");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("/new"); expect(send).not.toHaveBeenCalled();
});
it("keeps accepting text while a run is live, and send hands it to onSend (the stage queues it)", () => {
  render(<Composer live />);
  const input = screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
  expect(input.disabled).toBe(false);
  expect(input.placeholder).toMatch(/queue/i);
  fireEvent.change(input, { target: { value: "next thing" } });
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(send).toHaveBeenCalledTimes(1);
});
it("a slash command typed during a live run is not sent or queued", () => {
  render(<Composer live />);
  const input = type("/exec ls");
  fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
  expect(send).not.toHaveBeenCalled();
});
it("new chat retains saved messages and creates no empty thread", () => {
  const id = useThreadStore.getState().createThread("Existing chat");
  useThreadStore.getState().appendMessage(id, { role: "user", content: "Keep this" });
  render(<Composer />); const input = type("/new"); fireEvent.keyDown(input, { key: "Enter" });
  expect(useThreadStore.getState().activeThreadId).toBeNull();
  expect(useThreadStore.getState().threads).toHaveLength(1);
  expect(useThreadStore.getState().messagesByThread[id][0].content).toBe("Keep this");
});

// ── CHAT-TOOLS-FE (features/chat-tools-menu.feature) ───────────────────────
const workspaceTools = {
  workspace: { root: "D:\Development", name: "Development" },
  capabilities: {
    workspace: { root: "D:\Development", name: "Development" },
    provider_kind: "http" as const,
    tools: { discover: true, read: true, exec: true },
    preset: { read: true, exec: true },
    reason: "ok" as const,
    limits: { read_max_bytes: 262144, exec_timeout_s: 60, exec_max_timeout_s: 600, exec_output_max_bytes: 65536, max_tool_calls_per_turn: 8, max_reads_per_turn: 20 },
  },
  items: [
    { kind: "skill" as const, name: "harness", path: ".claude/skills/harness/SKILL.md", description: "Agile harness", source: "claude-skills" },
    { kind: "command" as const, name: "test", path: "frontend/package.json", argv: ["npm", "run", "test"], cwd: "frontend", source: "package-scripts" },
  ],
  readSkill: vi.fn(async () => "# harness draft"),
};
function ToolsComposer({ tools = workspaceTools, onPreset = vi.fn() }: { tools?: typeof workspaceTools | { workspace: null; capabilities: null; items: never[]; readSkill: () => Promise<string> }; onPreset?: (preset: unknown) => void }) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  return <ChatComposer value={value} onChange={setValue} onSend={send} inputRef={ref} skills={{}} live={false} tools={tools} onPreset={onPreset} />;
}
it("Typing slash shows Command, Skill and Tool sections", () => {
  render(<ToolsComposer />); type("/");
  expect(screen.getByRole("option", { name: /\/new/ }).textContent).toContain("Command");
  expect(screen.getByRole("option", { name: /\/skill:harness/ }).textContent).toContain("insert");
  expect(screen.getByRole("option", { name: /\/exec/ }).textContent).toContain("Tool");
});
it("Selecting a Skill inserts a draft and never executes", async () => {
  const onPreset = vi.fn();
  render(<ToolsComposer onPreset={onPreset} />); const input = type("/skill:harness");
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByDisplayValue("# harness draft");
  expect(onPreset).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
it("Selecting a Tool starts a run with a preset", () => {
  const onPreset = vi.fn();
  render(<ToolsComposer onPreset={onPreset} />); const input = type("/test");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onPreset).toHaveBeenCalledWith({ name: "exec", argv: ["npm", "run", "test"], cwd: "frontend" });
  expect(input.value).toBe("");
});
it("No workspace hides tools and says why", () => {
  render(<ToolsComposer tools={{ workspace: null, capabilities: null, items: [], readSkill: async () => "" }} />); type("/");
  expect(screen.queryByRole("option", { name: /\/exec/ })).toBeNull();
  expect(screen.getByText("Choose a folder to use tools.")).toBeTruthy();
});
