import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { LoginStatus } from "./LoginStatus";
import { nextStep } from "./nextStep";
import { useProviderStore } from "./providerStore";
import { LOGIN_POLL_LIMIT_MS } from "./subscriptionLogin";

const initial = useProviderStore.getState();
const anthropic = () => useProviderStore.getState().connections.find((c) => c.provider === "anthropic")!;
const signedOut = () =>
  useProviderStore.setState((s) => ({
    connections: s.connections.map((c) =>
      c.provider === "anthropic" ? { ...c, enabled: true, health: "fault", failure: "cli-signin", detail: "" } : c,
    ),
  }));

beforeEach(() => {
  useProviderStore.setState(initial, true);
  useLocaleStore.setState({ locale: "en" });
  signedOut();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("sign-in that cannot start", () => {
  it.each([
    ["not-started", "Sign-in could not start from here. Copy the command and run it in a terminal."],
    ["not-installed", "The command-line tool was not found on this computer. Copy the command and run it in a terminal once it is installed."],
  ])("a %s refusal says why and falls back to copying the command", async (reason, sentence) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ ok: false, reason }) }));
    expect(nextStep(anthropic())).toMatchObject({ kind: "login" });
    render(<LoginStatus connectionId={anthropic().id} />);
    await act(async () => {
      await useProviderStore.getState().startLogin(anthropic().id);
    });
    expect(screen.getByRole("status").textContent).toContain(sentence);
    expect(useProviderStore.getState().loginWatch).toBeNull();
    expect(nextStep(anthropic())).toMatchObject({
      kind: "copy",
      copy: "claude login",
      label: "Copy `claude login`",
      thenRetest: true,
      status: "Sign-in needed",
    });
  });

  it("a sidecar that cannot be reached is the same as not started", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    render(<LoginStatus connectionId={anthropic().id} />);
    await act(async () => {
      await useProviderStore.getState().startLogin(anthropic().id);
    });
    expect(screen.getByRole("status").textContent).toContain("Sign-in could not start from here.");
    expect(nextStep(anthropic())).toMatchObject({ kind: "copy", copy: "claude login" });
  });

  it("says it in Portuguese too", async () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ ok: false, reason: "not-started" }) }));
    render(<LoginStatus connectionId={anthropic().id} />);
    await act(async () => {
      await useProviderStore.getState().startLogin(anthropic().id);
    });
    expect(screen.getByRole("status").textContent).toContain("O login não pôde começar daqui.");
  });
});

describe("sign-in that is never detected", () => {
  it("says so when the 5-minute wait ends, and stops the session", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ clis: [{ id: "claude", signed_in: false }] }) });
    vi.stubGlobal("fetch", fetch);
    useProviderStore.setState({
      loginWatch: { connectionId: anthropic().id, cliId: "claude", sessionId: "s1", startedAt: Date.now() - LOGIN_POLL_LIMIT_MS - 1 },
    });
    render(<LoginStatus connectionId={anthropic().id} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.getByRole("status").textContent).toContain("Sign-in was not detected. Try again.");
    expect(useProviderStore.getState().loginWatch).toBeNull();
    expect(fetch.mock.calls.some(([url, init]) => String(url).endsWith("/providers/clis/login/s1") && init?.method === "DELETE")).toBe(true);
    expect(nextStep(anthropic())).toMatchObject({ kind: "login" });
  });

  it("a new attempt clears the timeout sentence", async () => {
    useProviderStore.setState({ loginNotice: { connectionId: anthropic().id, reason: "timeout" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true, id: "s2" }) }));
    await useProviderStore.getState().startLogin(anthropic().id);
    expect(useProviderStore.getState().loginNotice).toBeNull();
    expect(useProviderStore.getState().loginWatch?.sessionId).toBe("s2");
  });
});
