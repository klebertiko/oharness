import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useWorkspaceStore } from "@/store/workspaceStore";
import { WorkspacePicker } from "./WorkspacePicker";

/* providers-recovery F9: the folder chip shares the one Combobox — the
   focused element announces the active option and Escape returns focus. */

const projects = [{ id: "p1", name: "OHarness", rootPath: "D:/src/OHarness" }];

describe("WorkspacePicker", () => {
  let setChosen: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    setChosen = vi.fn();
    useWorkspaceStore.setState({
      projects: projects as never,
      chosenProjectId: null,
      setChosen: setChosen as never,
      hydrate: (async () => undefined) as never,
    });
  });
  afterEach(() => cleanup());

  it("opens with focus on the list, announces the active row and chooses by keyboard", async () => {
    const user = userEvent.setup();
    render(<WorkspacePicker />);
    const trigger = screen.getByRole("button", { name: "Working folder: No folder" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("listbox");
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    const list = screen.getByRole("listbox", { name: "Chat working folder" });
    expect(document.activeElement).toBe(list);
    await user.keyboard("{ArrowDown}");
    expect(document.getElementById(list.getAttribute("aria-activedescendant")!)?.textContent).toContain("OHarness");
    await user.keyboard("{Enter}");
    expect(setChosen).toHaveBeenCalledWith("p1");
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape closes and returns focus to the chip", async () => {
    const user = userEvent.setup();
    render(<WorkspacePicker />);
    await user.click(screen.getByRole("button", { name: /^Working folder/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Working folder/ }));
  });
});
