import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axeViolations } from "@/test/axe";
import { FlowToggle } from "./FlowToggle";

function sidecar(initial: boolean, putFails = false) {
  let enabled = initial;
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      if (putFails) return { ok: false, status: 500, text: async () => "nope" };
      enabled = JSON.parse(String(init.body)).enabled;
    }
    return { ok: true, status: 200, json: async () => ({ enabled }) };
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("FlowToggle", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts off and disabled until the sidecar answers, then shows the stored choice", async () => {
    sidecar(false);
    render(<FlowToggle />);
    const sw = screen.getByRole("switch") as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    await waitFor(() => expect(sw.disabled).toBe(false));
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("turns Flow on and off through PUT /flow/config", async () => {
    const fn = sidecar(false);
    render(<FlowToggle />);
    const sw = screen.getByRole("switch") as HTMLButtonElement;
    await waitFor(() => expect(sw.disabled).toBe(false));

    await userEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("true"));
    await userEvent.click(sw);
    await waitFor(() => expect(sw.getAttribute("aria-checked")).toBe("false"));
    const puts = fn.mock.calls.filter(([, init]) => init?.method === "PUT").map(([, init]) => JSON.parse(String(init?.body)));
    expect(puts).toEqual([{ enabled: true }, { enabled: false }]);
  });

  it("keeps the old state and says so when the sidecar refuses", async () => {
    sidecar(false, true);
    render(<FlowToggle />);
    const sw = screen.getByRole("switch") as HTMLButtonElement;
    await waitFor(() => expect(sw.disabled).toBe(false));
    await userEvent.click(sw);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(sw.getAttribute("aria-checked")).toBe("false");
  });

  it("has no accessibility violations", async () => {
    sidecar(true);
    const { container } = render(<FlowToggle />);
    await waitFor(() => expect((screen.getByRole("switch") as HTMLButtonElement).disabled).toBe(false));
    expect(await axeViolations(container)).toEqual([]);
  });
});
