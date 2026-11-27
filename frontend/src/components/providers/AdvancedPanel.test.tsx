import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdvancedPanel } from "./AdvancedPanel";
import type { Connection } from "./providerStore";

const conn: Connection = {
  id: "xai-work", provider: "xai", label: "Work", residence: "cloud", endpoint: "",
  secret: null, health: "setup", detail: "", probes: [], facts: [], models: [], defaultModel: "", enabled: false, lastProbe: "",
};

const SAVED = {
  retryPolicy: "all",
  retryCap: 5,
  allowlist: ["grok-a", "grok-b"],
  models: { "grok-a": { displayName: "Everyday", context: 128000, maxOutput: 8192 } },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("advanced panel", () => {
  it("opens with what was saved and keeps the per-model options on save", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => (init?.method === "PUT" ? JSON.parse(String(init.body)) : SAVED),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AdvancedPanel c={conn} />);
    await waitFor(() => expect((screen.getByLabelText("Retry cap") as HTMLInputElement).value).toBe("5"));
    expect((screen.getByLabelText("Models to allow, separated by commas") as HTMLInputElement).value).toBe("grok-a, grok-b");
    fireEvent.click(screen.getByRole("button", { name: "Save advanced" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT");
    const body = JSON.parse(String(put?.[1]?.body));
    expect(body.retryPolicy).toBe("all");
    expect(body.models).toEqual(SAVED.models);
  });
});
