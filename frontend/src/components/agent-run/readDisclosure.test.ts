import { beforeEach, describe, expect, it } from "vitest";
import { readDisclosure, useReadDisclosureStore } from "./readDisclosure";
import type { ToolCall } from "./types";

// CHAT-TOOLS-FE — features/chat-tools-menu.feature "First read on a remote
// provider discloses where content goes". Threat-model: a read result leaves
// the machine as soon as it is fed back to a cloud model; the user must be
// told where, once, in words — not left to infer it from the provider chip.

const read: ToolCall = { callId: "c1", name: "read", args: '{"path":"README.md"}', path: "README.md", ok: true, result: "# Hi" };

beforeEach(() => useReadDisclosureStore.getState().reset());

describe("readDisclosure", () => {
  it("names the remote provider a finished read is sent to", () => {
    expect(readDisclosure({ provider: "openrouter", residence: "cloud" }, read)).toBe("files it reads are sent to openrouter");
  });

  it("says nothing for a local provider — the content never leaves the machine", () => {
    expect(readDisclosure({ provider: "ollama", residence: "local" }, read)).toBeNull();
  });

  it("says nothing before the read has a result, and never for a non-read tool", () => {
    expect(readDisclosure({ provider: "openrouter", residence: "cloud" }, { ...read, ok: undefined, result: undefined })).toBeNull();
    expect(readDisclosure({ provider: "openrouter", residence: "cloud" }, { ...read, name: "exec" })).toBeNull();
    expect(readDisclosure(null, read)).toBeNull();
  });
});

describe("useReadDisclosureStore", () => {
  it("remembers which providers were already disclosed this session", () => {
    const s = useReadDisclosureStore.getState();
    expect(s.disclosed("openrouter")).toBe(false);
    s.markDisclosed("openrouter");
    expect(useReadDisclosureStore.getState().disclosed("openrouter")).toBe(true);
    expect(useReadDisclosureStore.getState().disclosed("anthropic")).toBe(false);
  });
});
