import { beforeEach, describe, expect, it } from "vitest";
import { MAX_QUEUED, MAX_QUEUED_CHARS, QUEUE_STORAGE_KEY, queueRefusal, restoreQueue, useMessageQueueStore } from "./messageQueueStore";

const q = () => useMessageQueueStore.getState();
beforeEach(() => { localStorage.clear(); useMessageQueueStore.setState({ byThread: {}, pausedThreads: {} }); });

describe("messageQueueStore", () => {
  it("queues in order, per conversation", () => {
    q().enqueue("a", "first");
    q().enqueue("a", "second");
    q().enqueue("b", "other chat");
    expect(q().byThread.a.map((m) => m.text)).toEqual(["first", "second"]);
    expect(q().byThread.b.map((m) => m.text)).toEqual(["other chat"]);
  });

  it("takes the next message from the front and nothing else", () => {
    q().enqueue("a", "first");
    q().enqueue("a", "second");
    expect(q().takeNext("a")?.text).toBe("first");
    expect(q().byThread.a.map((m) => m.text)).toEqual(["second"]);
    expect(q().takeNext("a")?.text).toBe("second");
    expect(q().takeNext("a")).toBeNull();
    expect(q().byThread.a).toBeUndefined();
  });

  it("trims, and ignores blank text", () => {
    expect(q().enqueue("a", "   ")).toBe(false);
    expect(q().enqueue("a", "  hi  ")).toBe(true);
    expect(q().byThread.a[0].text).toBe("hi");
  });

  it("removes one message by id, and clears a conversation", () => {
    q().enqueue("a", "one");
    q().enqueue("a", "two");
    const id = q().byThread.a[0].id;
    q().remove("a", id);
    expect(q().byThread.a.map((m) => m.text)).toEqual(["two"]);
    q().clear("a");
    expect(q().byThread.a).toBeUndefined();
  });

  it(`refuses the ${MAX_QUEUED + 1}th message instead of growing without bound`, () => {
    for (let i = 0; i < MAX_QUEUED; i++) expect(q().enqueue("a", `m${i}`)).toBe(true);
    expect(q().enqueue("a", "one too many")).toBe(false);
    expect(q().byThread.a).toHaveLength(MAX_QUEUED);
  });

  it("gives every message its own id", () => {
    q().enqueue("a", "same");
    q().enqueue("a", "same");
    expect(new Set(q().byThread.a.map((m) => m.id)).size).toBe(2);
  });

  it("names why a message is refused, so the screen can say it", () => {
    expect(queueRefusal("a", "  ")).toBe("empty");
    expect(queueRefusal("a", "x".repeat(MAX_QUEUED_CHARS + 1))).toBe("long");
    expect(queueRefusal("a", "x".repeat(MAX_QUEUED_CHARS))).toBeNull();
    for (let i = 0; i < MAX_QUEUED; i++) q().enqueue("a", `m${i}`);
    expect(queueRefusal("a", "one more")).toBe("full");
    expect(q().enqueue("a", "x".repeat(MAX_QUEUED_CHARS + 1))).toBe(false);
  });

  describe("persistence", () => {
    const stored = () => JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) ?? "null");

    it("writes the queue under oh.messageQueue.v1 and forgets it when emptied", () => {
      q().enqueue("a", "first");
      expect(stored().state.byThread.a.map((m: { text: string }) => m.text)).toEqual(["first"]);
      q().clear("a");
      expect(stored().state.byThread).toEqual({});
    });

    it("restores what was queued and leaves it PAUSED: nothing runs on its own after a reload", () => {
      const byThread = restoreQueue({ a: [{ id: "q1", text: "left over" }] });
      expect(byThread.a).toEqual([{ id: "q1", text: "left over" }]);
      useMessageQueueStore.setState({ byThread, pausedThreads: { a: true } });
      expect(q().takeNext("a")?.text).toBe("left over");
      expect(q().pausedThreads.a).toBeUndefined();
    });

    it("validates on read: bad shapes, blanks, over-long text and extra items are dropped, never trusted", () => {
      const byThread = restoreQueue({
        ok: [{ id: "q1", text: " keep " }, { id: 5, text: "bad id" }, { id: "q2", text: "   " }, { id: "q3", text: "x".repeat(MAX_QUEUED_CHARS + 1) }, null, "str"],
        junk: "not a list",
        many: Array.from({ length: MAX_QUEUED + 5 }, (_, i) => ({ id: `m${i}`, text: `t${i}` })),
        empty: [],
      });
      expect(byThread.ok).toEqual([{ id: "q1", text: "keep" }]);
      expect(byThread.junk).toBeUndefined();
      expect(byThread.empty).toBeUndefined();
      expect(byThread.many).toHaveLength(MAX_QUEUED);
      expect(restoreQueue("garbage")).toEqual({});
      expect(restoreQueue(null)).toEqual({});
    });

    it("rehydrates from storage as paused, and a new message never reuses a restored id", async () => {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ state: { byThread: { a: [{ id: "q1", text: "kept" }] } }, version: 1 }));
      await useMessageQueueStore.persist.rehydrate();
      expect(q().byThread.a.map((m) => m.text)).toEqual(["kept"]);
      expect(q().pausedThreads.a).toBe(true);
      q().enqueue("a", "new");
      expect(new Set(q().byThread.a.map((m) => m.id)).size).toBe(2);
    });

    it("survives unreadable storage", async () => {
      localStorage.setItem(QUEUE_STORAGE_KEY, "{not json");
      await expect(useMessageQueueStore.persist.rehydrate()).resolves.not.toThrow();
      expect(q().byThread).toEqual({});
    });
  });
});
