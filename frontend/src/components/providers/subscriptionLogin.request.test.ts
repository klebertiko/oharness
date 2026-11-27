import { afterEach, describe, expect, it, vi } from "vitest";
import { requestLogin } from "./subscriptionLogin";

const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestLogin (POST /providers/clis/{id}/login)", () => {
  it("returns the session id when the sign-in started", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200, { ok: true, id: "abc", cli: "claude", running: true })));
    await expect(requestLogin("claude")).resolves.toEqual({ ok: true, id: "abc" });
  });

  it("keeps the closed reason when the sidecar refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(409, { ok: false, reason: "not-installed" })));
    await expect(requestLogin("codex")).resolves.toEqual({ ok: false, reason: "not-installed" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(409, { ok: false, reason: "not-started" })));
    await expect(requestLogin("codex")).resolves.toEqual({ ok: false, reason: "not-started" });
  });

  it("treats an unreachable sidecar, an odd reply or an unknown reason as not started", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(requestLogin("claude")).resolves.toEqual({ ok: false, reason: "not-started" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(409, { ok: false, reason: "rm -rf /" })));
    await expect(requestLogin("claude")).resolves.toEqual({ ok: false, reason: "not-started" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error("x"); } }));
    await expect(requestLogin("claude")).resolves.toEqual({ ok: false, reason: "not-started" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(answer(200, { ok: true })));
    await expect(requestLogin("claude")).resolves.toEqual({ ok: false, reason: "not-started" });
  });
});
