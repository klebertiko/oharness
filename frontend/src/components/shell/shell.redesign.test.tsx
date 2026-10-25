import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Boxes, Plug } from "lucide-react";
import { axeViolations } from "@/test/axe";
import { CommandPalette } from "./CommandPalette";
import { KeymapSheet } from "./KeymapSheet";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { ActivityRail } from "./ActivityRail";
import { useShellStore } from "./shellStore";
import type { Command } from "./commands";

afterEach(cleanup);

const runA = vi.fn();
const runB = vi.fn();
const commands: Command[] = [
  { id: "a", label: "Go to Studio", group: "Go to", icon: Boxes, chord: "Alt+2", meta: "studio", run: runA },
  { id: "b", label: "Go to Providers", group: "Go to", icon: Plug, run: runB },
  { id: "c", label: "Run harness", group: "Run", icon: Boxes, disabled: true, run: vi.fn() },
];
beforeEach(() => vi.clearAllMocks());

describe("CommandPalette", () => {
  it("is a named dialog with a combobox over a listbox, and announces the result count", () => {
    render(<CommandPalette open commands={commands} onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Command palette" });
    const box = within(dialog).getByRole("combobox", { name: "Search commands" });
    expect(box.getAttribute("aria-controls")).toBe(within(dialog).getByRole("listbox").id);
    expect(within(dialog).getByRole("status").textContent).toBe("3 results");
    expect(within(dialog).getAllByRole("option")).toHaveLength(3);
  });

  it("moves the active option with the arrows and tells assistive tech which one", () => {
    render(<CommandPalette open commands={commands} onClose={() => {}} />);
    const box = screen.getByRole("combobox");
    const opts = screen.getAllByRole("option");
    expect(box.getAttribute("aria-activedescendant")).toBe(opts[0].id);
    expect(opts[0].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    expect(box.getAttribute("aria-activedescendant")).toBe(opts[1].id);
    expect(screen.getAllByRole("option")[1].getAttribute("aria-selected")).toBe("true");
  });

  it("runs the active command on Enter, closes first, and ignores a disabled one", () => {
    const onClose = vi.fn();
    render(<CommandPalette open commands={commands} onClose={onClose} />);
    const box = screen.getByRole("combobox");
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onClose).toHaveBeenCalledOnce();
    expect(runB).toHaveBeenCalledOnce();
    onClose.mockClear();
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getAllByRole("option")[2].getAttribute("aria-disabled")).toBe("true");
  });

  it("says what to do when nothing matches", async () => {
    render(<CommandPalette open commands={commands} onClose={() => {}} />);
    await userEvent.type(screen.getByRole("combobox"), "zzzz");
    expect(screen.getByText(/Nothing matches/).textContent).toContain("Try a shorter word");
    expect(screen.getByRole("status").textContent).toBe("No results");
    expect(screen.getByRole("combobox").getAttribute("aria-activedescendant")).toBeNull();
  });

  it("closes on Escape and returns focus to the control that opened it", async () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Search and commands</button>
          <CommandPalette open={open} commands={commands} onClose={() => setOpen(false)} />
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "Search and commands" });
    opener.focus();
    await userEvent.click(opener);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("has no axe violations", async () => {
    render(<CommandPalette open commands={commands} onClose={() => {}} />);
    expect(await axeViolations(screen.getByRole("dialog"))).toEqual([]);
  });
});

describe("KeymapSheet", () => {
  it("lists the chords as keycaps and says where else they live", () => {
    render(<KeymapSheet open onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Keyboard map" });
    expect(dialog.querySelectorAll("kbd").length).toBeGreaterThan(10);
    expect(within(dialog).getByText("Every shortcut is also in the command palette.")).toBeTruthy();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<KeymapSheet open onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("has no axe violations", async () => {
    render(<KeymapSheet open onClose={() => {}} />);
    expect(await axeViolations(screen.getByRole("dialog"))).toEqual([]);
  });
});

describe("StatusBar", () => {
  const base = { mode: "Mock", running: false, nodeCount: 1, edgeCount: 0, selectedId: null, backendOk: true };

  it("states the run, the graph and the engine in words with the right plurals", () => {
    render(<StatusBar {...base} />);
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getByText("Mock runs")).toBeTruthy();
    expect(screen.getByText("1 node · 0 connections")).toBeTruthy();
    expect(screen.getByText("Engine connected")).toBeTruthy();
  });

  it("says Running, names the selection and flags an offline engine in text", () => {
    render(<StatusBar {...base} running nodeCount={4} edgeCount={3} selectedId="agent-1" backendOk={false} />);
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("4 nodes · 3 connections")).toBeTruthy();
    expect(screen.getByText("Selected agent-1")).toBeTruthy();
    expect(screen.getByText("Engine offline").parentElement!.className).toContain("text-fault-text");
  });

  it("opens the keyboard map from Shortcuts", async () => {
    useShellStore.setState({ keymapOpen: false });
    render(<StatusBar {...base} />);
    await userEvent.click(screen.getByRole("button", { name: /Shortcuts/ }));
    expect(useShellStore.getState().keymapOpen).toBe(true);
  });

  it("has no axe violations", async () => {
    const { container } = render(<StatusBar {...base} selectedId="n1" />);
    expect(await axeViolations(container)).toEqual([]);
  });
});

describe("TitleBar", () => {
  const props = { harnessName: "Daily", onHarnessNameChange: vi.fn(), mode: "Agent", running: false, nodeCount: 0, onOpenPalette: vi.fn() };

  it("names the destination instead of the internal mode", () => {
    render(<TitleBar {...props} destination="Providers" />);
    expect(screen.getByText("Providers")).toBeTruthy();
    expect(screen.queryByText("Agent")).toBeNull();
  });

  it("falls back to the mode when no destination is given", () => {
    render(<TitleBar {...props} mode="Studio" />);
    expect(screen.getByText("Harness Studio")).toBeTruthy();
  });

  it("gives the harness name field a visible control edge", () => {
    render(<TitleBar {...props} mode="Studio" editingHarness />);
    expect(screen.getByRole("textbox", { name: "Harness name" }).className).toContain("border-line-strong");
  });
});

describe("ActivityRail", () => {
  it("marks only the current destination with aria-current=page", () => {
    useShellStore.setState({ section: "providers", hydrated: true });
    render(<ActivityRail />);
    const nav = screen.getByRole("navigation", { name: "Destinations" });
    expect(within(nav).getByRole("button", { name: "Providers" }).getAttribute("aria-current")).toBe("page");
    expect(within(nav).getByRole("button", { name: "Chats" }).getAttribute("aria-current")).toBeNull();
  });

  it("toggles the theme through the theme module", async () => {
    document.documentElement.dataset.theme = "dark";
    render(<ActivityRail />);
    await userEvent.click(screen.getByRole("button", { name: "Use light theme" }));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(screen.getByRole("button", { name: "Use dark theme" })).toBeTruthy();
  });
});
