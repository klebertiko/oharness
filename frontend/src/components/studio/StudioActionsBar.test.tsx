import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useShellStore } from "@/components/shell/shellStore";
import * as docs from "@/lib/studioDocuments";
import * as studio from "@/lib/studio";
import { StudioActionsBar } from "./StudioActionsBar";

vi.mock("@/lib/studioDocuments", async (original) => ({
  ...(await original<typeof import("@/lib/studioDocuments")>()),
  saveHarnessNow: vi.fn().mockResolvedValue(undefined),
  saveHarnessAs: vi.fn().mockResolvedValue(undefined),
  discardStudioChanges: vi.fn().mockResolvedValue(undefined),
  removeSavedHarness: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  openStudioExample: vi.fn(),
  newStudioHarness: vi.fn(),
}));
vi.mock("@/lib/studioExamples", async (original) => ({
  ...(await original<typeof import("@/lib/studioExamples")>()),
  fetchStudioExamples: vi.fn().mockResolvedValue([
    { id: "oharness.default.agile", name: "Agile Harness", description: "", bundle: { manifest: { id: "oharness.default.agile" } } },
    { id: "sample:minimal-gate", name: "Agent + review", description: "", bundle: null, presetId: "minimal-gate" },
    { id: "oharness.example.deepseek-harness", name: "DeepSeek Harness", description: "", bundle: { manifest: { id: "oharness.example.deepseek-harness" } } },
  ]),
}));

const node = { id: "a", type: "agent" as const, position: { x: 0, y: 0 }, data: { label: "a" } };
const setDraft = (id: string | null, bundleId = "oharness.studio.export") => {
  useCanvasStore.setState({ isRunning: false, nodes: [node], edges: [], harnessMeta: { id, name: "My harness", description: "" } });
  useHarnessSessionStore.setState({ activeBundle: { manifest: { id: bundleId } } });
};

beforeEach(() => {
  vi.clearAllMocks();
  useShellStore.setState({ section: "studio", studioView: "editor" });
  docs.useStudioDocsStore.setState({ saveState: "idle", dirty: false });
});
afterEach(cleanup);

it("names the harness and says where it came from and whether it is saved", () => {
  setDraft(null, "oharness.example.deepseek-harness");
  render(<StudioActionsBar />);
  expect(screen.getByText("My harness")).toBeTruthy();
  expect(screen.getByText("Bundled harness")).toBeTruthy();
  expect(screen.getByText("Not saved yet")).toBeTruthy();
  cleanup();
  setDraft("h1");
  docs.useStudioDocsStore.setState({ dirty: true });
  render(<StudioActionsBar />);
  expect(screen.getByText("Saved harness")).toBeTruthy();
  expect(screen.getByText("Unsaved changes")).toBeTruthy();
});

it("shows every file action as a labelled button", () => {
  setDraft(null);
  render(<StudioActionsBar />);
  for (const name of ["New", "Open bundled harness", "Save", "Save as…", "Discard", "Delete draft"]) {
    expect(screen.getByRole("button", { name })).toBeTruthy();
  }
});

it("Save as asks for a name, then saves a copy under it", async () => {
  setDraft(null);
  render(<StudioActionsBar />);
  await userEvent.click(screen.getByRole("button", { name: "Save as…" }));
  const input = screen.getByRole("textbox", { name: "Name of the copy" });
  await userEvent.clear(input);
  await userEvent.type(input, "Copy of it");
  await userEvent.click(screen.getByRole("button", { name: "Save copy" }));
  await waitFor(() => expect(docs.saveHarnessAs).toHaveBeenCalledWith("Copy of it"));
});

it("Discard and Delete ask for confirmation first, and Cancel does nothing", async () => {
  setDraft("h1");
  docs.useStudioDocsStore.setState({ dirty: true });
  render(<StudioActionsBar />);
  await userEvent.click(screen.getByRole("button", { name: "Discard" }));
  expect(docs.discardStudioChanges).not.toHaveBeenCalled();
  await userEvent.click(within(screen.getByRole("group", { name: "Confirm discard" })).getByRole("button", { name: "Cancel" }));
  expect(docs.discardStudioChanges).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.click(within(screen.getByRole("group", { name: "Confirm delete" })).getByRole("button", { name: "Cancel" }));
  expect(docs.removeSavedHarness).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: "Delete" }));
  await userEvent.click(within(screen.getByRole("group", { name: "Confirm delete" })).getByRole("button", { name: "Delete harness" }));
  await waitFor(() => expect(docs.removeSavedHarness).toHaveBeenCalledWith("h1"));
});

it("deleting a draft discards it, and a bundled harness offers no Delete", async () => {
  setDraft(null);
  render(<StudioActionsBar />);
  await userEvent.click(screen.getByRole("button", { name: "Delete draft" }));
  await userEvent.click(within(screen.getByRole("group", { name: "Confirm delete" })).getByRole("button", { name: "Delete harness" }));
  await waitFor(() => expect(docs.discardStudioChanges).toHaveBeenCalled());
  cleanup();
  setDraft(null, "oharness.example.deepseek-harness");
  render(<StudioActionsBar />);
  expect(screen.queryByRole("button", { name: /^Delete/ })).toBeNull();
});

it("lists every example the catalog returns and opens the chosen one as a copy", async () => {
  setDraft("h1");
  render(<StudioActionsBar />);
  await userEvent.click(screen.getByRole("button", { name: "Open bundled harness" }));
  for (const n of ["Agile Harness", "Agent + review", "DeepSeek Harness"]) {
    expect(await screen.findByRole("option", { name: new RegExp("^" + n.replace("+", "\\+")) })).toBeTruthy();
  }
  await userEvent.click(screen.getByRole("option", { name: /DeepSeek Harness/ }));
  expect(studio.openStudioExample).toHaveBeenCalledWith(expect.objectContaining({ id: "oharness.example.deepseek-harness" }));
});

it("Save runs the explicit save", async () => {
  setDraft(null);
  render(<StudioActionsBar />);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(docs.saveHarnessNow).toHaveBeenCalled();
});
