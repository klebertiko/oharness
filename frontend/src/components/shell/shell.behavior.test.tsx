import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AppShell } from "./AppShell";
import { ShortcutsModal } from "./ShortcutsModal";
import { shellNavCommands } from "./commands";
import { useShellStore } from "./shellStore";
import { documentLang } from "./boot";

vi.mock("@/components/providers/providerStore", () => ({
  useProviderStore: (sel: (s: { hydrate: () => Promise<void> }) => unknown) => sel({ hydrate: async () => {} }),
}));

const setWidth = (w: number) => {
  Object.defineProperty(window, "innerWidth", { value: w, configurable: true, writable: true });
};

const renderShell = () =>
  render(
    <AppShell
      commands={[]}
      harnessName="h"
      onHarnessNameChange={() => {}}
      mode="Agent"
      running={false}
      nodeCount={0}
      edgeCount={0}
      selectedId={null}
      backendOk
      toolbar={null}
      left={null}
      stage={<div>stage</div>}
      right={null}
    />,
  );

beforeEach(() => {
  localStorage.clear();
  setWidth(1440);
  useShellStore.setState({
    sidebar: "open",
    sidebarWidth: 280,
    dockOpen: true,
    dockSuppressed: false,
    dockWidth: 420,
    drawerOpen: false,
    section: "chats",
    leftOpen: true,
    rightOpen: true,
    hydrated: true,
    paletteOpen: false,
    keymapOpen: false,
  });
});
afterEach(() => {
  cleanup();
  setWidth(1440);
});

it("Ctrl+B cycles open, the icon strip, then hidden, and the center is the flexible column", () => {
  renderShell();
  const main = document.getElementById("oh-main")!;
  expect(main.className).toContain("flex-1");
  const side = () => document.getElementById("oh-sidebar");
  expect(side()?.style.width).toBe("280px");
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(useShellStore.getState().sidebar).toBe("rail");
  expect(side()?.style.width).toBe("56px");
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(useShellStore.getState().sidebar).toBe("hidden");
  expect(side()?.style.width).toBe("0px");
  expect(screen.getByRole("button", { name: "Show sidebar" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(useShellStore.getState().sidebar).toBe("open");
});

it("keeps the sidebar state when the destination changes, including Providers", () => {
  renderShell();
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(useShellStore.getState().sidebar).toBe("hidden");
  fireEvent.keyDown(window, { key: "6", altKey: true }); // not a destination
  useShellStore.getState().setSection("providers");
  expect(useShellStore.getState().section).toBe("providers");
  expect(useShellStore.getState().sidebar).toBe("hidden");
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(useShellStore.getState().sidebar).toBe("open");
});

it("puts the sidebar toggle and New session in the title bar", () => {
  renderShell();
  const header = document.getElementById("oh-titlebar")!;
  expect(header.querySelector("button")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "New session" }).length).toBeGreaterThan(0);
  useShellStore.setState({ sidebar: "hidden", leftOpen: false });
  expect(screen.getAllByRole("button", { name: "New session" }).length).toBeGreaterThan(0);
});

it("closes the dock with Ctrl+\\", () => {
  renderShell();
  expect(document.getElementById("oh-dock")).toBeTruthy();
  fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
  expect(useShellStore.getState().dockOpen).toBe(false);
  expect(document.getElementById("oh-dock")).toBeNull();
});

it("opens a drawer below 768px and Escape closes it", () => {
  setWidth(700);
  useShellStore.setState({ drawerOpen: false, sidebar: "open" });
  renderShell();
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(useShellStore.getState().drawerOpen).toBe(true);
  expect(screen.getByRole("dialog", { name: "Sidebar" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useShellStore.getState().drawerOpen).toBe(false);
});

it("gives focus back to what opened the drawer when it closes", async () => {
  setWidth(700);
  useShellStore.setState({ drawerOpen: false, sidebar: "open" });
  renderShell();
  const opener = document.createElement("button");
  opener.textContent = "Open drawer";
  document.body.appendChild(opener);
  opener.focus();
  act(() => useShellStore.setState({ drawerOpen: true }));
  expect(document.getElementById("oh-sidebar")?.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(useShellStore.getState().drawerOpen).toBe(false);
  expect(document.activeElement).toBe(opener);
  opener.remove();
});

it("finds a command in the shortcut modal by the key that was pressed", () => {
  render(<ShortcutsModal open commands={shellNavCommands()} onClose={() => {}} />);
  const field = screen.getByRole("textbox", { name: "Search shortcuts" });
  fireEvent.keyDown(field, { key: "b", ctrlKey: true });
  expect(screen.getByText("Toggle left panel")).toBeTruthy();
  expect(screen.queryByText("Go to Studio")).toBeNull();
});

it("follows the browser language when nothing is saved", () => {
  expect(documentLang(null, ["pt-BR", "en"])).toBe("pt-BR");
  expect(documentLang(null, ["en-US"])).toBe("en");
  expect(documentLang("en", ["pt-BR"])).toBe("en");
});
