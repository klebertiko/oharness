import { beforeEach, describe, expect, it } from "vitest";
import { chordsIn, shellNavCommands } from "./commands";
import { useHarnessSessionStore } from "@/store/harnessSessionStore";
import { useShellStore } from "./shellStore";
import { useThreadStore } from "@/store/threadStore";

describe("shellNavCommands", () => {
  beforeEach(() => {
    useHarnessSessionStore.setState({ enabled: true, activeBundle: null, hydrated: false });
    useShellStore.setState({ section: "chats", sidebar: "hidden", dockOpen: false, leftOpen: false, rightOpen: false });
    useThreadStore.setState({ threads: [], activeThreadId: null, messagesByThread: {} });
  });

  it("exposes every destination, the session command and the harness verbs", () => {
    const ids = shellNavCommands().map((c) => c.id);
    expect(ids).toEqual([
      "go:chats",
      "go:forja",
      "go:studio",
      "go:plugins",
      "go:settings",
      "go:providers",
      "session:new",
      "sidebar:cycle",
      "dock:toggle",
      "dock:toggle-alt",
      "palette:open",
      "shortcuts:open",
      "regions:cycle",
      "theme:toggle",
      "harness:library",
      "harness:on",
      "harness:off",
    ]);
  });

  it("never shows two commands with the same name (the modal and palette list them by label)", () => {
    const labels = shellNavCommands().map((command) => command.label);
    expect(labels.filter((label, index) => labels.indexOf(label) !== index)).toEqual([]);
  });

  it("keeps the shortcut list equal to the registry chords", () => {
    const commands = shellNavCommands();
    expect(chordsIn(commands)).toEqual(commands.flatMap((command) => (command.chord ? [command.chord] : [])));
    const seen = new Set<string>();
    for (const chord of chordsIn(commands)) {
      expect(seen.has(chord), chord).toBe(false);
      seen.add(chord);
    }
  });

  it("Go to Studio changes the destination and leaves the sidebar and the dock alone", () => {
    useShellStore.setState({ section: "chats", sidebar: "hidden", dockOpen: false, leftOpen: false, rightOpen: false });
    shellNavCommands().find((c) => c.id === "go:studio")!.run();
    expect(useShellStore.getState().section).toBe("studio");
    expect(useShellStore.getState().sidebar).toBe("hidden");
    expect(useShellStore.getState().dockOpen).toBe(false);
  });

  it("Go to Chats keeps a closed dock closed", () => {
    useShellStore.setState({ section: "studio", sidebar: "rail", dockOpen: false, leftOpen: true, rightOpen: false });
    shellNavCommands().find((c) => c.id === "go:chats")!.run();
    expect(useShellStore.getState().section).toBe("chats");
    expect(useShellStore.getState().sidebar).toBe("rail");
    expect(useShellStore.getState().dockOpen).toBe(false);
  });

  it("harness on/off toggles harnessSessionStore.enabled", () => {
    const cmds = shellNavCommands();
    cmds.find((c) => c.id === "harness:off")!.run();
    expect(useHarnessSessionStore.getState().enabled).toBe(false);
    cmds.find((c) => c.id === "harness:on")!.run();
    expect(useHarnessSessionStore.getState().enabled).toBe(true);
  });
});
