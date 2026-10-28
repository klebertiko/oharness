import { useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PERMISSION_MODES, nextPermissionMode, type PermissionMode } from "@/lib/permissionMode";
import { ChatComposer } from "./ChatComposer";

const send = vi.fn();
const changed = vi.fn();

function Composer({ initial = "ask", live = false, notice }: { initial?: PermissionMode; live?: boolean; notice?: string }) {
  const [value, setValue] = useState("");
  const [mode, setMode] = useState<PermissionMode>(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  return <ChatComposer value={value} onChange={setValue} onSend={send} inputRef={ref} live={live}
    permissionMode={mode} onPermissionModeChange={(next) => { changed(next); setMode(next); }} permissionNotice={notice} />;
}
const textbox = () => screen.getByRole("textbox", { name: "Message OHarness" }) as HTMLTextAreaElement;
const checked = () => screen.getAllByRole("radio").find((r) => r.getAttribute("aria-checked") === "true")?.textContent;

beforeEach(() => { vi.clearAllMocks(); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);

it("always shows every mode and which one is current", () => {
  render(<Composer initial="plan" />);
  const group = screen.getByRole("radiogroup", { name: "Permission mode" });
  expect(group).toBeTruthy();
  expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual(["Plan", "Read-only", "Ask", "Auto", "Workspace write", "Full"]);
  expect(checked()).toBe("Plan");
  expect(PERMISSION_MODES).toHaveLength(6);
});

it("clicking a mode selects it", () => {
  render(<Composer />);
  fireEvent.click(screen.getByRole("radio", { name: /Auto/ }));
  expect(changed).toHaveBeenCalledWith("auto_workspace");
  expect(checked()).toBe("Auto");
});

it("Shift+Tab in the composer cycles the mode instead of moving focus", () => {
  render(<Composer />);
  const input = textbox(); input.focus();
  const seen: (string | undefined)[] = [];
  for (let i = 0; i < 3; i++) {
    const notCancelled = fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(notCancelled).toBe(false); // preventDefault was called
    seen.push(checked());
  }
  expect(seen).toEqual(["Auto", "Plan", "Ask"]);
  expect(changed.mock.calls.map((c) => c[0])).toEqual(["auto_workspace", "plan", "ask"]);
  expect(document.activeElement).toBe(input);
});

it("cycling follows nextPermissionMode, the same order the store uses", () => {
  render(<Composer initial="auto_workspace" />);
  fireEvent.keyDown(textbox(), { key: "Tab", shiftKey: true });
  expect(changed).toHaveBeenCalledWith(nextPermissionMode("auto_workspace"));
});

it("plain Tab and Mod+Shift+Tab are left alone", () => {
  render(<Composer />);
  expect(fireEvent.keyDown(textbox(), { key: "Tab" })).toBe(true);
  expect(fireEvent.keyDown(textbox(), { key: "Tab", shiftKey: true, ctrlKey: true })).toBe(true);
  expect(changed).not.toHaveBeenCalled();
});

it("Shift+Tab does not cycle while an IME composition is in progress", () => {
  render(<Composer />);
  fireEvent.keyDown(textbox(), { key: "Tab", shiftKey: true, keyCode: 229 });
  expect(changed).not.toHaveBeenCalled();
});

it("Shift+Tab wins over the slash menu instead of selecting an option", () => {
  render(<Composer />);
  fireEvent.change(textbox(), { target: { value: "/" } });
  expect(screen.getByRole("listbox", { name: "Commands and skills" })).toBeTruthy();
  fireEvent.keyDown(textbox(), { key: "Tab", shiftKey: true });
  expect(changed).toHaveBeenCalledWith("auto_workspace");
});

it("cannot be changed while a run is live", () => {
  render(<Composer live />);
  for (const radio of screen.getAllByRole("radio")) expect((radio as HTMLButtonElement).disabled).toBe(true);
});

it("says out loud when the backend refused a change", () => {
  render(<Composer notice="Não foi possível salvar o modo" />);
  expect(screen.getByRole("alert").textContent).toContain("Não foi possível salvar o modo");
});

it("renders no selector when the parent does not wire a mode (older callers)", () => {
  const Plain = () => { const ref = useRef<HTMLTextAreaElement>(null); return <ChatComposer value="" onChange={() => {}} onSend={send} inputRef={ref} live={false} />; };
  render(<Plain />);
  expect(screen.queryByRole("radiogroup")).toBeNull();
});

// -- workspace trust: what Auto does depends on it, and it says so plainly --------------------------------------
function TrustComposer({ trusted, onChange = vi.fn(), error = null, mode = "auto_workspace" }: { trusted: boolean; onChange?: (t: boolean) => void; error?: string | null; mode?: PermissionMode }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  return <ChatComposer value="" onChange={() => {}} onSend={send} inputRef={ref} live={false} permissionMode={mode} onPermissionModeChange={() => {}}
    workspaceTrust={{ workspaceName: "Development", trusted, onChange, error }} />;
}

it("Auto in an untrusted workspace says that only read-only git runs unasked and project scripts still ask", () => {
  render(<TrustComposer trusted={false} />);
  expect(screen.getByText(/only read-only git runs on its own/i)).toBeTruthy();
  expect(screen.getByText(/scripts still ask for approval/i)).toBeTruthy();
});

it("Auto in a trusted workspace says plainly that the project's own scripts run without asking", () => {
  render(<TrustComposer trusted />);
  expect(screen.getByText(/runs the project's scripts .*without asking/i)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Revoke trust" })).toBeTruthy();
});

it("trusting needs a deliberate second step with a warning; nothing is sent by the first click", () => {
  const onChange = vi.fn();
  render(<TrustComposer trusted={false} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Trust this workspace…" }));
  expect(onChange).not.toHaveBeenCalled();
  const dialog = screen.getByRole("alertdialog");
  expect(dialog.textContent).toMatch(/Development/);
  expect(dialog.textContent).toMatch(/execute code without asking for approval/i);
  expect(dialog.textContent).toMatch(/package\.json/);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Trust this workspace…" }));
  fireEvent.click(screen.getByRole("button", { name: "Trust" }));
  expect(onChange).toHaveBeenCalledWith(true);
});

it("revoking is one click", () => {
  const onChange = vi.fn();
  render(<TrustComposer trusted onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Revoke trust" }));
  expect(onChange).toHaveBeenCalledWith(false);
});

it("shows no trust controls outside Auto, and reports a refused change", () => {
  const { rerender } = render(<TrustComposer trusted={false} mode="ask" />);
  expect(screen.queryByRole("button", { name: "Trust this workspace…" })).toBeNull();
  rerender(<TrustComposer trusted={false} error="Não foi possível salvar a confiança" />);
  expect(screen.getByRole("alert").textContent).toContain("Não foi possível salvar a confiança");
});

it("the current preset stays visible as text, not only as a selected radio", () => {
  render(<Composer initial="read_only" />);
  expect(screen.getByText(/only read-only commands run; writes are refused/)).toBeTruthy();
  expect(checked()).toBe("Read-only");
});

it("choosing a preset below Full applies it at once", () => {
  render(<Composer />);
  fireEvent.click(screen.getByRole("radio", { name: /Workspace write/ }));
  expect(changed).toHaveBeenCalledWith("workspace_write");
});

it("Full needs a confirmation that names what it does; Cancel is the default focus and changes nothing", () => {
  render(<Composer />);
  fireEvent.click(screen.getByRole("radio", { name: /Full/ }));
  const dialog = screen.getByRole("alertdialog", { name: "Switch to Full" });
  expect(dialog.textContent).toMatch(/without asking/);
  expect(changed).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("alertdialog")).toBeNull();
  expect(checked()).toBe("Ask");
});

it("confirming Full applies it", () => {
  render(<Composer />);
  fireEvent.click(screen.getByRole("radio", { name: /Full/ }));
  fireEvent.click(screen.getByRole("button", { name: "Use Full" }));
  expect(changed).toHaveBeenCalledWith("full");
  expect(checked()).toBe("Full");
});

it("leaving Full needs no confirmation", () => {
  render(<Composer initial="full" />);
  fireEvent.click(screen.getByRole("radio", { name: /Read-only/ }));
  expect(changed).toHaveBeenCalledWith("read_only");
});

it("an open Full confirmation closes when the mode changes by another route", () => {
  render(<Composer />);
  fireEvent.click(screen.getByRole("radio", { name: /Full/ }));
  expect(screen.getByRole("alertdialog", { name: "Switch to Full" })).toBeTruthy();
  fireEvent.keyDown(textbox(), { key: "Tab", shiftKey: true });
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("an open Full confirmation closes when a run goes live", () => {
  const { rerender } = render(<Composer />);
  fireEvent.click(screen.getByRole("radio", { name: /Full/ }));
  rerender(<Composer live />);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

it("Workspace write also depends on trust for project scripts, so it offers the same trust control", () => {
  render(<TrustComposer trusted={false} mode="workspace_write" />);
  expect(screen.getByRole("button", { name: "Trust this workspace…" })).toBeTruthy();
  expect(screen.getByText(/Workspace write: .*project's scripts still ask/i)).toBeTruthy();
});

it("Read-only, Ask, Plan and Full show no trust control", () => {
  for (const mode of ["read_only", "ask", "plan", "full"] as const) {
    const view = render(<TrustComposer trusted={false} mode={mode} />);
    expect(screen.queryByRole("button", { name: "Trust this workspace…" })).toBeNull();
    view.unmount();
  }
});
