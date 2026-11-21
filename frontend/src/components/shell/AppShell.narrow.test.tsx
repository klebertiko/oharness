import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";
import { useShellStore } from "./shellStore";

vi.mock("@/components/providers/providerStore", () => ({
  useProviderStore: (sel: (s: { hydrate: () => Promise<void> }) => unknown) => sel({ hydrate: async () => {} }),
}));

const setWidth = (w: number) => {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
};

const renderShell = (right: React.ReactNode = <div>Node settings</div>) =>
  render(
    <AppShell
      commands={[]}
      harnessName="h"
      onHarnessNameChange={() => {}}
      mode="Studio"
      running={false}
      nodeCount={1}
      edgeCount={0}
      selectedId="n1"
      backendOk
      toolbar={null}
      left={null}
      right={right}
      stage={<div>stage</div>}
    />,
  );

beforeEach(() => {
  useShellStore.setState({ dockOpen: true, dockSuppressed: false, dockWidth: 420, sidebar: "open", sidebarWidth: 280, hydrated: true });
});
afterEach(() => {
  cleanup();
  setWidth(1280);
});

it("on a wide window the dock is a column anchored to the right, not a centered dialog", () => {
  setWidth(1440);
  renderShell();
  expect(screen.queryByRole("dialog")).toBeNull();
  const dock = document.getElementById("oh-dock");
  expect(dock).toBeTruthy();
  expect(dock?.className).toContain("border-l");
  expect(screen.getByText("Node settings")).toBeTruthy();
});

it("when the center cannot keep its minimum, the dock anchors to the right edge", () => {
  setWidth(700);
  renderShell();
  const dock = document.getElementById("oh-dock");
  expect(dock?.className).toContain("right-0");
  expect(document.getElementById("oh-main")).toBeTruthy();
});

it("with the dock closed there is no dock", () => {
  setWidth(1440);
  useShellStore.setState({ dockOpen: false, dockSuppressed: true });
  renderShell(null);
  expect(document.getElementById("oh-dock")).toBeNull();
});

it("the first tab stop is the skip link, and it lands on the main region", async () => {
  setWidth(1440);
  renderShell();
  await userEvent.tab();
  const skip = screen.getByRole("link", { name: "Skip to main content" });
  expect(document.activeElement).toBe(skip);
  await userEvent.click(skip);
  expect(document.activeElement).toBe(document.getElementById("oh-main"));
});
