import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { axeViolations } from "@/test/axe";
import { CapabilityEffects } from "./CapabilityEffects";
import { capabilityEffects } from "./present";

describe("capabilityEffects", () => {
  it("always has the four rows, in order", () => {
    for (const runtime of ["isolated", "in-process"]) {
      expect(capabilityEffects(runtime, []).map((e) => e.cap)).toEqual(["files", "network", "processes", "credentials"]);
      expect(capabilityEffects(runtime, ["files", "network", "processes", "credentials"]).map((e) => e.cap)).toEqual(["files", "network", "processes", "credentials"]);
    }
  });

  it("isolated: an undeclared capability is blocked and says what the process cannot reach", () => {
    const rows = capabilityEffects("isolated", []);
    expect(rows.find((r) => r.cap === "files")).toMatchObject({ status: "blocked", textKey: "plugins.effect.files.blocked", declared: false });
    expect(rows.find((r) => r.cap === "processes")).toMatchObject({ status: "blocked", textKey: "plugins.effect.processes.blocked" });
    expect(rows.find((r) => r.cap === "credentials")).toMatchObject({ status: "blocked", textKey: "plugins.effect.credentials.blocked" });
  });

  it("isolated: a declared and confirmed capability is accepted and says what it grants; before the confirmation it is only asked for", () => {
    const rows = capabilityEffects("isolated", ["files", "credentials"]);
    expect(rows.find((r) => r.cap === "files")).toMatchObject({ status: "accepted", textKey: "plugins.capability.files.grant", declared: true });
    expect(rows.find((r) => r.cap === "credentials")).toMatchObject({ status: "accepted", textKey: "plugins.capability.credentials.grant" });
    expect(rows.find((r) => r.cap === "processes")?.status).toBe("blocked");
    expect(capabilityEffects("isolated", ["files"], { confirmed: false }).find((r) => r.cap === "files")?.status).toBe("asked");
  });

  it("the network is only declared, declared or not: it is never limited", () => {
    for (const declared of [[], ["network"]]) {
      expect(capabilityEffects("isolated", declared).find((r) => r.cap === "network")).toMatchObject({ status: "declaredOnly", textKey: "plugins.effect.network.open" });
    }
  });

  it("in-process has no boundary: every row says no limits", () => {
    for (const row of capabilityEffects("in-process", ["files"])) expect(row).toMatchObject({ status: "unlimited", textKey: "plugins.effect.unlimited.text" });
  });
});

describe("CapabilityEffects", () => {
  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "en" });
  });

  it("renders four rows with a word for each state, not colour alone", async () => {
    const { container } = render(<CapabilityEffects runtime="isolated" capabilities={["files"]} />);
    const list = screen.getByRole("list", { name: "What each capability does" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("Accepted")).toBeTruthy();
    expect(within(rows[0]).getByText(/Reads and writes any file you can reach/)).toBeTruthy();
    expect(within(rows[1]).getByText("Declared only")).toBeTruthy();
    expect(within(rows[1]).getByText(/the network is not limited/)).toBeTruthy();
    expect(within(rows[2]).getByText("Blocked")).toBeTruthy();
    expect(within(rows[2]).getByText("The process cannot start programs.")).toBeTruthy();
    expect(within(rows[3]).getByText("The process cannot read the environment.")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("in-process shows No limits on every row, in Portuguese too", () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    render(<CapabilityEffects runtime="in-process" capabilities={[]} />);
    expect(screen.getAllByText("Sem limites")).toHaveLength(4);
    expect(screen.getAllByText("Dentro do host não há fronteira: sem limites.")).toHaveLength(4);
  });
});
