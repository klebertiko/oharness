import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useShellStore } from "./shellStore";
import { useCanvasStore } from "@/store/canvasStore";
import { useHarnessSessionStore, type HarnessBundle } from "@/store/harnessSessionStore";
import { HarnessLibrarySheet } from "./HarnessLibrarySheet";
vi.mock("@/components/harnesses/HarnessLibrary", () => ({
  HarnessLibrary: ({ onPicked }: { onPicked: (bundle: HarnessBundle) => void }) => <button type="button" onClick={() => onPicked(useHarnessSessionStore.getState().activeBundle!)}>Open selected bundle</button>,
}));
afterEach(cleanup);
it("opens the selected library bundle in the editor before dismissing the sheet", async () => {
  useShellStore.setState({ section: "studio", studioView: "overview", libraryOpen: true });
  useHarnessSessionStore.setState({ activeBundle: {
    manifest: { id: "imported", name: "Imported harness" },
    graph: { nodes: [{ id: "imported-agent", type: "agent", position: { x: 32, y: 48 }, data: { label: "Imported agent" } }], edges: [] },
  } });
  render(<HarnessLibrarySheet />);
  await userEvent.setup().click(screen.getByRole("button", { name: "Open selected bundle" }));
  expect(useShellStore.getState().studioView).toBe("editor");
  expect(useShellStore.getState().libraryOpen).toBe(false);
  expect(useCanvasStore.getState().nodes[0].id).toBe("imported-agent");
});
