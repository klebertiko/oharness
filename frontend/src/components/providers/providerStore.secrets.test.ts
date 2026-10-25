import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useProviderStore } from "./providerStore";

describe("providerStore.attachSecret", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    // Reset the ollama-cloud row to an unsealed setup state between tests.
    useProviderStore.setState((s) => ({
      connections: s.connections.map((c) =>
        c.id === "ollama-cloud"
          ? {
              ...c,
              secret: null,
              health: "setup" as const,
              enabled: false,
              detail: "No credential yet.",
            }
          : c
      ),
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores only a SecretRef on the connection — never the pasted key", async () => {
    const raw = "sk-or-PASTEDPLAINTEXT99zz";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ secretRef: "oharness/ollama-cloud" }),
      })
    );

    const done = useProviderStore.getState().attachSecret("ollama-cloud", raw);
    await vi.runAllTimersAsync();
    await done;

    const c = useProviderStore.getState().connections.find((x) => x.id === "ollama-cloud");
    expect(c?.secret).toBeTruthy();
    expect(c?.secret?.service).toBe("oharness/ollama-cloud");
    expect(c?.secret?.vault).toBe("backend");
    expect(c?.secret?.tail).toBe("99zz");

    const snap = JSON.stringify(useProviderStore.getState().connections);
    expect(snap).not.toContain("PASTEDPLAINTEXT");
    expect(snap).not.toContain(raw);
    expect(snap).toContain("oharness/ollama-cloud");
  });
});
