import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { useThreadStore } from "@/store/threadStore";
import { axeViolations } from "@/test/axe";
import { CreatorModeChip } from "./CreatorModeChip";
import { calls, routes, useSidecarStub } from "./testKit";

describe("CreatorModeChip", () => {
  useSidecarStub();
  beforeEach(() => {
    window.__OH_HUMAN__ = "h-token";
    usePluginsStore.getState().reset();
    useThreadStore.setState({ activeThreadId: "t-1" });
  });
  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "en" });
    useThreadStore.setState({ activeThreadId: null });
  });

  it("shows nothing while creator mode is off for the active thread", async () => {
    routes.set("GET /cordis/creator", { body: { threadId: "t-1", enabled: false } });
    render(<CreatorModeChip />);
    await waitFor(() => expect(calls.some((c) => c.path === "/cordis/creator?thread_id=t-1")).toBe(true));
    expect(screen.queryByText("Creator mode")).toBeNull();
  });

  it("shows a discreet chip when it is on for this thread and turns it off with one click", async () => {
    routes.set("GET /cordis/creator", { body: { threadId: "t-1", enabled: true } });
    routes.set("POST /cordis/creator", { body: { threadId: "t-1", enabled: false } });
    const { container } = render(<CreatorModeChip />);
    expect(await screen.findByText("Creator mode")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Turn creator mode off in this conversation" }));
    expect(calls.at(-1)?.body).toEqual({ thread_id: "t-1", enabled: false });
    await waitFor(() => expect(screen.queryByText("Creator mode")).toBeNull());
  });

  it("follows the active thread: another thread starts without the chip", async () => {
    routes.set("GET /cordis/creator", { body: { threadId: "t-1", enabled: true } });
    render(<CreatorModeChip />);
    await screen.findByText("Creator mode");
    routes.set("GET /cordis/creator", { body: { threadId: "t-2", enabled: false } });
    useThreadStore.setState({ activeThreadId: "t-2" });
    await waitFor(() => expect(screen.queryByText("Creator mode")).toBeNull());
  });

  it("speaks Portuguese", async () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    routes.set("GET /cordis/creator", { body: { threadId: "t-1", enabled: true } });
    render(<CreatorModeChip />);
    expect(await screen.findByText("Modo criador")).toBeTruthy();
  });
});
