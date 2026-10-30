import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HarnessLibrary } from "./HarnessLibrary";
import { useHarnessLibraryStore, DEFAULT_BUNDLE_ID } from "@/store/harnessLibraryStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
vi.mock("@/lib/bundlesApi", async (original) => ({ ...await original<typeof import("@/lib/bundlesApi")>(), validateBundle: vi.fn(async () => ({ ok: true, errors: [] })) }));
const builtin = { schemaVersion: "1.1.0", manifest: { id: DEFAULT_BUNDLE_ID, name: "Agile" }, graph: { nodes: [], edges: [] } };
afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  useHarnessSessionStore.setState({ activeBundle: builtin, enabled: false });
  useHarnessLibraryStore.setState({ hydrated: true, entries: [{ id: DEFAULT_BUNDLE_ID, name: "Agile", isDefault: true, source: "bundled", bundle: builtin, addedAt: 0 }] });
});
it("opens an imported copy with the default ID instead of substituting the built-in bundle", async () => {
  const edited = { ...builtin, manifest: { ...builtin.manifest, name: "Edited copy" }, graph: { nodes: [{ id: "my-edit", role: "agent" }], edges: [] } };
  const picked = vi.fn();
  const { container } = render(<HarnessLibrary onPicked={picked} />);
  await userEvent.setup().upload(container.querySelector("input")!, new File([JSON.stringify(edited)], "edited.ohm", { type: "application/json" }));
  await waitFor(() => expect(picked).toHaveBeenCalledWith(edited));
  expect(useHarnessLibraryStore.getState().entries[0].bundle).toEqual(builtin);
  expect(useHarnessSessionStore.getState().enabled).toBe(false);
});
it("opens the current library entry for editing without turning the chat harness on", async () => {
  const picked = vi.fn();
  render(<HarnessLibrary onPicked={picked} />);
  await userEvent.setup().click(screen.getByText("Agile", { exact: true }));
  expect(picked).toHaveBeenCalledWith(builtin);
  expect(useHarnessSessionStore.getState().enabled).toBe(false);
});
it("retains the standalone library Use action", async () => {
  useHarnessSessionStore.setState({ activeBundle: null });
  render(<HarnessLibrary />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Use Agile" }));
  expect(useHarnessSessionStore.getState().activeBundle).toEqual(builtin);
  expect(useHarnessSessionStore.getState().enabled).toBe(true);
});

it("leaves harnesses saved in Studio to Studio's own overview", async () => {
  const saved = { id: "s1", name: "Saved In Studio", isDefault: false, source: "saved" as const, bundle: { manifest: { id: "s1", name: "Saved In Studio" } }, addedAt: 1 };
  useHarnessLibraryStore.setState({ entries: [...useHarnessLibraryStore.getState().entries, saved] });
  render(<HarnessLibrary onPicked={vi.fn()} />);
  expect(screen.queryByText("Saved In Studio")).toBeNull();
});
