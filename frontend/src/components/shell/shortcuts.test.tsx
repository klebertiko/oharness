import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Keyboard } from "lucide-react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Command } from "./commands";
import { cycleRegion } from "./regions";
import { ShortcutsModal } from "./ShortcutsModal";
import { chordFromEvent, hydrateShortcuts, useShortcutStore } from "./shortcuts";

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

beforeEach(() => {
  window.localStorage.clear();
  useShortcutStore.setState({ bindings: {} });
});
afterEach(cleanup);

describe("chordFromEvent", () => {
  it("refuses a lone key that types or moves focus", () => {
    for (const k of ["Enter", "Tab", " ", "Backspace", "ArrowDown", "a"]) expect(chordFromEvent(key(k), false), k).toBeNull();
    expect(chordFromEvent(key("A", { shiftKey: true }), false)).toBeNull();
    expect(chordFromEvent(key("Tab", { shiftKey: true }), false)).toBeNull();
  });
  it("accepts a modifier chord and a function key", () => {
    expect(chordFromEvent(key("b", { ctrlKey: true }), false)).toBe("Mod+B");
    expect(chordFromEvent(key("Enter", { ctrlKey: true }), false)).toBe("Mod+Enter");
    expect(chordFromEvent(key("F6"), false)).toBe("F6");
    expect(chordFromEvent(key("F6", { shiftKey: true }), false)).toBe("Shift+F6");
  });
});

describe("shortcut store", () => {
  it("drops stored values that are not a string or null", () => {
    window.localStorage.setItem("oh.shortcuts.v1", JSON.stringify({ ok: "Mod+J", off: null, bad: 3, worse: { x: 1 } }));
    hydrateShortcuts();
    expect(useShortcutStore.getState().bindings).toEqual({ ok: "Mod+J", off: null });
  });
  it("frees the chord from the command it displaces, even one on its default", () => {
    useShortcutStore.getState().rebind("palette", "Mod+B", ["sidebar"]);
    expect(useShortcutStore.getState().chordFor("palette", "Mod+K")).toBe("Mod+B");
    expect(useShortcutStore.getState().chordFor("sidebar", "Mod+B")).toBeUndefined();
  });
  it("restores the default and clears a binding", () => {
    const store = useShortcutStore.getState();
    store.rebind("palette", "Mod+J");
    useShortcutStore.getState().reset("palette");
    expect(useShortcutStore.getState().chordFor("palette", "Mod+K")).toBe("Mod+K");
    useShortcutStore.getState().rebind("palette", null);
    expect(useShortcutStore.getState().chordFor("palette", "Mod+K")).toBeUndefined();
  });
});

function Harness() {
  const chordFor = useShortcutStore((s) => s.chordFor);
  useShortcutStore((s) => s.bindings);
  const commands: Command[] = [
    { id: "sidebar", label: "Toggle sidebar", group: "View", icon: Keyboard, defaultChord: "Mod+B", chord: chordFor("sidebar", "Mod+B"), run: () => {} },
    { id: "palette", label: "Open palette", group: "View", icon: Keyboard, defaultChord: "Mod+K", chord: chordFor("palette", "Mod+K"), run: () => {} },
  ];
  return <ShortcutsModal open commands={commands} onClose={() => {}} />;
}

const row = (label: string) => screen.getByText(label).closest("li") as HTMLElement;

describe("ShortcutsModal", () => {
  it("warns before taking another command's chord, and only replaces on confirm", async () => {
    render(<Harness />);
    await userEvent.click(within(row("Open palette")).getByRole("button", { name: "Change shortcut" }));
    fireEvent.keyDown(screen.getByRole("textbox"), key("b", { ctrlKey: true }));
    expect(screen.getByText("This replaces Toggle sidebar")).toBeTruthy();
    // Nothing changed yet.
    expect(useShortcutStore.getState().chordFor("sidebar", "Mod+B")).toBe("Mod+B");
    await userEvent.click(screen.getByRole("button", { name: "Replace" }));
    expect(useShortcutStore.getState().chordFor("palette", "Mod+K")).toBe("Mod+B");
    expect(useShortcutStore.getState().chordFor("sidebar", "Mod+B")).toBeUndefined();
  });

  it("cancels a conflicting chord without touching either command", async () => {
    render(<Harness />);
    await userEvent.click(within(row("Open palette")).getByRole("button", { name: "Change shortcut" }));
    fireEvent.keyDown(screen.getByRole("textbox"), key("b", { ctrlKey: true }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(useShortcutStore.getState().bindings).toEqual({});
  });

  it("clears a shortcut and restores the default", async () => {
    render(<Harness />);
    await userEvent.click(within(row("Open palette")).getByRole("button", { name: "Clear shortcut" }));
    expect(useShortcutStore.getState().chordFor("palette", "Mod+K")).toBeUndefined();
    await userEvent.click(within(row("Open palette")).getByRole("button", { name: "Restore default" }));
    expect(useShortcutStore.getState().chordFor("palette", "Mod+K")).toBe("Mod+K");
  });

  it("ignores a lone Enter while recording", async () => {
    render(<Harness />);
    await userEvent.click(within(row("Open palette")).getByRole("button", { name: "Change shortcut" }));
    fireEvent.keyDown(screen.getByRole("textbox"), key("Enter"));
    expect(useShortcutStore.getState().bindings).toEqual({});
    expect(screen.getAllByText("Press the new shortcut").length).toBeGreaterThan(0);
  });
});

describe("F6 regions", () => {
  const region = (id: string, width: number, height: number) => {
    const el = document.createElement("div");
    el.id = id;
    el.tabIndex = -1;
    el.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
    document.body.appendChild(el);
    return el;
  };
  afterEach(() => {
    for (const id of ["oh-titlebar", "oh-sidebar", "oh-main", "oh-dock"]) document.getElementById(id)?.remove();
  });

  it("skips a collapsed sidebar that still has height but no width", () => {
    const title = region("oh-titlebar", 800, 40);
    region("oh-sidebar", 0, 600);
    const main = region("oh-main", 800, 600);
    title.focus();
    cycleRegion(1);
    expect(document.activeElement).toBe(main);
  });
});
