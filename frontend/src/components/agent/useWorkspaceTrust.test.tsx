import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/chatToolsApi", () => ({
  chatToolsApi: { getTrust: vi.fn(), setTrust: vi.fn() },
}));
import { chatToolsApi } from "@/lib/chatToolsApi";
import { useWorkspaceTrust } from "./useWorkspaceTrust";

const api = vi.mocked(chatToolsApi);
const ROOT = "D:\w";

beforeEach(() => {
  vi.clearAllMocks();
  api.getTrust.mockResolvedValue({ cwd: ROOT, trusted: false });
  api.setTrust.mockImplementation(async (cwd, trusted) => ({ cwd, trusted }));
});
afterEach(cleanup);

it("is untrusted until the sidecar says otherwise, and asks nothing while Auto is not selected", async () => {
  const { result } = renderHook(() => useWorkspaceTrust(ROOT, false));
  expect(result.current.trusted).toBe(false);
  await act(async () => { await Promise.resolve(); });
  expect(api.getTrust).not.toHaveBeenCalled();
});

it("reads the stored trust of the workspace when Auto is selected", async () => {
  api.getTrust.mockResolvedValue({ cwd: ROOT, trusted: true });
  const { result } = renderHook(() => useWorkspaceTrust(ROOT, true));
  await waitFor(() => expect(result.current.trusted).toBe(true));
  expect(api.getTrust).toHaveBeenCalledWith(ROOT);
});

it("has no workspace, so nothing to trust and no request", async () => {
  const { result } = renderHook(() => useWorkspaceTrust(null, true));
  await act(async () => { await Promise.resolve(); });
  expect(result.current.trusted).toBe(false);
  expect(api.getTrust).not.toHaveBeenCalled();
});

it("trusting is an explicit call the sidecar must accept before the screen says trusted", async () => {
  const { result } = renderHook(() => useWorkspaceTrust(ROOT, true));
  await act(async () => { await result.current.setTrusted(true); });
  expect(api.setTrust).toHaveBeenCalledWith(ROOT, true);
  expect(result.current.trusted).toBe(true);
  await act(async () => { await result.current.setTrusted(false); });
  expect(result.current.trusted).toBe(false);
});

it("stays untrusted and says so when the sidecar refuses", async () => {
  api.setTrust.mockRejectedValue(new Error("boom"));
  const { result } = renderHook(() => useWorkspaceTrust(ROOT, true));
  await act(async () => { await result.current.setTrusted(true); });
  expect(result.current.trusted).toBe(false);
  expect(result.current.error).toMatch(/workspace trust/i);
});

it("an unreachable sidecar never reads as trusted", async () => {
  api.getTrust.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => useWorkspaceTrust(ROOT, true));
  await waitFor(() => expect(api.getTrust).toHaveBeenCalled());
  expect(result.current.trusted).toBe(false);
});

it("forgets the previous workspace's trust when the workspace changes", async () => {
  api.getTrust.mockImplementation(async (cwd) => ({ cwd, trusted: cwd === ROOT }));
  const { result, rerender } = renderHook(({ root }) => useWorkspaceTrust(root, true), { initialProps: { root: ROOT as string | null } });
  await waitFor(() => expect(result.current.trusted).toBe(true));
  rerender({ root: "D:\other" });
  expect(result.current.trusted).toBe(false);
  await waitFor(() => expect(api.getTrust).toHaveBeenCalledWith("D:\other"));
  expect(result.current.trusted).toBe(false);
});
