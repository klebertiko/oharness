import { beforeEach, describe, expect, it } from "vitest";
import { modelOverride, useChatModelStore } from "./chatModelStore";

beforeEach(() => useChatModelStore.setState({ overrides: {} }));

describe("chatModelStore - the model for this conversation only", () => {
  it("keeps one model per thread and connection, independent of other threads", () => {
    const { setOverride } = useChatModelStore.getState();
    setOverride("t1", "ollama-local", "qwen3:8b");
    setOverride("t1", "openrouter", "x/y");
    setOverride("t2", "ollama-local", "gemma4:26b");
    const { overrides } = useChatModelStore.getState();
    expect(modelOverride(overrides, "t1", "ollama-local")).toBe("qwen3:8b");
    expect(modelOverride(overrides, "t1", "openrouter")).toBe("x/y");
    expect(modelOverride(overrides, "t2", "ollama-local")).toBe("gemma4:26b");
  });

  it("an empty id clears the override and drops the thread when nothing is left", () => {
    const { setOverride } = useChatModelStore.getState();
    setOverride("t1", "ollama-local", "qwen3:8b");
    setOverride("t1", "ollama-local", "");
    expect(useChatModelStore.getState().overrides).toEqual({});
  });

  it("no thread or no entry means follow the connection default", () => {
    expect(modelOverride({}, null, "c")).toBe("");
    expect(modelOverride({ t: { c: "m" } }, "t", "other")).toBe("");
  });

  it("clearThread and prune forget threads that are gone", () => {
    const { setOverride, clearThread, prune } = useChatModelStore.getState();
    setOverride("t1", "c", "a");
    setOverride("t2", "c", "b");
    setOverride("t3", "c", "d");
    clearThread("t1");
    prune(["t2"]);
    expect(Object.keys(useChatModelStore.getState().overrides)).toEqual(["t2"]);
  });
});

describe("adopt - the model chosen before the first message", () => {
  it("moves the new-chat choice onto the thread the first message creates", () => {
    const { setOverride, adopt } = useChatModelStore.getState();
    setOverride("new", "ollama-local", "qwen3:8b");
    adopt("new", "t9");
    const { overrides } = useChatModelStore.getState();
    expect(overrides).toEqual({ t9: { "ollama-local": "qwen3:8b" } });
  });

  it("does nothing when there was no choice", () => {
    useChatModelStore.getState().adopt("new", "t9");
    expect(useChatModelStore.getState().overrides).toEqual({});
  });
});
