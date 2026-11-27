import { beforeEach, describe, expect, it } from "vitest";
import { providerFault } from "@/components/agent/chatProvider";
import { useProviderStore, type Connection } from "./providerStore";
import { cleanResetAt, formatResetLocal, msUntil } from "./usageLimit";

const CANARY = "CANARY-TASK-7f3c";
const EMAIL = "person@example.com";

function connection(overrides: Partial<Connection> = {}): Connection {
  return {
    id: "an", provider: "anthropic", label: "Anthropic", residence: "cloud", endpoint: "",
    secret: null, health: "live", detail: "keep", probes: [], facts: [], models: [],
    defaultModel: "", enabled: true, lastProbe: "", ...overrides,
  };
}

describe("cleanResetAt", () => {
  it("keeps an ISO instant and drops everything else", () => {
    expect(cleanResetAt("2026-11-21T09:20:00+00:00")).toBe("2026-11-21T09:20:00+00:00");
    expect(cleanResetAt("2026-11-21T09:20:00Z")).toBe("2026-11-21T09:20:00Z");
    expect(cleanResetAt("6:20am")).toBeNull();
    expect(cleanResetAt(`2026-11-21T09:20:00Z ${CANARY}`)).toBeNull();
    expect(cleanResetAt(EMAIL)).toBeNull();
    expect(cleanResetAt(null)).toBeNull();
  });
});

describe("formatResetLocal", () => {
  it("formats the local clock and never the original phrase", () => {
    const shown = formatResetLocal("2026-11-21T09:20:00Z", "pt-BR");
    expect(shown).toMatch(/^\d{2}:\d{2}$/);
    expect(shown).not.toContain("am");
    expect(formatResetLocal("not a time", "en")).toBeNull();
  });
});

describe("msUntil", () => {
  it("is the wait until the instant, and zero once that instant has passed", () => {
    const reset = "2026-11-21T09:20:00Z";
    const at = Date.parse("2026-11-21T09:00:00Z");
    expect(msUntil(reset, at)).toBe(20 * 60 * 1000);
    expect(msUntil(reset, Date.parse(reset))).toBe(0);
    expect(msUntil(EMAIL, at)).toBeNull();
  });
});

describe("noteUsageLimit", () => {
  beforeEach(() => {
    useProviderStore.setState({ connections: [connection(), connection({ id: "or", provider: "openrouter", label: "OpenRouter" })], usageLimit: null });
  });

  it("stores the class and the reset instant, and drops task text", () => {
    useProviderStore.getState().noteUsageLimit("an", "2026-11-21T09:20:00+00:00");
    const c = useProviderStore.getState().connections.find((x) => x.id === "an")!;
    expect(c.failure).toBe("usage_limit");
    expect(providerFault(c)).toBe("usage_limit");
    expect(c.resetAt).toBe("2026-11-21T09:20:00+00:00");
    expect(c.detail).toBe("");
    expect(JSON.stringify(useProviderStore.getState().usageLimit)).not.toContain(CANARY);
    useProviderStore.getState().noteUsageLimit("an", `${EMAIL} ${CANARY}`);
    expect(useProviderStore.getState().connections.find((x) => x.id === "an")?.resetAt).toBeUndefined();
    expect(useProviderStore.getState().usageLimit?.resetAt).toBeNull();
  });

  it("clears the limit so the account can answer again", () => {
    useProviderStore.getState().noteUsageLimit("an", "2026-11-21T09:20:00Z");
    useProviderStore.getState().clearUsageLimit();
    const c = useProviderStore.getState().connections.find((x) => x.id === "an")!;
    expect(useProviderStore.getState().usageLimit).toBeNull();
    expect(c.failure).toBeUndefined();
    expect(c.health).toBe("live");
  });
});

describe("cleanResetAt cap", () => {
  it("drops an instant more than 14 days ahead, the same cap as Retry-After", () => {
    const now = Date.parse("2026-11-21T09:00:00Z");
    expect(cleanResetAt("2026-12-04T09:00:00Z", now)).toBe("2026-12-04T09:00:00Z");
    expect(cleanResetAt("2026-12-05T09:00:00Z", now)).toBe("2026-12-05T09:00:00Z");
    expect(cleanResetAt("2026-12-05T09:00:01Z", now)).toBeNull();
    expect(cleanResetAt("2099-01-01T00:00:00Z", now)).toBeNull();
    expect(formatResetLocal("2099-01-01T00:00:00Z", "en")).toBeNull();
  });
});
