import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useSubagentStore } from "@/store/subagentStore";
import { axeViolations } from "@/test/axe";
import { SubagentToggle } from "./SubagentToggle";

describe("subagent choice is remembered", () => {
  afterEach(() => {
    localStorage.clear();
    useSubagentStore.setState({ enabled: false });
  });

  it("is saved when set, and only a literal true is trusted when read back", async () => {
    useSubagentStore.getState().setEnabled(true);
    expect(JSON.parse(localStorage.getItem("oh.subagents.v1") ?? "{}").state.enabled).toBe(true);
    localStorage.setItem("oh.subagents.v1", JSON.stringify({ state: { enabled: "yes" }, version: 1 }));
    await useSubagentStore.persist.rehydrate();
    expect(useSubagentStore.getState().enabled).toBe(false);
    localStorage.setItem("oh.subagents.v1", JSON.stringify({ state: { enabled: true }, version: 1 }));
    await useSubagentStore.persist.rehydrate();
    expect(useSubagentStore.getState().enabled).toBe(true);
  });
});

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
