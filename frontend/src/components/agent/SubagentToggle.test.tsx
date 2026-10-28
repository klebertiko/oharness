import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSubagentStore } from "@/store/subagentStore";
import { axeViolations } from "@/test/axe";
import { SubagentToggle } from "./SubagentToggle";

describe("SubagentToggle", () => {
  afterEach(() => {
    cleanup();
    useSubagentStore.setState({ enabled: false });
  });

  it("is off by default and flips with the keyboard", async () => {
    const user = userEvent.setup();
    const { container } = render(<SubagentToggle />);
    const toggle = screen.getByRole("switch", { name: "Subagents off" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(useSubagentStore.getState().enabled).toBe(true);
    expect(screen.getByRole("switch", { name: "Subagents on" }).getAttribute("aria-checked")).toBe("true");
    expect(await axeViolations(container)).toEqual([]);
  });
});
