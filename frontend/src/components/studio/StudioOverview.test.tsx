import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCanvasStore } from "@/store/canvasStore";
import { useShellStore } from "@/components/shell/shellStore";
import { openBundledHarness, newStudioHarness, openStudioPreset, openStudioExample } from "@/lib/studio";
import { fetchStudioExamples } from "@/lib/studioExamples";
import { api } from "@/lib/api";
import { useStudioDocsStore } from "@/lib/studioDocuments";
import { startCopilotFromOverview } from "@/lib/copilotEntry";
import { StudioOverview } from "./StudioOverview";

const flags = vi.hoisted(() => ({ copilot: false }));
vi.mock("@/lib/features", () => ({ get COPILOT_ENABLED() { return flags.copilot; } }));
vi.mock("@/lib/copilotEntry", () => ({ startCopilotFromOverview: vi.fn() }));

vi.mock("@/lib/studio", () => ({ openBundledHarness: vi.fn(), newStudioHarness: vi.fn(), openStudioPreset: vi.fn(), openStudioExample: vi.fn() }));
vi.mock("@/lib/studioExamples", async (original) => ({ ...(await original<typeof import("@/lib/studioExamples")>()), fetchStudioExamples: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: { harnesses: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() } },
}));
const h = vi.mocked(api.harnesses);
const rec = (id: string, name: string) => ({ id, name, description: "", created_at: "2026-10-05T10:00:00", updated_at: "2026-10-05T10:00:00" });

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  flags.copilot = false;
  h.list.mockResolvedValue([]);
  vi.mocked(fetchStudioExamples).mockResolvedValue([]);
  h.delete.mockResolvedValue(new Response(null, { status: 204 }));
  useCanvasStore.setState({ isRunning: false, nodes: [], edges: [], harnessMeta: { id: null, name: "Untitled harness", description: "" } });
  useShellStore.setState({ section: "studio", studioView: "overview", libraryOpen: false });
  useStudioDocsStore.setState({ items: [], loaded: false, error: "", saveState: "idle" });
});

it("an untouched new harness is not shown as a draft", async () => {
  render(<StudioOverview />);
  expect(await screen.findByText(/Nothing saved yet/)).toBeTruthy();
  expect(screen.queryByText("Untitled harness")).toBeNull();
  expect(screen.queryByRole("button", { name: /Continue editing/ })).toBeNull();
});

it("lists saved harnesses from the local engine and opens one", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop"), rec("h2", "Review crew")]);
  h.get.mockResolvedValue({ ...rec("h2", "Review crew"), graph_json: { nodes: [], edges: [] } });
  render(<StudioOverview />);
  expect(await screen.findByRole("heading", { name: "Triage loop" })).toBeTruthy();
  await userEvent.setup().click(screen.getByRole("button", { name: "Open Review crew" }));
  await waitFor(() => expect(useShellStore.getState().studioView).toBe("editor"));
  expect(useCanvasStore.getState().harnessMeta.id).toBe("h2");
});

it("deletes a saved harness only after confirmation, and cancel keeps it", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  render(<StudioOverview />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Delete Triage loop" }));
  expect(screen.getByText(/Delete “Triage loop” from this device/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(h.delete).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete Triage loop"));
  expect(screen.getByRole("heading", { name: "Triage loop" })).toBeTruthy();

  await user.click(screen.getByRole("button", { name: "Delete Triage loop" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(h.delete).toHaveBeenCalledWith("h1"));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Triage loop" })).toBeNull());
});

it("the open harness offers Continue editing", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  useCanvasStore.setState({ harnessMeta: { id: "h1", name: "Triage loop", description: "" } });
  render(<StudioOverview />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Continue editing Triage loop" }));
  expect(useShellStore.getState().studioView).toBe("editor");
  expect(screen.getByText("Open now")).toBeTruthy();
});

it("reports an unreachable engine and retries", async () => {
  h.list.mockRejectedValueOnce(new Error("down"));
  render(<StudioOverview />);
  expect((await screen.findByRole("alert")).textContent).toMatch(/local engine/);
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("heading", { name: "Triage loop" })).toBeTruthy();
});

it("labels every starting point a harness and opens each through its loader", async () => {
  vi.mocked(openBundledHarness).mockResolvedValue(undefined);
  render(<StudioOverview />);
  expect(screen.getByRole("heading", { name: "Harness Studio" })).toBeTruthy();
  // Every starting point is a bundled harness; "Example harness" is no longer a card label (#113).
  expect(screen.queryByText("Example harness")).toBeNull();
  expect(screen.getAllByText("Bundled harness")).toHaveLength(2);
  expect(screen.getByRole("heading", { name: "Agile Harness" })).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open harness: Agile Harness" }));
  await waitFor(() => expect(openBundledHarness).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: "Open harness: Agent + review" }));
  await waitFor(() => expect(openStudioPreset).toHaveBeenCalledOnce());
});

it("shows a loading failure and allows retry", async () => {
  vi.mocked(openBundledHarness).mockRejectedValue(new Error("offline"));
  render(<StudioOverview />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Open harness: Agile Harness" }));
  expect((await screen.findByText(/Could not load the bundled harness/))).toBeTruthy();
  expect((screen.getByRole("button", { name: "Open harness: Agile Harness" }) as HTMLButtonElement).disabled).toBe(false);
});

it("exposes new/import actions", async () => {
  render(<StudioOverview />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open .ohm" }));
  expect(useShellStore.getState().libraryOpen).toBe(true);
  await user.click(screen.getByRole("button", { name: "New harness" }));
  await waitFor(() => expect(newStudioHarness).toHaveBeenCalledOnce());
});

it("keeps an active run available to inspect while blocking replacement starters", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  useCanvasStore.setState({ isRunning: true, harnessMeta: { id: "h1", name: "Triage loop", description: "" } });
  render(<StudioOverview />);
  await screen.findByRole("heading", { name: "Triage loop" });
  for (const name of ["New harness", "Open .ohm", "Open harness: Agent + review", "Open harness: Agile Harness", "Delete Triage loop"]) {
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  }
  expect((screen.getByRole("button", { name: /Continue editing/ }) as HTMLButtonElement).disabled).toBe(false);
});

it("an opened but unedited starting point says it isn't saved yet, never 'Saving…'", async () => {
  useCanvasStore.setState({ nodes: [{ id: "a", type: "agent", position: { x: 0, y: 0 }, data: { label: "a" } } as never], harnessMeta: { id: null, name: "Agent + review", description: "" } });
  useStudioDocsStore.setState({ dirty: false });
  render(<StudioOverview />);
  expect(await screen.findByText(/saved here once you change it/)).toBeTruthy();
  expect(screen.queryByText("Saving…")).toBeNull();
});

it("an edited, not-yet-saved harness says Saving…", async () => {
  useCanvasStore.setState({ nodes: [{ id: "a", type: "agent", position: { x: 0, y: 0 }, data: { label: "a" } } as never], harnessMeta: { id: null, name: "Mine", description: "" } });
  useStudioDocsStore.setState({ dirty: true, saveState: "saving" });
  render(<StudioOverview />);
  expect(await screen.findByText("Saving…")).toBeTruthy();
});

it("Escape cancels a delete confirmation and returns focus to the row", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  render(<StudioOverview />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Delete Triage loop" }));
  expect(screen.getByText(/Delete “Triage loop” from this device/)).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByText(/Delete “Triage loop” from this device/)).toBeNull();
  expect(h.delete).not.toHaveBeenCalled();
  await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Delete Triage loop"));
});

it("with Copilot off, the hero offers New harness as the primary start and renders no composer", async () => {
  render(<StudioOverview />);
  expect(screen.queryByRole("textbox", { name: /Describe the harness/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /Draft with Nilo/ })).toBeNull();
  expect(screen.getByRole("button", { name: "New harness" }).className).toMatch(/bg-signal/);
  expect(screen.getByRole("button", { name: "Open .ohm" })).toBeTruthy();
});

it("with Copilot on, the composer hands the description to the Copilot entry point", async () => {
  flags.copilot = true;
  vi.mocked(startCopilotFromOverview).mockResolvedValue(undefined);
  render(<StudioOverview />);
  const user = userEvent.setup();
  const box = screen.getByRole("textbox", { name: /Describe the harness/ });
  const send = screen.getByRole("button", { name: "Draft with Nilo" }) as HTMLButtonElement;
  expect(send.disabled).toBe(true);
  await user.type(box, "  Research, write, then review  ");
  expect(send.disabled).toBe(false);
  await user.click(send);
  await waitFor(() => expect(startCopilotFromOverview).toHaveBeenCalledWith("Research, write, then review"));
  // New harness stays available, demoted to a secondary control.
  expect(screen.getByRole("button", { name: "New harness" }).className).not.toMatch(/bg-signal/);
});

it("with Copilot on, Ctrl+Enter submits and an unavailable Copilot is reported, keeping the text", async () => {
  flags.copilot = true;
  vi.mocked(startCopilotFromOverview).mockRejectedValue(new Error("Nilo isn't available yet."));
  render(<StudioOverview />);
  const user = userEvent.setup();
  const box = screen.getByRole("textbox", { name: /Describe the harness/ }) as HTMLTextAreaElement;
  await user.type(box, "A QA gate after build");
  await user.keyboard("{Control>}{Enter}{/Control}");
  expect((await screen.findByRole("alert")).textContent).toMatch(/isn't available yet/);
  expect(box.value).toBe("A QA gate after build");
});

it("with Copilot on, drafting is blocked while a run is in progress", async () => {
  flags.copilot = true;
  useCanvasStore.setState({ isRunning: true });
  render(<StudioOverview />);
  await userEvent.setup().type(screen.getByRole("textbox", { name: /Describe the harness/ }), "anything");
  expect((screen.getByRole("button", { name: "Draft with Nilo" }) as HTMLButtonElement).disabled).toBe(true);
});

it("shows a loading line until the harness list arrives", async () => {
  let resolve!: (v: never[]) => void;
  h.list.mockReturnValue(new Promise((r) => { resolve = r; }));
  render(<StudioOverview />);
  expect(screen.getByRole("status", { name: "Loading your harnesses" })).toBeTruthy();
  resolve([]);
  expect(await screen.findByText(/Nothing saved yet/)).toBeTruthy();
  expect(screen.queryByRole("status", { name: "Loading your harnesses" })).toBeNull();
});

it("an unsaved draft is listed with the saved harnesses and can be continued by name", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  useCanvasStore.setState({ nodes: [{ id: "a", type: "agent", position: { x: 0, y: 0 }, data: { label: "a" } } as never], harnessMeta: { id: null, name: "Mine", description: "" } });
  useStudioDocsStore.setState({ dirty: true, saveState: "saving" });
  render(<StudioOverview />);
  await screen.findByRole("heading", { name: "Triage loop" });
  const list = screen.getByRole("list", { name: "Your harnesses" });
  expect(list.querySelectorAll("li")).toHaveLength(2);
  await userEvent.setup().click(screen.getByRole("button", { name: "Continue editing Mine" }));
  expect(useShellStore.getState().studioView).toBe("editor");
});

it("an unsaved draft can be deleted after confirming, and nothing is saved", async () => {
  useCanvasStore.setState({ nodes: [{ id: "a", type: "agent", position: { x: 0, y: 0 }, data: { label: "a" } } as never], harnessMeta: { id: null, name: "My draft", description: "" } });
  render(<StudioOverview />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Delete My draft" }));
  expect(useCanvasStore.getState().nodes).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(useCanvasStore.getState().nodes).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Delete My draft" }));
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await waitFor(() => expect(useCanvasStore.getState().nodes).toHaveLength(0));
  expect(h.create).not.toHaveBeenCalled();
});

it("lists every extra example the catalog returns and opens it as a copy", async () => {
  const deepseek = { id: "oharness.example.deepseek-harness", name: "DeepSeek Harness", description: "Plan, code, review", bundle: { manifest: { id: "oharness.example.deepseek-harness" } } };
  vi.mocked(fetchStudioExamples).mockResolvedValue([
    { id: "oharness.default.agile", name: "Agile Harness", description: "", bundle: { manifest: { id: "oharness.default.agile" } } },
    { id: "sample:minimal-gate", name: "Agent + review", description: "", bundle: null, presetId: "minimal-gate" },
    deepseek,
  ] as never);
  render(<StudioOverview />);
  await userEvent.setup().click(await screen.findByRole("button", { name: "Open harness: DeepSeek Harness" }));
  expect(openStudioExample).toHaveBeenCalledWith(expect.objectContaining({ id: deepseek.id }));
  // The catalog card carries the same "Bundled harness" label as the two fixed cards (#113).
  expect(screen.queryByText("Example harness")).toBeNull();
  expect(screen.getAllByText("Bundled harness")).toHaveLength(3);
  // The two fixed cards already cover the Agile Harness and the example harness; they are not listed twice.
  expect(screen.getAllByRole("button", { name: "Open harness: Agile Harness" })).toHaveLength(1);
});

it("the starting points never call a harness a framework, sample, template, preset or Copilot", async () => {
  vi.mocked(fetchStudioExamples).mockResolvedValue([
    { id: "oharness.example.deepseek-harness", name: "DeepSeek Harness (dsh)", description: "Bundled harness modelled on DeepSeek Harness.", bundle: { manifest: { id: "oharness.example.deepseek-harness" } } },
  ] as never);
  render(<StudioOverview />);
  const section = (await screen.findByRole("heading", { name: "Starting points" })).closest("aside")!;
  await screen.findByRole("button", { name: "Open harness: DeepSeek Harness (dsh)" });
  // The source project may be cited by name; nothing else may use the retired words.
  const text = (section.textContent ?? "").replace(/skills-framework/g, "");
  expect(text).not.toMatch(/framework|sample|template|preset|copilot/i);
  // The section intro and the card labels say "bundled harness", never "example harness" (#113).
  expect(section.textContent).toContain("Open a bundled harness");
  expect(Array.from(section.querySelectorAll("article")).map((a) => a.firstElementChild?.textContent)).toEqual(["Bundled harness", "Bundled harness", "Bundled harness"]);
  // Card actions only (other controls may live in the section): one visible label,
  // and the accessible name starts with it (WCAG 2.5.3, label in name).
  const cards = Array.from(section.querySelectorAll("article")) as HTMLElement[];
  expect(cards).toHaveLength(3);
  for (const card of cards) {
    const button = within(card).getByRole("button");
    expect(button.textContent?.trim()).toBe("Open harness");
    expect(button.getAttribute("aria-label")).toMatch(/^Open harness: \S/);
  }
});

it("saved harnesses and starting points each sit in a named scroll rail, and clamped example text keeps its full text on hover", async () => {
  h.list.mockResolvedValue([rec("h1", "Triage loop")]);
  const long = "Example modelled on https://github.com/some-org/some-very-long-repository-name/tree/main/path/to/the/thing — plan mode, loop, guarded tools.";
  vi.mocked(fetchStudioExamples).mockResolvedValue([{ id: "ex1", name: "Long example", description: long, bundle: null }]);
  render(<StudioOverview />);
  await screen.findByRole("heading", { name: "Long example" });
  expect(screen.getByRole("list", { name: "Your harnesses" }).className).toContain("oh-rail");
  expect(screen.getByRole("group", { name: "Starting points" }).className).toContain("oh-rail");
  expect(screen.getByText(long).getAttribute("title")).toBe(long);
});
