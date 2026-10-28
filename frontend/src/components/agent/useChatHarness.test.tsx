import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { NO_HARNESS } from "@/lib/chatHarness";
import { useHarnessLibraryStore } from "@/store/harnessLibraryStore";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useThreadStore } from "@/store/threadStore";
import { useChatHarness } from "./useChatHarness";

const useSynced = () => useChatHarness(true);

const agile = { manifest: { id: "agile", name: "Agile Harness" } };
const demo = { manifest: { id: "demo", name: "Demo" } };
const entries = [
  { id: "agile", name: "Agile Harness", isDefault: true, bundle: agile, addedAt: 0 },
  { id: "demo", name: "Demo", isDefault: false, bundle: demo, addedAt: 1 },
];

beforeEach(() => {
  localStorage.clear();
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  useHarnessLibraryStore.setState({ entries: entries as never, hydrated: true, failed: false } as never);
  useHarnessSessionStore.setState({ hydrated: true, enabled: true, activeBundle: agile as never });
});
afterEach(cleanup);

describe("useChatHarness", () => {
  it("a chat with no thread yet follows the session choice", () => {
    const { result } = renderHook(() => useSynced());
    expect(result.current.binding).toEqual({ kind: "harness", id: "agile", name: "Agile Harness" });
    expect(result.current.status.state).toBe("ready");
  });

  it("choosing without a thread sets what the next chat starts with", () => {
    const { result } = renderHook(() => useSynced());
    act(() => result.current.choose({ kind: "harness", id: "demo", name: "Demo" }));
    expect(useHarnessSessionStore.getState()).toMatchObject({ enabled: true });
    expect(useHarnessSessionStore.getState().activeBundle?.manifest.id).toBe("demo");
    act(() => result.current.choose(NO_HARNESS));
    expect(useHarnessSessionStore.getState().enabled).toBe(false);
  });

  it("choosing in an existing chat binds that chat and marks the change once messages exist", () => {
    const id = useThreadStore.getState().createThread("Plan", { kind: "harness", id: "agile", name: "Agile Harness" });
    useThreadStore.getState().appendMessage(id, { role: "user", content: "hi" });
    const { result } = renderHook(() => useSynced());
    act(() => result.current.choose({ kind: "harness", id: "demo", name: "Demo" }));
    expect(useThreadStore.getState().threads[0].harness).toEqual({ kind: "harness", id: "demo", name: "Demo" });
    expect(useThreadStore.getState().messagesFor(id).at(-1)?.role).toBe("system");
  });

  it("switching chats brings that chat's harness back, without touching other chats", () => {
    const a = useThreadStore.getState().createThread("A", NO_HARNESS);
    const b = useThreadStore.getState().createThread("B", { kind: "harness", id: "demo", name: "Demo" });
    const { result, rerender } = renderHook(() => useSynced());
    expect(result.current.binding.kind).toBe("harness");
    expect(useHarnessSessionStore.getState().activeBundle?.manifest.id).toBe("demo");
    act(() => useThreadStore.getState().selectThread(a));
    rerender();
    expect(result.current.binding).toEqual(NO_HARNESS);
    expect(useHarnessSessionStore.getState().enabled).toBe(false);
    expect(useThreadStore.getState().threads.find((t) => t.id === b)?.harness).toMatchObject({ id: "demo" });
  });

  it("a pick made elsewhere (palette, Studio) while a chat is open becomes that chat's harness", () => {
    const id = useThreadStore.getState().createThread("Plan", { kind: "harness", id: "agile", name: "Agile Harness" });
    useThreadStore.getState().appendMessage(id, { role: "user", content: "hi" });
    const { result } = renderHook(() => useSynced());
    act(() => useHarnessSessionStore.getState().setEnabled(false));
    expect(result.current.binding).toEqual(NO_HARNESS);
    expect(useThreadStore.getState().threads[0].harness).toEqual(NO_HARNESS);
    expect(useThreadStore.getState().messagesFor(id).at(-1)?.role).toBe("system");
  });

  it("only the synced instance writes: reading it elsewhere has no side effects", () => {
    useThreadStore.getState().createThread("B", { kind: "harness", id: "demo", name: "Demo" });
    renderHook(() => useChatHarness());
    expect(useHarnessSessionStore.getState().activeBundle?.manifest.id).toBe("agile");
  });

  it("choosing an unknown harness changes nothing", () => {
    const id = useThreadStore.getState().createThread("Plan", { kind: "harness", id: "agile", name: "Agile Harness" });
    const { result } = renderHook(() => useSynced());
    act(() => result.current.choose({ kind: "harness", id: "ghost", name: "Ghost" }));
    expect(useThreadStore.getState().threads.find((t) => t.id === id)?.harness).toMatchObject({ id: "agile" });
    expect(useHarnessSessionStore.getState().activeBundle?.manifest.id).toBe("agile");
  });

  it("stops waiting when the library cannot load", () => {
    useHarnessLibraryStore.setState({ entries: [], hydrated: false, failed: true } as never);
    useThreadStore.getState().createThread("Old", { kind: "harness", id: "demo", name: "Demo" });
    const { result } = renderHook(() => useSynced());
    expect(result.current.status.state).toBe("missing");
  });

  it("a deleted harness is reported as missing and never silently replaced", () => {
    useThreadStore.getState().createThread("Old", { kind: "harness", id: "gone", name: "Retired Harness" });
    const { result } = renderHook(() => useSynced());
    expect(result.current.status).toEqual({ state: "missing", id: "gone", name: "Retired Harness" });
    expect(useThreadStore.getState().threads[0].harness).toMatchObject({ id: "gone" });
    expect(result.current.canSend).toBe(false);
  });

  it("waits for the library before judging", () => {
    useHarnessLibraryStore.setState({ entries: [], hydrated: false, failed: false } as never);
    useThreadStore.getState().createThread("Old", { kind: "harness", id: "demo", name: "Demo" });
    const { result } = renderHook(() => useSynced());
    expect(result.current.status.state).toBe("loading");
    expect(result.current.canSend).toBe(false);
  });
});

describe("harness and provider stay separate", () => {
  it("choosing a harness never touches the chat's provider choice", async () => {
    const { useChatProviderStore } = await import("@/store/chatProviderStore");
    useChatProviderStore.setState({ chosenId: "pinned-by-me" });
    const { result } = renderHook(() => useSynced());
    act(() => result.current.choose({ kind: "harness", id: "demo", name: "Demo" }));
    act(() => result.current.choose({ kind: "none" }));
    expect(useChatProviderStore.getState().chosenId).toBe("pinned-by-me");
  });
});
