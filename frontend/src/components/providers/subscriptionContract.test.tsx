/**
 * R-PRV-00 — frontend half of the subscription (CLI seat) contract.
 * Pairs with `backend/tests/test_subscription_contract.py` (do not weaken either side).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { providerFault } from "@/components/agent/chatProvider";
import { PROVIDERS, type ProviderId } from "./catalog";
import { ConnectionPanel } from "./ConnectionPanel";
import { nextStep } from "./nextStep";
import type { Connection } from "./providerStore";
import type { ConnectionActions } from "./useConnectionActions";
import { KEY_FIELD_ID } from "./useConnectionActions";

const SUBSCRIPTION_CLI: ProviderId[] = ["anthropic", "openai", "cursor"];

const conn = (over: Partial<Connection>): Connection =>
  ({
    id: "sub-cli",
    provider: "anthropic",
    label: "Anthropic",
    residence: "cloud",
    endpoint: "",
    secret: null,
    health: "setup",
    detail: "",
    probes: [],
    facts: [],
    models: [],
    defaultModel: "",
    enabled: false,
    lastProbe: "",
    ...over,
  }) as Connection;

const stubActions = (over: Partial<ConnectionActions> = {}): ConnectionActions => ({
  endpointValue: "https://api.anthropic.com",
  endpointState: null,
  editEndpoint: () => {},
  commitEndpoint: () => Promise.resolve(true),
  test: async () => {},
  runStep: () => {},
  copied: null,
  replacing: false,
  setReplacing: () => {},
  ...over,
});

afterEach(() => cleanup());

describe("subscription contract (R-PRV-00 frontend)", () => {
  describe("catalog — subscription vendors ride the local CLI session", () => {
    it.each(SUBSCRIPTION_CLI)("%s is subscription + kind cli with a login command", (id) => {
      const spec = PROVIDERS[id];
      expect(spec.billing).toBe("subscription");
      expect(spec.credential.kind).toBe("cli");
      expect(spec.credential.login).toMatch(/\S+\s+login/);
      expect(spec.credential.where).toContain("`");
    });
  });

  describe("probe detail — cli-signin and cli-missing (ADR 0013)", () => {
    const setup = (detail: string) => providerFault({ health: "setup", detail });

    it.each([
      ["claude CLI not found on PATH. Install Claude Code, then run `claude login`.", "cli-missing"],
      ["codex CLI is installed but not logged in. Run `codex login`.", "cli-signin"],
      ["cursor-agent CLI is installed but not logged in. Run `cursor-agent login`.", "cli-signin"],
    ])("%s -> %s", (detail, expected) => {
      expect(setup(detail)).toBe(expected);
    });

    it("does not trust CLI phrases on a faulted connection", () => {
      expect(providerFault({ health: "fault", detail: "claude CLI not found on PATH." })).toBe("unknown");
    });
  });

  describe("next step — per-vendor login command is copied unchanged", () => {
    it.each([
      ["anthropic", "claude CLI is installed but not logged in. Run `claude login`.", "claude login"],
      ["openai", "codex CLI is installed but not logged in. Run `codex login`.", "codex login"],
      ["cursor", "cursor-agent CLI is installed but not logged in. Run `cursor-agent login`.", "cursor-agent login"],
    ] as const)("%s signed-out -> copy %s", (provider, detail, login) => {
      const step = nextStep(conn({ provider, detail }));
      expect(step).toMatchObject({ kind: "copy", copy: login, status: "Sign-in needed" });
    });
  });

  describe("KeyRow — cli branch never exposes an API key field", () => {
    it.each(SUBSCRIPTION_CLI)("%s shows CLI session row, not a key input", (provider) => {
      const spec = PROVIDERS[provider];
      const cli = spec.credential.login?.split(" ")[0] ?? spec.vendor;
      const endpoint = spec.endpoint.default;
      render(<ConnectionPanel c={conn({ provider, label: spec.vendor, endpoint })} actions={stubActions({ endpointValue: endpoint })} />);
      expect(screen.getByText("Sign-in")).toBeTruthy();
      expect(screen.getByText(new RegExp(`Uses your ${cli} login`))).toBeTruthy();
      expect(screen.queryByLabelText(/API key/i)).toBeNull();
      expect(document.getElementById(KEY_FIELD_ID)).toBeNull();
      expect(screen.queryByRole("button", { name: /Save key/i })).toBeNull();
    });

    it("shows the signed-in account when the probe reported one", () => {
      render(
        <ConnectionPanel
          c={conn({ provider: "anthropic", facts: [{ k: "account", v: "user@example.com" }] })}
          actions={stubActions()}
        />,
      );
      expect(screen.getByText(/Signed in as user@example.com/)).toBeTruthy();
    });
  });
});
