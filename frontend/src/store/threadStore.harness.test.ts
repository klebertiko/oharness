import { beforeEach, describe, expect, it } from "vitest";
import { NO_HARNESS } from "@/lib/chatHarness";
import { useThreadStore } from "./threadStore";

const agile = { kind: "harness", id: "oharness.default.agile", name: "Agile Harness" } as const;
const s = () => useThreadStore.getState();

beforeEach(async () => {
  localStorage.clear();
  useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  await useThreadStore.persist.clearStorage();
});

describe("a chat's harness", () => {
  it("is born with the harness chosen when the first message is sent", () => {
    const id = s().createThread("Plan", agile);
    expect(s().threads[0].harness).toEqual(agile);
    expect(s().threads.find((t) => t.id === id)?.harness).toEqual(agile);
  });

  it("changes silently before any message exists", () => {
    const id = s().createThread("Plan", NO_HARNESS);
    s().setThreadHarness(id, agile);
    expect(s().threads[0].harness).toEqual(agile);
    expect(s().messagesFor(id)).toEqual([]);
  });

  it("changing after messages records a marker the transcript can show, and earlier replies keep their harness", () => {
    const id = s().createThread("Plan", NO_HARNESS);
    s().appendMessage(id, { role: "user", content: "hi" });
    s().appendMessage(id, { role: "assistant", content: "hello", harness: NO_HARNESS });
    s().setThreadHarness(id, agile);
    const messages = s().messagesFor(id);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "system"]);
    expect(messages[1].harness).toEqual(NO_HARNESS);
    expect(messages[2]).toMatchObject({ content: expect.stringContaining("Harness changed to Agile Harness"), harness: agile });
    expect(s().threads[0].harness).toEqual(agile);
  });

  it("choosing the same harness again adds nothing", () => {
    const id = s().createThread("Plan", agile);
    s().appendMessage(id, { role: "user", content: "hi" });
    s().setThreadHarness(id, { ...agile, name: "Agile Harness" });
    expect(s().messagesFor(id)).toHaveLength(1);
  });

  it("keeps threads from before this field readable (no binding)", () => {
    const id = s().createThread("Old");
    expect(s().threads.find((t) => t.id === id)?.harness).toBeUndefined();
  });
});

describe("a chat from before the field existed", () => {
  it("is bound silently when the person re-picks what it was already running", () => {
    const id = s().createThread("Old");
    s().appendMessage(id, { role: "user", content: "hi" });
    s().setThreadHarness(id, agile, agile);
    expect(s().threads[0].harness).toEqual(agile);
    expect(s().messagesFor(id)).toHaveLength(1);
  });
});

describe("harness change markers", () => {
  it("flipping back and forth before the next message leaves one marker, not a stack", () => {
    const id = s().createThread("Plan", NO_HARNESS);
    s().appendMessage(id, { role: "user", content: "hi" });
    s().setThreadHarness(id, agile);
    s().setThreadHarness(id, { kind: "harness", id: "other", name: "Other Harness" });
    expect(s().messagesFor(id).filter((m) => m.role === "system")).toHaveLength(1);
    expect(s().messagesFor(id).at(-1)?.content).toContain("Other Harness");
    expect(s().threads[0].harness).toMatchObject({ id: "other" });
  });

  it("a marker is dropped when the chat ends up back where it started", () => {
    const id = s().createThread("Plan", NO_HARNESS);
    s().appendMessage(id, { role: "user", content: "hi" });
    s().appendMessage(id, { role: "assistant", content: "hello", harness: NO_HARNESS });
    s().setThreadHarness(id, agile);
    s().setThreadHarness(id, NO_HARNESS);
    expect(s().messagesFor(id).map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("bindThreadHarness", () => {
  it("gives a chat from before the setting its harness without a marker, and never overrides one", () => {
    const id = s().createThread("Old");
    s().appendMessage(id, { role: "user", content: "hi" });
    s().bindThreadHarness(id, agile);
    expect(s().threads[0].harness).toEqual(agile);
    s().bindThreadHarness(id, NO_HARNESS);
    expect(s().threads[0].harness).toEqual(agile);
    expect(s().messagesFor(id)).toHaveLength(1);
  });
});
