import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pluginsApi } from "@/components/plugins/pluginsApi";
import { plugin, serveFetch, useSidecarStub } from "@/components/plugins/testKit";
import type { PluginView } from "@/components/plugins/types";
import { usePluginsStore } from "./pluginsStore";

const npm = { kind: "npm" as const, spec: "notes-tool", version: "1.2.0" };

/** An install the test finishes by hand, after the person already moved on. */
const slowInstall = () => {
  let finish: (value: PluginView) => void = () => undefined;
  const spy = vi.spyOn(pluginsApi, "install").mockImplementation(() => new Promise<PluginView>((resolve) => (finish = resolve)));
  return { spy, finish: (value: PluginView) => finish(value) };
};

const toPreview = async () => {
  serveFetch({ scripts: [] });
  await usePluginsStore.getState().fetchPackage(npm);
  expect(usePluginsStore.getState().add.step).toBe("preview");
};

describe("pluginsStore: an old install never writes over a newer flow", () => {
  useSidecarStub();
  beforeEach(() => usePluginsStore.getState().reset());
  afterEach(() => vi.restoreAllMocks());

  it("an install that ends after Cancel leaves the form as it is", async () => {
    await toPreview();
    const { finish } = slowInstall();
    const pending = usePluginsStore.getState().install(true);
    expect(usePluginsStore.getState().add.step).toBe("installing");
    usePluginsStore.getState().resetAdd();
    finish(plugin());
    await pending;
    expect(usePluginsStore.getState().add).toMatchObject({ step: "form", installed: null, fetched: null });
  });

  it("an install that ends after a new add does not mark the new one done", async () => {
    await toPreview();
    const { finish } = slowInstall();
    const pending = usePluginsStore.getState().install(true);
    usePluginsStore.getState().resetAdd();
    await toPreview();
    finish(plugin());
    await pending;
    expect(usePluginsStore.getState().add).toMatchObject({ step: "preview", installed: null });
  });

  it("an install that fails after Cancel does not bring the old preview back", async () => {
    await toPreview();
    let fail: (error: Error) => void = () => undefined;
    vi.spyOn(pluginsApi, "install").mockImplementation(() => new Promise<PluginView>((_resolve, reject) => (fail = reject)));
    const pending = usePluginsStore.getState().install(true);
    usePluginsStore.getState().resetAdd();
    fail(new Error("late"));
    await pending;
    expect(usePluginsStore.getState().add).toMatchObject({ step: "form", error: null, fetched: null });
  });
});
