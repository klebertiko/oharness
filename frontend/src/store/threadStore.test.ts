import { beforeEach, describe, expect, it } from "vitest";

import { useMessageQueueStore } from "./messageQueueStore";
import { DEFAULT_THREAD_TITLE, THREADS_STORAGE_KEY, useThreadStore } from "./threadStore";

describe("threadStore", () => {
  beforeEach(async () => {
    localStorage.clear();
    useThreadStore.setState({
      threads: [],
      activeThreadId: null,
      messagesByThread: {},
    });
    await useThreadStore.persist.clearStorage();
  });

  it("create → select → rename updates threads and activeThreadId", () => {
    const firstId = useThreadStore.getState().createThread("Planning");
    expect(useThreadStore.getState().activeThreadId).toBe(firstId);

    const secondId = useThreadStore.getState().createThread("Debug session");
    expect(useThreadStore.getState().activeThreadId).toBe(secondId);
    expect(useThreadStore.getState().threads.map((t) => t.title)).toEqual([
      "Debug session",
      "Planning",
    ]);

    useThreadStore.getState().selectThread(firstId);
    expect(useThreadStore.getState().activeThreadId).toBe(firstId);

    useThreadStore.getState().renameThread(firstId, "Planning v2");
    const renamed = useThreadStore.getState().threads.find((t) => t.id === firstId);
    expect(renamed?.title).toBe("Planning v2");
    expect(renamed?.updatedAt).toBeGreaterThanOrEqual(renamed!.createdAt);
  });

  it("archive hides a chat from the open list and moves active selection off it", () => {
    const a = useThreadStore.getState().createThread("Keep");
    const b = useThreadStore.getState().createThread("Toss");
    expect(useThreadStore.getState().activeThreadId).toBe(b);

    useThreadStore.getState().archiveThread(b);
    const bAfter = useThreadStore.getState().threads.find((t) => t.id === b);
    expect(bAfter?.archived).toBe(true);
    expect(useThreadStore.getState().activeThreadId).toBe(a);
  });

  it("restore brings an archived chat back", () => {
    const id = useThreadStore.getState().createThread("Later");
    useThreadStore.getState().archiveThread(id);
    useThreadStore.getState().restoreThread(id);
    expect(useThreadStore.getState().threads.find((t) => t.id === id)?.archived).toBe(false);
  });

  it("delete removes the chat, its messages, and reassigns active", () => {
    const a = useThreadStore.getState().createThread("A");
    const b = useThreadStore.getState().createThread("B");
    useThreadStore.getState().appendMessage(b, { role: "user", content: "hi" });

    useThreadStore.getState().deleteThread(b);
    expect(useThreadStore.getState().threads.map((t) => t.id)).toEqual([a]);
    expect(useThreadStore.getState().messagesFor(b)).toEqual([]);
    expect(useThreadStore.getState().activeThreadId).toBe(a);
  });

  it("deleting a chat also drops its queued messages", () => {
    const a = useThreadStore.getState().createThread("A");
    const b = useThreadStore.getState().createThread("B");
    useMessageQueueStore.getState().enqueue(a, "keep");
    useMessageQueueStore.getState().enqueue(b, "gone");
    useThreadStore.getState().deleteThread(b);
    expect(useMessageQueueStore.getState().byThread[b]).toBeUndefined();
    expect(useMessageQueueStore.getState().byThread[a]).toHaveLength(1);
  });

  it("ensureActiveThread skips archived chats", () => {
    const a = useThreadStore.getState().createThread("A");
    useThreadStore.getState().archiveThread(a);
    const id = useThreadStore.getState().ensureActiveThread();
    expect(id).not.toBe(a);
    expect(useThreadStore.getState().threads.find((t) => t.id === id)?.archived).toBe(false);
  });

  it("createThread without title uses a default label", () => {
    const id = useThreadStore.getState().createThread();
    const thread = useThreadStore.getState().threads.find((t) => t.id === id);
    expect(thread?.title).toBe(DEFAULT_THREAD_TITLE);
  });

  it("ensureActiveThread creates one when empty and reuses when present", () => {
    const id = useThreadStore.getState().ensureActiveThread();
    expect(id).toBeTruthy();
    expect(useThreadStore.getState().threads).toHaveLength(1);
    expect(useThreadStore.getState().ensureActiveThread()).toBe(id);
  });

  it("appendMessage stores per thread and renames New chat from first user line", () => {
    const id = useThreadStore.getState().createThread();
    useThreadStore.getState().appendMessage(id, {
      role: "user",
      content: "Explain the default agile harness",
    });
    useThreadStore.getState().appendMessage(id, {
      role: "assistant",
      content: "It runs PO → SM → …",
    });
    const msgs = useThreadStore.getState().messagesFor(id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(useThreadStore.getState().threads.find((t) => t.id === id)?.title).toBe(
      "Explain the default agile harness"
    );
  });

  it("persists threads, messages, and activeThreadId", async () => {
    const id = useThreadStore.getState().createThread("Persist me");
    useThreadStore.getState().appendMessage(id, { role: "user", content: "hi" });

    const raw = localStorage.getItem(THREADS_STORAGE_KEY);
    expect(raw).not.toBeNull();

    useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
    localStorage.setItem(THREADS_STORAGE_KEY, raw!);
    await useThreadStore.persist.rehydrate();

    const { threads, activeThreadId, messagesFor } = useThreadStore.getState();
    expect(activeThreadId).toBe(id);
    expect(threads).toHaveLength(1);
    expect(messagesFor(id)).toHaveLength(1);
    expect(messagesFor(id)[0].content).toBe("hi");
  });
});
