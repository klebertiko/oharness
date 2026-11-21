import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { en } from "@/i18n/messages.en";
import { ptBR } from "@/i18n/messages.pt-BR";
import { bindPluginsClient, resetPluginsStore, usePluginsStore } from "./pluginsStore";
import type { InspectedPackage, PluginsClient, PluginView } from "./pluginsTypes";

const FORBIDDEN = /framework|sample|template|preset|copilot|microsoft/i;

function pkg(over: Partial<InspectedPackage> = {}): InspectedPackage {
  return {
    fetchId: "a".repeat(16),
    name: "widget",
    version: "1.2.3",
    source: { kind: "npm", spec: "widget", version: "1.2.3" },
    scripts: [],
    runtime: "isolated",
    capabilities: [],
    isolation: { enforced: ["files", "processes", "credentials"], notEnforced: ["network"] },
    digest: "digest-a",
    unmetDependencies: [],
    ...over,
  };
}

function view(over: Partial<PluginView> = {}): PluginView {
  return {
    id: "c".repeat(16),
    name: "widget",
    version: "1.2.3",
    source: { kind: "npm", spec: "widget", version: "1.2.3" },
    enabled: true,
    state: "active",
    scripts: [],
    runtime: "isolated",
    capabilities: [],
    ...over,
  };
}

interface Fakes {
  fetch: Mock<(source: import("./pluginsTypes").SourceRef, signal: AbortSignal) => Promise<InspectedPackage>>;
  install: Mock<(body: import("./pluginsTypes").InstallBody, onLog: (lines: string[]) => void) => Promise<PluginView>>;
  discard: Mock<(fetchId: string) => Promise<void>>;
  propose: Mock;
  decide: Mock;
  send: Mock;
}

function fake(over: Partial<PluginsClient> = {}): Fakes {
  const client = {
    fetch: vi.fn(async () => pkg()),
    discard: vi.fn(async () => undefined),
    install: vi.fn(async (_body, onLog: (lines: string[]) => void) => {
      onLog(["loading"]);
      return view();
    }),
    list: vi.fn(async () => []),
    status: vi.fn(async () => ({ state: "running" })),
    enable: vi.fn(),
    disable: vi.fn(),
    remove: vi.fn(async () => undefined),
    logs: vi.fn(async () => []),
    marketplace: vi.fn(async () => ({ version: 1 as const, plugins: [], trust: "unreviewed" as const })),
    share: vi.fn(),
    apis: vi.fn(async () => []),
    writeStarter: vi.fn(),
    propose: vi.fn(async (input: { fetchId: string; name: string; version: string; summary: string }) => ({
      id: input.fetchId,
      fetchId: input.fetchId,
      name: input.name,
      version: input.version,
      summary: input.summary,
      enable: true,
      status: "pending" as const,
    })),
    decide: vi.fn(async (id: string, decision: "approve" | "reject") => ({ applied: decision === "approve", plugin: decision === "approve" ? view({ id }) : undefined })),
    send: vi.fn(),
    ...over,
  };
  bindPluginsClient(client as unknown as PluginsClient);
  return client as unknown as Fakes;
}

afterEach(() => {
  resetPluginsStore();
});

describe("plugin install flow", () => {
  it("inspects name, version and source before anything is installed", async () => {
    const client = fake();
    const seen = pkg();
    client.fetch.mockResolvedValue(seen);
    await usePluginsStore.getState().inspect(seen.source);
    const state = usePluginsStore.getState();
    expect(state.pending.map((item) => [item.name, item.version, item.source])).toEqual([["widget", "1.2.3", seen.source]]);
    expect(state.phase).toBe("ready");
    expect(client.install).not.toHaveBeenCalled();
  });

  it("approves install scripts per package and does not install a rejected one", async () => {
    const client = fake();
    const first = pkg({ fetchId: "a".repeat(16), name: "alpha", scripts: ["install"], digest: "d1" });
    const second = pkg({ fetchId: "b".repeat(16), name: "beta", version: "2.0.0", scripts: ["prepare"], digest: "d2" });
    client.fetch.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await usePluginsStore.getState().inspect(first.source);
    await usePluginsStore.getState().inspect(second.source);
    usePluginsStore.getState().decide(first.fetchId, "approve");
    expect(usePluginsStore.getState().decisions[second.fetchId]).toBeUndefined();
    await usePluginsStore.getState().installPending();
    expect(client.install).not.toHaveBeenCalled();
    expect(usePluginsStore.getState().error).toBe("decide");
    usePluginsStore.getState().decide(second.fetchId, "reject");
    await usePluginsStore.getState().installPending();
    expect(client.install).toHaveBeenCalledTimes(1);
    const body = client.install.mock.calls[0][0];
    expect(body).toEqual({ fetchId: first.fetchId, accept: true, digest: "d1", enable: true, scripts: "do-not-run" });
    expect(body).not.toHaveProperty("allowBuilds");
    expect(body).not.toHaveProperty("approvedBuilds");
    expect(client.discard).toHaveBeenCalledWith(second.fetchId);
  });

  it("cancels only while the download is in flight and then ignores the late package", async () => {
    let release: (value: InspectedPackage) => void = () => undefined;
    const client = fake({
      fetch: vi.fn(() => new Promise<InspectedPackage>((resolve) => {
        release = resolve;
      })),
    });
    const pending = usePluginsStore.getState().inspect({ kind: "npm", spec: "widget", version: "1.2.3" });
    expect(usePluginsStore.getState().phase).toBe("downloading");
    expect(usePluginsStore.getState().cancelDownload()).toBe(true);
    release(pkg());
    await pending;
    expect(usePluginsStore.getState().pending).toEqual([]);
    expect(usePluginsStore.getState().phase).not.toBe("downloading");
    expect(usePluginsStore.getState().cancelDownload()).toBe(false);
    expect(client.install).not.toHaveBeenCalled();
  });

  it("keeps the install log as lines arrive", async () => {
    const client = fake({
      install: vi.fn(async (_body, onLog: (lines: string[]) => void) => {
        onLog(["downloading"]);
        onLog(["downloading", "loading"]);
        return view();
      }),
    });
    client.fetch.mockResolvedValue(pkg());
    await usePluginsStore.getState().inspect({ kind: "npm", spec: "widget", version: "1.2.3" });
    await usePluginsStore.getState().installPending();
    expect(usePluginsStore.getState().log).toEqual(["downloading", "loading"]);
  });

  it("enters creator mode without sending the draft or approving every install", async () => {
    const client = fake();
    usePluginsStore.getState().setDraft("a plugin that lists files");
    const draft = usePluginsStore.getState().draft;
    usePluginsStore.getState().enterCreatorMode();
    expect(usePluginsStore.getState().sessionMode).toBe("creator");
    expect(usePluginsStore.getState().draft).toBe(draft);
    expect(usePluginsStore.getState().messageSent).toBe(false);
    expect(client.send).not.toHaveBeenCalled();

    const first = pkg({ fetchId: "a".repeat(16), name: "alpha", scripts: ["install"] });
    const second = pkg({ fetchId: "b".repeat(16), name: "beta", scripts: ["prepare"] });
    client.fetch.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    await usePluginsStore.getState().inspect(first.source);
    await usePluginsStore.getState().inspect(second.source);
    usePluginsStore.getState().decide(first.fetchId, "approve");
    usePluginsStore.getState().decide(second.fetchId, "approve");
    await usePluginsStore.getState().installPending();
    expect(client.install).not.toHaveBeenCalled();
    expect(client.propose).toHaveBeenCalledTimes(2);
    expect(usePluginsStore.getState().actions.map((action) => action.status)).toEqual(["pending", "pending"]);
    await usePluginsStore.getState().approveAction(first.fetchId);
    expect(client.decide).toHaveBeenCalledTimes(1);
    expect(client.decide).toHaveBeenCalledWith(first.fetchId, "approve", true);
    expect(usePluginsStore.getState().actions.find((action) => action.fetchId === second.fetchId)?.status).toBe("pending");
    expect(usePluginsStore.getState().lastResult).toEqual({ name: "alpha", version: "1.2.3" });
    expect(usePluginsStore.getState().messageSent).toBe(false);
  });
});

describe("plugin copy", () => {
  it("does not use banned words", () => {
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      if (!key.startsWith("plugins.")) continue;
      expect(en[key], key).not.toMatch(FORBIDDEN);
      expect(ptBR[key], key).not.toMatch(FORBIDDEN);
    }
  });
});
