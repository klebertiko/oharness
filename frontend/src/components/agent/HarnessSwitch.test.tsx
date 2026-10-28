import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";

import { HarnessSwitch } from "./HarnessSwitch";

const agileBundle = { manifest: { id: "oharness.default.agile", name: "OHarness Agile (skills-framework)" } };
const customBundle = { manifest: { id: "oharness.custom.demo", name: "Custom Demo" } };

const entries = [
  { id: agileBundle.manifest.id, name: agileBundle.manifest.name, isDefault: true, bundle: agileBundle },
  { id: customBundle.manifest.id, name: customBundle.manifest.name, isDefault: false, bundle: customBundle },
];

describe("HarnessSwitch (harness picker)", () => {
  let activate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    activate = vi.fn();
    useHarnessLibraryStore.setState({ entries: entries as never, hydrated: true, activate: activate as never });
    useHarnessSessionStore.setState({
      hydrated: true,
      enabled: true,
      activeBundle: agileBundle as never,
      hydrate: async () => undefined,
    });
  });

  afterEach(() => cleanup());

  it("shows the active harness by its short name", () => {
    render(<HarnessSwitch />);
    const trigger = screen.getByRole("button", { name: "Harness: OHarness Agile" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    expect(screen.queryByText(/skills-framework/)).toBeNull();
  });

  it("opens a menu with No harness and every harness, the active one selected", async () => {
    const user = userEvent.setup();
    render(<HarnessSwitch />);
    await user.click(screen.getByRole("button", { name: /^Harness:/ }));

    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^No harness/),
      expect.stringMatching(/^Custom Demo/),
      expect.stringMatching(/^OHarness Agile/),
    ]);
    expect(screen.getByRole("option", { name: /^OHarness Agile/ }).getAttribute("aria-selected")).toBe("true");
  });

  it("choosing a harness activates it and closes the menu", async () => {
    const user = userEvent.setup();
    render(<HarnessSwitch />);
    await user.click(screen.getByRole("button", { name: /^Harness:/ }));
    await user.click(screen.getByRole("option", { name: /^Custom Demo/ }));

    expect(activate).toHaveBeenCalledWith("oharness.custom.demo");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("No harness turns the harness off", async () => {
    const user = userEvent.setup();
    render(<HarnessSwitch />);
    await user.click(screen.getByRole("button", { name: /^Harness:/ }));
    await user.click(screen.getByRole("option", { name: /^No harness/ }));

    expect(useHarnessSessionStore.getState().enabled).toBe(false);
    expect(screen.getByRole("button", { name: "Harness: No harness" })).toBeTruthy();
  });

  it("works from the keyboard: arrows move, Enter picks, Escape closes", async () => {
    const user = userEvent.setup();
    render(<HarnessSwitch />);
    screen.getByRole("button", { name: /^Harness:/ }).focus();

    await user.keyboard("{Enter}");
    expect(screen.getByRole("listbox")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowUp}");
    await user.keyboard("{Enter}");
    expect(activate).toHaveBeenCalledWith("oharness.custom.demo");
  });

  it("offers Edit in Studio from the menu", async () => {
    const user = userEvent.setup();
    const onOpenStudio = vi.fn();
    render(<HarnessSwitch onOpenStudio={onOpenStudio} />);
    await user.click(screen.getByRole("button", { name: /^Harness:/ }));
    await user.click(screen.getByRole("button", { name: "Edit in Studio" }));

    expect(onOpenStudio).toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("keeps provider management out of the harness menu", async () => {
    const user = userEvent.setup();
    render(<HarnessSwitch />);
    await user.click(screen.getByRole("button", { name: /^Harness:/ }));
    expect(screen.queryByText("Providers")).toBeNull();
    expect(screen.queryByText("Manage providers")).toBeNull();
  });

  it("keyboard: the focused element announces the active option (F9)", async () => {
    const user = userEvent.setup();
    render(<HarnessSwitch />);
    screen.getByRole("button", { name: /^Harness:/ }).focus();
    await user.keyboard("{ArrowDown}");
    const focused = document.activeElement as HTMLElement;
    const active = focused.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active!)?.textContent).toContain("OHarness Agile");
    await user.keyboard("{ArrowUp}");
    expect(document.getElementById(focused.getAttribute("aria-activedescendant")!)?.textContent).toContain("Custom Demo");
  });
});
