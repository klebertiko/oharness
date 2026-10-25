import { describe, expect, it } from "vitest";
import { providerReadiness, chatProviderOptions, pickChatProvider, rowStatus, rowTone } from "./chatProvider";
import type { Connection } from "@/components/providers/providerStore";

/**
 * "Connected, but the sidebar does not show it": every surface (Providers
 * list, dossier header, credential seal, chat picker) used to re-derive
 * ready/connected from its own mix of enabled / health / secret. This pins ONE
 * derivation, `providerReadiness`, that all of them read.
 */
const conn = (over: Partial<Connection>): Connection =>
  ({
    id: "c", provider: "anthropic", label: "Anthropic", residence: "cloud",
    health: "live", enabled: true, secret: null, ...over,
  }) as Connection;

const secret = { service: "oharness/c", prefix: "", tail: "····", length: 0, vault: "backend", savedAt: "" } as Connection["secret"];

describe("providerReadiness", () => {
  it("enabled + live probe is ready and verified", () => {
    expect(providerReadiness(conn({}))).toMatchObject({ state: "ready", ready: true, verified: true, label: "Verified", tone: "verified", missing: null });
  });

  it("enabled but never probed (the state after a reload) is ready but not verified", () => {
    expect(providerReadiness(conn({ health: "setup" }))).toMatchObject({ state: "ready", ready: true, verified: false, label: "Not verified", missing: null });
  });

  it("a passing probe on a connection that is turned off is NOT connected - verified evidence never outranks the off switch", () => {
    const r = providerReadiness(conn({ enabled: false, health: "live" }));
    expect(r).toMatchObject({ state: "off", ready: false, verified: false, label: "Not connected", tone: "unconfigured", missing: "turn-on" });
  });

  it("an api-key connection with a key on file but turned off is off, missing only the switch", () => {
    expect(providerReadiness(conn({ provider: "openrouter", enabled: false, health: "setup", secret }))).toMatchObject({ state: "off", missing: "turn-on" });
  });

  it("an api-key connection with nothing on file needs setup and names the credential", () => {
    expect(providerReadiness(conn({ provider: "openrouter", enabled: false, health: "setup", secret: null }))).toMatchObject({ state: "needs-setup", ready: false, missing: "credential" });
  });

  it("a failed probe is a fault whether or not it is enabled", () => {
    expect(providerReadiness(conn({ health: "fault" }))).toMatchObject({ state: "fault", ready: false, label: "Unavailable", tone: "failing", missing: "fix-failure" });
    expect(providerReadiness(conn({ health: "fault", enabled: false }))).toMatchObject({ state: "fault", ready: false });
  });

  it("degraded stays ready (needs attention, still answers runs)", () => {
    expect(providerReadiness(conn({ health: "degraded" }))).toMatchObject({ state: "ready", ready: true, verified: true, tone: "attention" });
  });

  it("agrees with rowStatus / rowTone for every enabled x health combination", () => {
    for (const enabled of [true, false]) {
      for (const health of ["live", "setup", "probing", "degraded", "fault"] as const) {
        const c = conn({ enabled, health });
        expect(providerReadiness(c).label).toBe(rowStatus(c));
        expect(providerReadiness(c).tone).toBe(rowTone(c));
      }
    }
  });

  it("is the single readiness gate for picking and for the picker options", () => {
    for (const enabled of [true, false]) {
      for (const health of ["live", "setup", "probing", "degraded", "fault"] as const) {
        const c = conn({ id: "x", enabled, health });
        const ready = providerReadiness(c).ready;
        expect(pickChatProvider([c], "x") !== null).toBe(ready);
        expect(chatProviderOptions([c])[1].ready).toBe(ready);
      }
    }
  });
});
