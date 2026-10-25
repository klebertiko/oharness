import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeVault, prefixMatches, saveSecret, type SecretRef } from "./secrets";

const RAW = "sk-proj-SUPERSECRETVALUE0aT7";

describe("secrets.saveSecret", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Ensure no Tauri invoke is present in the test DOM.
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("inside the desktop shell, stores the key in the sidecar (the store runs read from), never a native command", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("command secret_save not found"));
    (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ secretRef: "oharness/openrouter" }) });
    vi.stubGlobal("fetch", fetchMock);

    const ref = await saveSecret("oharness/openrouter", "sk-or-desktopkey1234");

    expect(invoke).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/providers/openrouter/secret",
      expect.objectContaining({ method: "POST" }),
    );
    expect(ref.vault).toBe("backend");
    expect(activeVault()).toBe("backend");
  });

  it("POSTs plaintext to backend and returns only a SecretRef", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ secretRef: "oharness/openai" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const ref = await saveSecret("oharness/openai", RAW);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/providers/openai/secret",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: RAW }),
      })
    );

    expect(ref).toEqual(
      expect.objectContaining<Partial<SecretRef>>({
        service: "oharness/openai",
        prefix: "sk-proj-",
        tail: "0aT7",
        length: RAW.length,
        vault: "backend",
      })
    );

    // Client-held shape must never carry the pasted material.
    expect(JSON.stringify(ref)).not.toContain("SUPERSECRET");
    expect(ref).not.toHaveProperty("key");
    expect(ref).not.toHaveProperty("value");
    expect(ref).not.toHaveProperty("plaintext");
    expect(Object.keys(ref).sort()).toEqual(
      ["length", "prefix", "savedAt", "service", "tail", "vault"].sort()
    );
  });

  it("ensures connection then retries when secret POST returns 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404 })
      .mockResolvedValueOnce({ ok: true, status: 201 }) // create connection
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ secretRef: "oharness/ollama-cloud" }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const ref = await saveSecret("oharness/ollama-cloud", "sk-or-cloudkeyZZ99");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "http://127.0.0.1:8000/providers/ollama-cloud/secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "sk-or-cloudkeyZZ99" }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "http://127.0.0.1:8000/providers/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "ollama-cloud", provider: "ollama", label: "ollama-cloud",
        residence: "cloud", endpoint: "", enabled: false,
      }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "http://127.0.0.1:8000/providers/ollama-cloud/secret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "sk-or-cloudkeyZZ99" }),
    });
    expect(ref.service).toBe("oharness/ollama-cloud");
    expect(ref.vault).toBe("backend");
    expect(JSON.stringify(ref)).not.toContain("cloudkey");
  });

  it("refuses (never parks the key in renderer memory) when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const err = await saveSecret("oharness/openai", RAW).catch((e: Error) => e);

    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain("SUPERSECRET");
  });

  it("refuses when the sidecar rejects the key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));

    await expect(saveSecret("oharness/openai", RAW)).rejects.toThrow(/not stored/);
  });

  it("activeVault prefers backend outside Tauri", () => {
    expect(activeVault()).toBe("backend");
  });
});

describe("prefixMatches", () => {
  it("passes when there is no expected prefix to contradict", () => {
    expect(prefixMatches("anything", undefined)).toBe(true);
  });

  it("passes while the pasted value is still shorter than the prefix — no premature warning", () => {
    expect(prefixMatches("sk-", "sk-or-")).toBe(true);
  });

  it("fails once the value is long enough to disagree with the vendor prefix", () => {
    expect(prefixMatches("sk-ant-wrongvendor", "sk-or-")).toBe(false);
  });

  it("passes a correctly-prefixed value", () => {
    expect(prefixMatches("sk-or-realkey", "sk-or-")).toBe(true);
  });
});
