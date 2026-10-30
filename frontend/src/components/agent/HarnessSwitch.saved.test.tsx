import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocaleStore } from "@/i18n/store";
import { axeViolations } from "@/test/axe";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessRecentStore } from "@/store/harnessRecentStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";
import { HarnessSwitch } from "./HarnessSwitch";
import { useChatHarness } from "./useChatHarness";

const bundle = (id: string, name: string) => ({ manifest: { id, name } });
const entry = (id: string, name: string, source: "bundled" | "saved" | "imported", description?: string) => ({
  id, name, description, source, isDefault: source === "bundled", bundle: bundle(id, name), addedAt: 1,
});
const agile = entry("agile", "Agile Harness", "bundled", "Plan, build and review.");
const mine = entry("s1", "Triage", "saved", "Sort inbound requests.");
const plain = entry("s2", "No Description", "saved");
const file = entry("i1", "From A File", "imported");

function seed(entries: unknown[], over: Record<string, unknown> = {}) {
  useHarnessLibraryStore.setState({
    entries: entries as never, hydrated: true, failed: false, savedFailed: false, activateFailed: null,
    hydrate: async () => undefined, activate: async () => true, ...over,
  } as never);
  useHarnessSessionStore.setState({ hydrated: true, enabled: false, activeBundle: bundle("agile", "Agile Harness") as never, hydrate: async () => undefined });
}
const open = async () => {
  const user = userEvent.setup();
  render(<HarnessSwitch onOpenStudio={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: /^(Harness|Sem harness):/ }));
  return user;
};

beforeEach(() => {
  localStorage.clear();
  useLocaleStore.setState({ locale: "en" });
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  useHarnessRecentStore.setState({ ids: [] });
});
afterEach(cleanup);

describe("harness selector with saved harnesses", () => {
  it("lists saved and imported harnesses together under Your harnesses, with the right line under each", async () => {
    seed([agile, mine, plain, file]);
    await open();
    const list = screen.getByRole("listbox", { name: "Harness" });
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringMatching(/^No harness/),
      expect.stringMatching(/^TriageSort inbound requests\./),
      expect.stringMatching(/^No DescriptionSaved in Studio$/),
      expect.stringMatching(/^From A FileImported harness$/),
      expect.stringMatching(/^Agile HarnessPlan, build and review\./),
    ]);
    expect(within(list).getAllByText("Your harnesses")).toHaveLength(1);
  });

  it("finds a saved harness by typing", async () => {
    const many = Array.from({ length: 8 }, (_, i) => entry(`h${i}`, `Filler ${i}`, "imported"));
    seed([agile, mine, ...many]);
    const user = await open();
    await user.type(screen.getByRole("combobox", { name: "Filter Harness" }), "triag");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringMatching(/^Triage/)]);
  });

  it("a saved list that failed says so with a retry, and the other harnesses stay listed", async () => {
    const hydrate = vi.fn(async () => undefined);
    seed([agile, file], { savedFailed: true, hydrate });
    const user = await open();
    expect(screen.getByRole("alert").textContent).toMatch(/Couldn.t load your saved harnesses/);
    expect(screen.getByRole("option", { name: /^From A File/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(hydrate).toHaveBeenCalled();
  });

  it("a saved harness that couldn't be opened says which one", async () => {
    seed([agile, mine], { activateFailed: { id: "s1", name: "Triage" } });
    await open();
    expect(screen.getByRole("alert").textContent).toBe("Couldn't open Triage. Try again.");
  });

  it("choosing a saved harness binds the chat only after it loaded", async () => {
    let finish: (ok: boolean) => void = () => undefined;
    const activate = vi.fn(() => new Promise<boolean>((r) => { finish = r; }));
    seed([agile, mine], { activate });
    const id = useThreadStore.getState().createThread("Chat", { kind: "none" });
    useThreadStore.setState({ activeThreadId: id });
    const user = await open();
    await user.click(screen.getByRole("option", { name: /^Triage/ }));
    expect(activate).toHaveBeenCalledWith("s1");
    expect(useThreadStore.getState().threads[0].harness).toEqual({ kind: "none" });
    finish(true);
    await waitFor(() => expect(useThreadStore.getState().threads[0].harness).toMatchObject({ kind: "harness", id: "s1" }));
    expect(useHarnessRecentStore.getState().ids[0]).toBe("s1");
  });

  it("a saved harness that fails to load does not rebind the chat", async () => {
    const activate = vi.fn(async () => false);
    seed([agile, mine], { activate });
    const id = useThreadStore.getState().createThread("Chat", { kind: "none" });
    useThreadStore.setState({ activeThreadId: id });
    const user = await open();
    await user.click(screen.getByRole("option", { name: /^Triage/ }));
    await waitFor(() => expect(activate).toHaveBeenCalled());
    expect(useThreadStore.getState().threads[0].harness).toEqual({ kind: "none" });
    expect(useHarnessRecentStore.getState().ids).toEqual([]);
  });

  it("blocks sending until the saved harness the chat points at is the one loaded", () => {
    seed([agile, mine]);
    const id = useThreadStore.getState().createThread("Chat", { kind: "harness", id: "s1", name: "Triage" });
    useThreadStore.setState({ activeThreadId: id });
    const { result, rerender } = renderHook(() => useChatHarness());
    expect(result.current.canSend).toBe(false);
    useHarnessSessionStore.setState({ enabled: true, activeBundle: bundle("s1", "Triage") as never });
    rerender();
    expect(result.current.canSend).toBe(true);
  });

  it("speaks Portuguese from the catalog", async () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    seed([agile, plain], { savedFailed: true });
    await open();
    const list = screen.getByRole("listbox", { name: "Harness" });
    expect(within(list).getByText("Seus harnesses")).toBeTruthy();
    expect(within(list).getByText("Harnesses incluídos")).toBeTruthy();
    expect(within(list).getByText("Salvo no Studio")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível carregar seus harnesses salvos/);
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });

  it("has no axe violations open, with the error notice", async () => {
    seed([agile, mine, file], { savedFailed: true });
    await open();
    expect(await axeViolations(document.body)).toEqual([]);
  });
});
