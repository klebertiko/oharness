import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { useComposerDraftStore } from "@/store/composerDraftStore";
import { usePluginsStore } from "@/store/pluginsStore";
import { useThreadStore } from "@/store/threadStore";
import { axeViolations } from "@/test/axe";
import { sourceOf } from "./DiscoverTab";
import { PluginsScreen } from "./PluginsScreen";
import { calls, niloRequest, plugin, pluginIndex, routes, serveFetch, useSidecarStub } from "./testKit";

const running = { state: "running", reason: null, restarts: 0, node: "22.20.0", hostLog: [], plugins: 0 };
const serve = (requests: unknown[] = [niloRequest()], _creator = false) => {
  routes.set("GET /cordis/status", { body: running });
  routes.set("GET /cordis/plugins", { body: { plugins: [] } });
  routes.set("GET /cordis/requests", { body: { requests } });
};
const human = () => {
  window.__OH_HUMAN__ = "h-token";
};

describe("PluginsScreen: requests from Nilo, creator mode and Descobrir", () => {
  useSidecarStub();
  beforeEach(() => usePluginsStore.getState().reset());
  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "en" });
  });

  it("lists a pending request with the review, and Approve waits for the confirmation", async () => {
    human();
    serve();
    const { container } = render(<PluginsScreen />);
    const section = await screen.findByRole("region", { name: "Requests from Nilo" });
    expect(within(section).getByText("Nilo asks to install hello-tool 0.1.0")).toBeTruthy();
    expect(within(section).getByText("Written by Nilo in dev/hello-tool.")).toBeTruthy();
    expect(within(section).getByText(/Nilo wrote this code/)).toBeTruthy();
    expect(within(section).getByText("Host warning in English.")).toBeTruthy();
    const approve = within(section).getByRole("button", { name: "Approve" });
    expect(approve.hasAttribute("disabled")).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
    routes.set("POST /cordis/requests/1111222233334444/approve", { body: { request: niloRequest({ status: "approved" }), plugin: plugin({ name: "hello-tool" }) } });
    await userEvent.click(within(section).getByRole("checkbox", { name: "I read the warning and trust this plugin" }));
    routes.set("GET /cordis/requests", { body: { requests: [] } });
    await userEvent.click(approve);
    await waitFor(() => expect(screen.getByText(/No request waiting/)).toBeTruthy());
    expect(calls.find((c) => c.path.endsWith("/approve"))?.headers["x-oharness-human"]).toBe("h-token");
    expect(await screen.findByText("hello-tool")).toBeTruthy();
  });

  it("says when the files changed after the request, and that approving replaces an installed version", async () => {
    human();
    serve([niloRequest({ changed: true, replaces: { version: "0.0.9", madeByNilo: true, source: "local" } })]);
    render(<PluginsScreen />);
    expect(await screen.findByText(/The files changed after Nilo asked/)).toBeTruthy();
    expect(screen.getByText("Approving replaces the installed version 0.0.9.")).toBeTruthy();
  });

  it("keeps Approve and Reject off without the human credential", async () => {
    serve();
    render(<PluginsScreen />);
    const section = await screen.findByRole("region", { name: "Requests from Nilo" });
    expect(within(section).getByRole("button", { name: "Reject" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Let Nilo create a plugin" }).hasAttribute("disabled")).toBe(true);
  });

  it("Let Nilo create a plugin turns creator mode on in the active thread, sends nothing and leaves the draft alone", async () => {
    human();
    serve([], false);
    useThreadStore.setState({ activeThreadId: "t-1" });
    useComposerDraftStore.setState({ drafts: { "t-1": "meu rascunho" } });
    routes.set("GET /cordis/creator", { body: { threadId: "t-1", enabled: false } });
    routes.set("POST /cordis/creator", { body: { threadId: "t-1", enabled: true } });
    const { container } = render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Let Nilo create a plugin" }));
    expect(await screen.findByText("Creator mode on in this conversation")).toBeTruthy();
    expect(calls.find((c) => c.method === "POST" && c.path === "/cordis/creator")?.body).toEqual({ thread_id: "t-1", enabled: true });
    expect(screen.queryByLabelText("Draft for the chat")).toBeNull();
    expect(screen.getByRole("link", { name: "Open the chat" }).getAttribute("href")).toBe("/");
    expect(calls.filter((c) => c.path.startsWith("/execute"))).toEqual([]);
    expect(useComposerDraftStore.getState().drafts).toEqual({ "t-1": "meu rascunho" });
    expect(await axeViolations(container)).toEqual([]);
    routes.set("POST /cordis/creator", { body: { threadId: "t-1", enabled: false } });
    await userEvent.click(screen.getByRole("button", { name: "Turn creator mode off" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Let Nilo create a plugin" })).toBeTruthy());
  });

  it("with no active chat it creates one, selects it and carries the unsent draft of the new chat along", async () => {
    human();
    serve([], false);
    useThreadStore.setState({ activeThreadId: null, threads: [], messagesByThread: {} });
    useComposerDraftStore.setState({ drafts: { new: "antes de ligar" } });
    routes.set("POST /cordis/creator", { body: { threadId: "x", enabled: true } });
    render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Let Nilo create a plugin" }));
    await screen.findByText("Creator mode on in this conversation");
    const thread = useThreadStore.getState().threads[0];
    expect(thread.title).toBe("Create a plugin");
    expect(useThreadStore.getState().activeThreadId).toBe(thread.id);
    expect(calls.find((c) => c.method === "POST" && c.path === "/cordis/creator")?.body).toEqual({ thread_id: thread.id, enabled: true });
    expect(useComposerDraftStore.getState().drafts).toEqual({ [thread.id]: "antes de ligar" });
    expect(useThreadStore.getState().messagesByThread[thread.id]).toEqual([]);
  });

  it("Descobrir shows the unreviewed-list notice first, fixed to the top and with nothing to collapse it", async () => {
    human();
    serve([]);
    render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("radio", { name: "Discover" }));
    const text = "Unreviewed list: indexes are third-party; check the source before installing.";
    const notice = screen.getByText(text).closest("[data-discover-notice]") as HTMLElement;
    expect(notice.className).toMatch(/sticky/);
    expect(notice.className).toMatch(/top-0/);
    expect(notice.querySelector("button, [aria-expanded], details")).toBeNull();
    routes.set("POST /cordis/index/fetch", { body: pluginIndex });
    await userEvent.type(screen.getByLabelText("Index address (https)"), "https://example.com/index.json");
    await userEvent.click(screen.getByRole("button", { name: "Load index" }));
    await screen.findByRole("list", { name: "Plugins in the index" });
    expect(screen.getByText(text)).toBeTruthy();
  });

  it("Descobrir loads an index through the sidecar, shows text only, and Inspect opens the same review without the form", async () => {
    human();
    serve([]);
    serveFetch();
    routes.set("POST /cordis/index/fetch", { body: pluginIndex });
    const { container } = render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("radio", { name: "Discover" }));
    await userEvent.type(screen.getByLabelText("Index address (https)"), "https://example.com/index.json");
    await userEvent.click(screen.getByRole("button", { name: "Load index" }));
    const list = await screen.findByRole("list", { name: "Plugins in the index" });
    expect(within(list).getByText("<b>Keeps</b> notes.")).toBeTruthy(); // the description is text, never markup
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("1 entries were left out because they were not valid.")).toBeTruthy();
    expect(within(list).queryByRole("button", { name: /^Install/ })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(within(list).getByRole("button", { name: "Inspect git-thing" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a plugin" });
    expect(await within(dialog).findByText("Review before installing")).toBeTruthy();
    expect(within(dialog).queryByLabelText("Package name")).toBeNull();
    expect(calls.find((c) => c.path === "/cordis/plugins/fetch")?.body).toEqual({ kind: "github", spec: "bo/thing", commit: "c".repeat(40), subdir: "pkg", live: true });
    expect(calls.some((c) => c.path.endsWith("/install"))).toBe(false);
    expect((within(dialog).getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Inspect on a tarball entry starts the fetch with its integrity", async () => {
    human();
    serve([]);
    serveFetch();
    routes.set("POST /cordis/index/fetch", { body: pluginIndex });
    render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("radio", { name: "Discover" }));
    await userEvent.type(screen.getByLabelText("Index address (https)"), "https://example.com/index.json");
    await userEvent.click(screen.getByRole("button", { name: "Load index" }));
    await userEvent.click(await screen.findByRole("button", { name: "Inspect tar-thing" }));
    await screen.findByText("Review before installing");
    expect(calls.find((c) => c.path === "/cordis/plugins/fetch")?.body).toEqual({ kind: "tarball", spec: "https://example.com/tar-thing-2.0.0.tgz", integrity: "sha512-AAAA", live: true });
  });

  it("maps an index entry to the add-flow request", () => {
    expect(sourceOf(pluginIndex.plugins[0] as never)).toEqual({ kind: "npm", spec: "notes-tool", version: "1.2.0" });
    expect(sourceOf(pluginIndex.plugins[1] as never)).toEqual({ kind: "github", spec: "bo/thing", commit: "c".repeat(40), subdir: "pkg" });
    expect(sourceOf(pluginIndex.plugins[2] as never)).toEqual({ kind: "tarball", spec: "https://example.com/tar-thing-2.0.0.tgz", integrity: "sha512-AAAA" });
  });

  it("speaks Portuguese", async () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    serve();
    render(<PluginsScreen />);
    expect(await screen.findByRole("region", { name: "Pedidos do Nilo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deixar o Nilo criar um plugin" })).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Descobrir" }));
    expect(screen.getByText("Lista não revisada: os índices são de terceiros; confira a fonte antes de instalar.")).toBeTruthy();
  });
});
