import { beforeEach, describe, expect, it, vi } from "vitest";

import { flowApi } from "./flowApi";

const BASE = "http://127.0.0.1:8000";

describe("flowApi", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("get() fetches GET /flow/config", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ enabled: false }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await flowApi.get()).toEqual({ enabled: false });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/flow/config`, expect.objectContaining({ headers: { "Content-Type": "application/json" } }));
  });

  it("set() sends PUT /flow/config with a boolean", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ enabled: true }) });
    vi.stubGlobal("fetch", fetchMock);

    expect(await flowApi.set(true)).toEqual({ enabled: true });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/flow/config`, expect.objectContaining({ method: "PUT", body: JSON.stringify({ enabled: true }) }));
  });

  it("rejects with the sidecar's message on an error status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "bad" }));
    await expect(flowApi.set(true)).rejects.toThrow("bad");
  });
});
