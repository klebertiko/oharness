import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePermissionStore } from "@/store/permissionStore";

vi.mock("@/lib/chatToolsApi", () => ({
  chatToolsApi: { getPermission: vi.fn(), setPermission: vi.fn() },
}));
import { chatToolsApi } from "@/lib/chatToolsApi";
import { usePermissionMode } from "./usePermissionMode";

const api = vi.mocked(chatToolsApi);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  usePermissionStore.setState({ byThread: {}, draft: "ask" });
  api.getPermission.mockResolvedValue({ thread_id: "t1", mode: "ask" });
  api.setPermission.mockImplementation(async (thread_id, mode) => ({ thread_id, mode }));
});
afterEach(cleanup);

it("a conversation with no thread yet starts on ask and keeps the choice local (nothing to tell the backend)", async () => {
  const { result } = renderHook(() => usePermissionMode(null));
  expect(result.current.mode).toBe("ask");
  await act(async () => { await result.current.setMode("plan"); });
  expect(result.current.mode).toBe("plan");
  expect(api.setPermission).not.toHaveBeenCalled();
});

it("setting the mode of a thread stores it on the backend, which is what enforces it", async () => {
  const { result } = renderHook(() => usePermissionMode("t1"));
  await act(async () => { await result.current.setMode("auto_workspace"); });
  expect(api.setPermission).toHaveBeenCalledWith("t1", "auto_workspace");
  expect(result.current.mode).toBe("auto_workspace");
});

it("reverts the display when the backend refuses, so the UI never claims a laxer mode than the server holds", async () => {
  usePermissionStore.getState().setMode("t1", "plan");
  api.getPermission.mockResolvedValue({ thread_id: "t1", mode: "plan" });
  api.setPermission.mockRejectedValue(new Error("boom"));
  const { result } = renderHook(() => usePermissionMode("t1"));
  await act(async () => { await result.current.setMode("auto_workspace"); });
  expect(result.current.mode).toBe("plan");
  expect(result.current.error).toMatch(/permission mode/i);
});

it("trusts the backend over the local cache when a thread opens", async () => {
  usePermissionStore.getState().setMode("t1", "auto_workspace");
  api.getPermission.mockResolvedValue({ thread_id: "t1", mode: "ask" });
  const { result } = renderHook(() => usePermissionMode("t1"));
  await waitFor(() => expect(result.current.mode).toBe("ask"));
});

it("does not call the backend for a thread that is on the default", async () => {
  renderHook(() => usePermissionMode("t-default"));
  await act(async () => { await Promise.resolve(); });
  expect(api.getPermission).not.toHaveBeenCalled();
});

it("a late answer from the backend never overwrites a change made in the meantime", async () => {
  usePermissionStore.getState().setMode("t1", "plan");
  let release: (v: { thread_id: string; mode: "plan" }) => void = () => {};
  api.getPermission.mockReturnValue(new Promise((resolve) => { release = resolve; }));
  const { result } = renderHook(() => usePermissionMode("t1"));
  await act(async () => { await result.current.setMode("auto_workspace"); });
  await act(async () => { release({ thread_id: "t1", mode: "plan" }); await Promise.resolve(); });
  expect(result.current.mode).toBe("auto_workspace");
});

it("keeps the cached mode when the backend cannot be reached", async () => {
  usePermissionStore.getState().setMode("t1", "plan");
  api.getPermission.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => usePermissionMode("t1"));
  await waitFor(() => expect(api.getPermission).toHaveBeenCalled());
  expect(result.current.mode).toBe("plan");
});

it("cycles ask -> auto_workspace -> plan -> ask", async () => {
  const { result } = renderHook(() => usePermissionMode("t1"));
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    await act(async () => { await result.current.cycle(); });
    seen.push(result.current.mode);
  }
  expect(seen).toEqual(["auto_workspace", "plan", "ask"]);
});

it("adopting the draft gives the first message's thread the mode chosen before it existed, then resets the draft to ask", async () => {
  usePermissionStore.getState().setMode(null, "auto_workspace");
  const { result } = renderHook(() => usePermissionMode(null));
  let adopted = "";
  await act(async () => { adopted = await result.current.adopt("t9"); });
  expect(adopted).toBe("auto_workspace");
  expect(api.setPermission).toHaveBeenCalledWith("t9", "auto_workspace");
  expect(usePermissionStore.getState().modeFor("t9")).toBe("auto_workspace");
  expect(usePermissionStore.getState().modeFor(null)).toBe("ask");
});

it("adopting falls back to ask when the backend cannot store the chosen mode", async () => {
  usePermissionStore.getState().setMode(null, "auto_workspace");
  api.setPermission.mockRejectedValue(new Error("boom"));
  const { result } = renderHook(() => usePermissionMode(null));
  let adopted = "";
  await act(async () => { adopted = await result.current.adopt("t9"); });
  expect(adopted).toBe("ask");
  expect(usePermissionStore.getState().modeFor("t9")).toBe("ask");
});

it("says why when the sidecar refuses to leave Plan mode while a plan waits, and keeps Plan", async () => {
  usePermissionStore.getState().setMode("t1", "plan");
  api.getPermission.mockResolvedValue({ thread_id: "t1", mode: "plan" });
  api.setPermission.mockRejectedValue(Object.assign(new Error("plan_not_approved (409)"), { status: 409, code: "plan_not_approved" }));
  const { result } = renderHook(() => usePermissionMode("t1"));
  await act(async () => { await result.current.setMode("ask"); });
  expect(result.current.mode).toBe("plan");
  expect(result.current.error).toMatch(/plan is waiting for approval/i);
});
