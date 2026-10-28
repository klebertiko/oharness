import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { HARNESS_RECENT_KEY, useHarnessRecentStore } from "@/store/harnessRecentStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";
import { HarnessSwitch } from "./HarnessSwitch";

const bundle = (id: string, name: string) => ({ manifest: { id, name } });
const entry = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, isDefault: false, bundle: bundle(id, name), addedAt: 1, ...over });
const agile = entry("agile", "Agile Harness", { isDefault: true, description: "Plan, build and review in small loops. Extra." });
const many = (n: number) => Array.from({ length: n }, (_, i) => entry(`h${i}`, `Harness ${i}`));

function seed(entries: unknown[], over: Record<string, unknown> = {}) {
  useHarnessLibraryStore.setState({ entries: entries as never, hydrated: true, failed: false, hydrate: async () => undefined, ...over } as never);
  useHarnessSessionStore.setState({ hydrated: true, enabled: true, activeBundle: bundle("agile", "Agile Harness") as never, hydrate: async () => undefined });
}
const open = async () => {
  const user = userEvent.setup();
  render(<HarnessSwitch onOpenStudio={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /^Harness:/ }));
  return user;
};

beforeEach(() => {
  localStorage.clear();
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  useHarnessRecentStore.setState({ ids: [] });
});
afterEach(cleanup);

describe("harness selector", () => {
  it("leads with No harness, then groups your harnesses before the bundled ones", async () => {
    seed([agile, entry("mine", "My Harness", { description: "Triage inbound requests." })]);
    await open();
    const list = screen.getByRole("listbox", { name: "Harness" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^No harnessTalk to the model directly/),
      expect.stringMatching(/^My HarnessTriage inbound requests\./),
      expect.stringMatching(/^Agile HarnessPlan, build and review in small loops\./),
    ]);
    expect(within(list).getByText("Your harnesses")).toBeTruthy();
    expect(within(list).getByText("Bundled harnesses")).toBeTruthy();
  });

  it("has no filter for a short list and one for a long list", async () => {
    seed([agile, ...many(3)]);
    await open();
    expect(screen.queryByRole("combobox", { name: /Filter/ })).toBeNull();
    cleanup();
    seed([agile, ...many(8)]);
    const user = await open();
    const filter = screen.getByRole("combobox", { name: "Filter Harness" });
    await user.type(filter, "harness 7");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringMatching(/^Harness 7/)]);
  });

  it("puts recent choices first in a long list, and records a choice as recent", async () => {
    seed([agile, ...many(8)]);
    localStorage.setItem(HARNESS_RECENT_KEY, JSON.stringify(["h5", "h2"]));
    const user = await open();
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options[1]).toMatch(/^Harness 5/);
    expect(options[2]).toMatch(/^Harness 2/);
    expect(screen.getByText("Recent")).toBeTruthy();
    await user.click(screen.getByRole("option", { name: /^Harness 7/ }));
    expect(useHarnessRecentStore.getState().ids[0]).toBe("h7");
  });

  it("marks the selected harness and shows its name on the trigger", async () => {
    seed([agile]);
    await open();
    expect(screen.getByRole("option", { name: /^Agile Harness/ }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("option", { name: /^No harness/ }).getAttribute("aria-selected")).toBe("false");
  });

  it("says when a harness is gone and keeps it visible, disabled", async () => {
    seed([agile]);
    useThreadStore.getState().createThread("Old", { kind: "harness", id: "gone", name: "Retired Harness" });
    await open();
    expect(screen.getByRole("button", { name: "Harness: Retired Harness (unavailable)" })).toBeTruthy();
    const gone = screen.getByRole("option", { name: /^Retired Harness/ });
    expect(gone.getAttribute("aria-disabled")).toBe("true");
    expect(gone.textContent).toMatch(/No longer available/);
  });

  it("loading: says so, still offers No harness", async () => {
    seed([], { hydrated: false });
    useHarnessSessionStore.setState({ enabled: false, activeBundle: null });
    await open();
    expect(screen.getByRole("status").textContent).toBe("Loading harnesses…");
    expect(screen.getByRole("option", { name: /^No harness/ })).toBeTruthy();
  });

  it("error: explains and offers Try again", async () => {
    const hydrate = vi.fn(async () => undefined);
    seed([], { hydrated: false, failed: true, hydrate });
    useHarnessSessionStore.setState({ enabled: false, activeBundle: null });
    const user = await open();
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn.t load harnesses/);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(hydrate).toHaveBeenCalled();
  });

  it("empty: points to Studio instead of an empty list", async () => {
    seed([]);
    useHarnessSessionStore.setState({ enabled: false, activeBundle: null });
    await open();
    expect(screen.getByText(/No harnesses yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Studio" })).toBeTruthy();
  });

  it("offers exactly one way into Studio and never provider management", async () => {
    seed([agile, ...many(2)]);
    await open();
    const popover = document.querySelector("[data-combobox-popover]") as HTMLElement;
    expect(within(popover).getAllByRole("button").map((b) => b.textContent)).toEqual(["Edit in Studio"]);
    expect(popover.textContent).not.toMatch(/provider|connect|api key|credential|model(?! directly)/i);
  });
});
