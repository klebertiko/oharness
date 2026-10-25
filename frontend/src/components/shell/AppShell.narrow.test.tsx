import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "./AppShell";

vi.mock("@/components/providers/providerStore", () => ({
  useProviderStore: (sel: (s: { hydrate: () => Promise<void> }) => unknown) => sel({ hydrate: async () => {} }),
}));

const setWidth = (w: number) => {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
};
const onDismiss = vi.fn();

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
      onDismissRight={onDismiss}
      stage={<div>stage</div>}
    />,
  );

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  setWidth(1024);
});

it("on a wide window the inspector is a column, not a sheet", () => {
  setWidth(1280);
  renderShell();
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("below 1020px the inspector opens as a sheet with a visible Close", async () => {
  setWidth(800);
  renderShell();
  const dialog = await screen.findByRole("dialog", { name: "Inspector" });
  expect(within(dialog).getByText("Node settings")).toBeTruthy();
  await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(onDismiss).toHaveBeenCalled();
});

it("with nothing to inspect there is no sheet", () => {
  setWidth(800);
  renderShell(null);
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("the first tab stop is the skip link, and it lands on the main region", async () => {
  setWidth(1280);
  renderShell();
  await userEvent.tab();
  const skip = screen.getByRole("link", { name: "Skip to main content" });
  expect(document.activeElement).toBe(skip);
  await userEvent.click(skip);
  expect(document.activeElement).toBe(document.getElementById("oh-main"));
});
