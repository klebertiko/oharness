import { beforeEach, describe, expect, it } from "vitest";
import { MAX_QUEUED, useMessageQueueStore } from "./messageQueueStore";

const q = () => useMessageQueueStore.getState();
beforeEach(() => useMessageQueueStore.setState({ byThread: {} }));

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
});
