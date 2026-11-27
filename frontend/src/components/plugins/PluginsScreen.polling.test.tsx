import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hostPolling, usePluginsStore } from "@/store/pluginsStore";
import { PluginsScreen } from "./PluginsScreen";
import { calls, plugin, routes, useSidecarStub } from "./testKit";

const host = (state: string) => ({ state, reason: null, restarts: 0, node: "22.20.0", hostLog: [], plugins: 1 });
const statusCalls = () => calls.filter((c) => c.method === "GET" && c.path === "/cordis/status").length;
const tick = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

describe("PluginsScreen: a host that is starting", () => {
  useSidecarStub();
  const saved = { ...hostPolling };
  beforeEach(() => {
    usePluginsStore.getState().reset();
    vi.useFakeTimers();
    hostPolling.intervalMs = 100;
    hostPolling.maxTries = 5;
    routes.set("GET /cordis/status", { body: host("starting") });
    routes.set("GET /cordis/plugins", { body: { plugins: [] } });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    Object.assign(hostPolling, saved);
  });

  it("asks again until the host is running, then shows the new list", async () => {
    render(<PluginsScreen />);
    await tick(0);
    expect(screen.getByText("Starting")).toBeTruthy();
    const first = statusCalls();
    await tick(250);
    expect(statusCalls()).toBeGreaterThan(first);
    routes.set("GET /cordis/status", { body: host("running") });
    routes.set("GET /cordis/plugins", { body: { plugins: [plugin()] } });
    await tick(100);
    await tick(0);
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("notes-tool")).toBeTruthy();
    const settled = statusCalls();
    await tick(1000);
    expect(statusCalls()).toBe(settled);
  });

  it("stops at the ceiling of tries", async () => {
    render(<PluginsScreen />);
    await tick(0);
    const first = statusCalls();
    await tick(100 * 20);
    expect(statusCalls() - first).toBe(hostPolling.maxTries);
  });

  it("stops when the screen goes away", async () => {
    const { unmount } = render(<PluginsScreen />);
    await tick(150);
    unmount();
    const left = statusCalls();
    await tick(1000);
    expect(statusCalls()).toBe(left);
  });
});
