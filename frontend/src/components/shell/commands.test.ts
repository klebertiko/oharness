import { beforeEach, describe, expect, it } from "vitest";
import { shellNavCommands } from "./commands";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useShellStore } from "./shellStore";

describe("shellNavCommands", () => {
  beforeEach(() => {
    useHarnessSessionStore.setState({ enabled: true, activeBundle: null, hydrated: false });
    useShellStore.setState({ section: "chats" });
  });

  it("exposes every destination plus the harness library and on/off", () => {
    const ids = shellNavCommands().map((c) => c.id);
    expect(ids).toEqual([
      "go:chats",
      "go:studio",
      "go:providers",
      "go:forja",
      "harness:library",
      "harness:on",
      "harness:off",
    ]);
  });

  it("Go to Studio selects the studio section and opens the inspector", () => {
    useShellStore.setState({ section: "chats", rightOpen: false });
    shellNavCommands().find((c) => c.id === "go:studio")!.run();
    expect(useShellStore.getState().section).toBe("studio");
    expect(useShellStore.getState().rightOpen).toBe(true);
  });

  it("Go to Chats selects chats and hides the inspector", () => {
    useShellStore.setState({ section: "studio", rightOpen: true });
    shellNavCommands().find((c) => c.id === "go:chats")!.run();
    expect(useShellStore.getState().section).toBe("chats");
    expect(useShellStore.getState().rightOpen).toBe(false);
  });

  it("harness on/off toggles harnessSessionStore.enabled", () => {
    const cmds = shellNavCommands();
    cmds.find((c) => c.id === "harness:off")!.run();
    expect(useHarnessSessionStore.getState().enabled).toBe(false);
    cmds.find((c) => c.id === "harness:on")!.run();
    expect(useHarnessSessionStore.getState().enabled).toBe(true);
  });
});
