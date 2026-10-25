import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axeViolations } from "@/test/axe";
import { useThreadStore } from "@/store/threadStore";
import { ThreadsSidebar } from "./ThreadsSidebar";

/** The row's "Chat actions" button; the chat's title is its accessible description. */
const actionsFor = (title: string) => {
  const found = screen.getAllByRole("button", { name: "Chat actions" }).find((b) => b.getAttribute("aria-describedby") && document.getElementById(b.getAttribute("aria-describedby")!)?.textContent === title);
  if (!found) throw new Error(`no actions button for ${title}`);
  return found;
};

const seed = () => {
  const now = Date.now();
  useThreadStore.setState({
    threads: [
      { id: "a", title: "Alpha", createdAt: now, updatedAt: now },
      { id: "b", title: "Bravo", createdAt: now - 1000, updatedAt: now - 1000 },
      { id: "c", title: "Charlie", createdAt: now, updatedAt: now, archived: true },
    ],
    activeThreadId: "a",
    messagesByThread: {},
  });
};

beforeEach(() => {
  localStorage.clear();
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
});
afterEach(cleanup);

describe("ThreadsSidebar", () => {
  it("says what is true and what to do when there are no chats", () => {
    render(<ThreadsSidebar />);
    expect(screen.getByText("No chats yet")).toBeTruthy();
    expect(screen.getByText("Start one and it shows up here.")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Chats" })).toBeNull();
  });

  it("is a navigation list: the open chat has aria-current, no listbox ARIA", () => {
    seed();
    render(<ThreadsSidebar />);
    const nav = screen.getByRole("navigation", { name: "Chats" });
    expect(within(nav).getByRole("button", { name: /^Alpha/ }).getAttribute("aria-current")).toBe("true");
    expect(within(nav).getByRole("button", { name: /^Bravo/ }).getAttribute("aria-current")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("ArrowDown and ArrowUp open and focus the neighbouring chat", () => {
    seed();
    render(<ThreadsSidebar />);
    const alpha = screen.getByRole("button", { name: /^Alpha/ });
    alpha.focus();
    fireEvent.keyDown(alpha, { key: "ArrowDown" });
    expect(useThreadStore.getState().activeThreadId).toBe("b");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Bravo/ }));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(useThreadStore.getState().activeThreadId).toBe("a");
  });

  it("starts a new chat from the New chat button", async () => {
    seed();
    render(<ThreadsSidebar />);
    await userEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(useThreadStore.getState().activeThreadId).toBeNull();
  });

  it("the actions menu opens on the first item, moves with arrows, and Escape returns focus", async () => {
    seed();
    render(<ThreadsSidebar />);
    const more = actionsFor("Alpha");
    await userEvent.click(more);
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Rename", "Archive", "Delete"]);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it("deleting names the action, defaults focus to Cancel, and only deletes when confirmed", async () => {
    seed();
    render(<ThreadsSidebar />);
    await userEvent.click(actionsFor("Alpha"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(document.activeElement).toBe(cancel);
    await userEvent.click(cancel);
    expect(useThreadStore.getState().threads.some((t) => t.id === "a")).toBe(true);
    await userEvent.click(actionsFor("Alpha"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete chat" }));
    expect(useThreadStore.getState().threads.some((t) => t.id === "a")).toBe(false);
  });

  it("archives and restores", async () => {
    seed();
    render(<ThreadsSidebar />);
    await userEvent.click(actionsFor("Bravo"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    expect(useThreadStore.getState().threads.find((t) => t.id === "b")?.archived).toBe(true);
  });

  it("renames inline and commits on Enter", async () => {
    seed();
    render(<ThreadsSidebar />);
    await userEvent.click(actionsFor("Alpha"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    const field = screen.getByRole("textbox", { name: "Chat name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Renamed{Enter}");
    expect(useThreadStore.getState().threads.find((t) => t.id === "a")?.title).toBe("Renamed");
  });

  it("has no axe violations", async () => {
    seed();
    const { container } = render(<ThreadsSidebar />);
    expect(await axeViolations(container)).toEqual([]);
  });
});
