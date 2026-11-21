import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { axeViolations } from "@/test/axe";
import { sourceOf } from "./DiscoverTab";
import { PluginsScreen } from "./PluginsScreen";
import { calls, niloRequest, plugin, pluginIndex, routes, useSidecarStub } from "./testKit";

const running = { state: "running", reason: null, restarts: 0, node: "22.20.0", hostLog: [], plugins: 0 };
const serve = (requests: unknown[] = [niloRequest()], creator = false) => {
  routes.set("GET /cordis/status", { body: running });
  routes.set("GET /cordis/plugins", { body: { plugins: [] } });
  routes.set("GET /cordis/requests", { body: { requests } });
  routes.set("GET /cordis/creator", { body: { enabled: creator } });
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

  it("Let Nilo create a plugin turns creator mode on and hands a draft without sending anything", async () => {
    human();
    serve([], false);
    routes.set("POST /cordis/creator", { body: { enabled: true } });
    const { container } = render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Let Nilo create a plugin" }));
    expect(await screen.findByText(/Creator mode is on/)).toBeTruthy();
    expect(calls.find((c) => c.method === "POST" && c.path === "/cordis/creator")?.body).toEqual({ enabled: true });
    const draft = screen.getByLabelText("Draft for the chat") as HTMLTextAreaElement;
    expect(draft.readOnly).toBe(true);
    expect(draft.value).toMatch(/cordis_plugins/);
    expect(screen.getByRole("link", { name: "Open the chat" }).getAttribute("href")).toBe("/");
    expect(calls.filter((c) => c.path.startsWith("/execute"))).toEqual([]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("Descobrir loads an index through the sidecar, shows text only, and Install fills the add flow", async () => {
    human();
    serve([]);
    routes.set("POST /cordis/index/fetch", { body: pluginIndex });
    const { container } = render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("radio", { name: "Discover" }));
    expect(screen.getByText("Indexes are third-party; check the source before installing.")).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Index address (https)"), "https://example.com/index.json");
    await userEvent.click(screen.getByRole("button", { name: "Load index" }));
    const list = await screen.findByRole("list", { name: "Plugins in the index" });
    expect(within(list).getByText("<b>Keeps</b> notes.")).toBeTruthy(); // the description is text, never markup
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("1 entries were left out because they were not valid.")).toBeTruthy();
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(within(list).getByRole("button", { name: "Install git-thing" }));
    const dialog = await screen.findByRole("dialog", { name: "Add a plugin" });
    expect((within(dialog).getByLabelText("Repository (owner/repo)") as HTMLInputElement).value).toBe("bo/thing");
    expect((within(dialog).getByLabelText(/Commit/) as HTMLInputElement).value).toBe("c".repeat(40));
  });

  it("maps an index entry to the add-flow request", () => {
    expect(sourceOf(pluginIndex.plugins[0] as never)).toEqual({ kind: "npm", spec: "notes-tool", version: "1.2.0" });
    expect(sourceOf(pluginIndex.plugins[1] as never)).toEqual({ kind: "github", spec: "bo/thing", commit: "c".repeat(40), subdir: "pkg" });
  });

  it("speaks Portuguese", async () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    serve();
    render(<PluginsScreen />);
    expect(await screen.findByRole("region", { name: "Pedidos do Nilo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Deixar o Nilo criar um plugin" })).toBeTruthy();
    await userEvent.click(screen.getByRole("radio", { name: "Descobrir" }));
    expect(screen.getByText("Índices são de terceiros; confira a fonte antes de instalar.")).toBeTruthy();
  });
});
