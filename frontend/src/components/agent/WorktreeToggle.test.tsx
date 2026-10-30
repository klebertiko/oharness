import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRunWorktreeStore } from "@/store/runWorktreeStore";
import { axeViolations } from "@/test/axe";
import { WorktreeToggle } from "./WorktreeToggle";

describe("WorktreeToggle", () => {
  afterEach(() => {
    cleanup();
    useRunWorktreeStore.setState({ enabled: false });
  });

  it("is off by default, says what it does, and flips with the keyboard", async () => {
    const user = userEvent.setup();
    const { container } = render(<WorktreeToggle />);
    const toggle = screen.getByRole("switch", { name: "Own worktree off" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.getAttribute("title")).toMatch(/own copy of your folder/i);
    expect(toggle.getAttribute("title")).toMatch(/Plan mode/);
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(useRunWorktreeStore.getState().enabled).toBe(true);
    expect(screen.getByRole("switch", { name: "Own worktree on" }).getAttribute("aria-checked")).toBe("true");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("can be disabled while a run is live", () => {
    render(<WorktreeToggle disabled />);
    expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(true);
  });
});
