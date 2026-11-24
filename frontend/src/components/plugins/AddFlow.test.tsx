import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { axeViolations } from "@/test/axe";
import { PluginsScreen } from "./PluginsScreen";
import { calls, FETCH_ID, niloRequest, plugin, preview, readyJob, routes, runningJob, serveFetch, useSidecarStub } from "./testKit";

const running = { state: "running", reason: null, restarts: 0, node: "22.20.0", hostLog: [], plugins: 0 };
const serve = (requests: unknown[] = []) => {
  routes.set("GET /cordis/status", { body: running });
  routes.set("GET /cordis/plugins", { body: { plugins: [] } });
  routes.set("GET /cordis/requests", { body: { requests } });
};
const openAdd = async () => {
  await userEvent.click((await screen.findAllByRole("button", { name: "Add plugin" }))[0]);
  const dialog = await screen.findByRole("dialog", { name: "Add a plugin" });
  await userEvent.type(within(dialog).getByLabelText("Package name"), "notes-tool");
  await userEvent.type(within(dialog).getByLabelText("Exact version"), "1.2.0");
  await userEvent.click(within(dialog).getByRole("button", { name: "Check package" }));
  return dialog;
};

describe("add flow: a decision for each script", () => {
  useSidecarStub();
  beforeEach(() => {
    window.__OH_HUMAN__ = "h-token";
    usePluginsStore.getState().reset();
  });
  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "en" });
  });

  it("shows one radio group per script and keeps Install off until each one is accepted", async () => {
    serve();
    serveFetch({ scripts: ["postinstall", "prepare"] });
    routes.set("POST /cordis/plugins/install", { body: plugin({ enabled: false, state: "disabled" }) });
    render(<PluginsScreen />);
    const dialog = await openAdd();
    const first = await within(dialog).findByRole("radiogroup", { name: "Decision for script postinstall" });
    const second = within(dialog).getByRole("radiogroup", { name: "Decision for script prepare" });
    expect(within(first).getAllByRole("radio").map((r) => r.getAttribute("aria-label") ?? (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(["Accept without running", "Do not install"]);
    expect(await axeViolations(dialog)).toEqual([]);
    const install = within(dialog).getByRole("button", { name: "Install" }) as HTMLButtonElement;
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "I read the warning and trust this plugin" }));
    expect(install.disabled).toBe(true);
    await userEvent.click(within(first).getByRole("radio", { name: "Accept without running" }));
    expect(install.disabled).toBe(true);
    await userEvent.click(within(second).getByRole("radio", { name: "Accept without running" }));
    expect(install.disabled).toBe(false);
    await userEvent.click(install);
    await within(dialog).findByText("notes-tool 1.2.0 installed");
    expect(calls.find((c) => c.path.endsWith("/install"))?.body).toMatchObject({ scripts: "do-not-run", scripts_accepted: ["postinstall", "prepare"] });
  });

  it("Do not install deletes the download, goes back to the form and says nothing was installed", async () => {
    serve();
    serveFetch();
    render(<PluginsScreen />);
    const dialog = await openAdd();
    const group = await within(dialog).findByRole("radiogroup", { name: "Decision for script postinstall" });
    await userEvent.click(within(group).getByRole("radio", { name: "Do not install" }));
    expect((within(dialog).getByRole("button", { name: "Install" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(within(dialog).getByRole("button", { name: "Do not install" }));
    expect(await within(dialog).findByText(/Nothing was installed/)).toBeTruthy();
    expect(within(dialog).getByLabelText("Package name")).toBeTruthy();
    expect(calls.some((c) => c.method === "DELETE" && c.path === `/cordis/plugins/fetch/${FETCH_ID}`)).toBe(true);
    expect(calls.some((c) => c.path.endsWith("/install"))).toBe(false);
  });

  it("a request from Nilo keeps Approve locked until its script is accepted; Do not install rejects it", async () => {
    const request = niloRequest({ preview: { ...niloRequest().preview, scripts: ["postinstall"] } });
    serve([request]);
    routes.set("POST /cordis/requests/1111222233334444/approve", { body: { request: niloRequest({ status: "approved" }), plugin: plugin({ name: "hello-tool" }) } });
    routes.set("POST /cordis/requests/1111222233334444/reject", { body: { request: niloRequest({ status: "rejected" }) } });
    render(<PluginsScreen />);
    const section = await screen.findByRole("region", { name: "Requests from Nilo" });
    await userEvent.click(within(section).getByRole("checkbox", { name: "I read the warning and trust this plugin" }));
    const approve = within(section).getByRole("button", { name: "Approve" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    await userEvent.click(within(section).getByRole("radio", { name: "Accept without running" }));
    expect(approve.disabled).toBe(false);
    await userEvent.click(within(section).getByRole("radio", { name: "Do not install" }));
    expect(approve.disabled).toBe(true);
    routes.set("GET /cordis/requests", { body: { requests: [] } });
    await userEvent.click(within(section).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/reject"))).toBe(true));
    expect(calls.some((c) => c.path.endsWith("/approve"))).toBe(false);
  });

  it("speaks Portuguese", async () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    serve();
    serveFetch();
    render(<PluginsScreen />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Adicionar plugin" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome do pacote"), "notes-tool");
    await userEvent.type(within(dialog).getByLabelText("Versão exata"), "1.2.0");
    await userEvent.click(within(dialog).getByRole("button", { name: "Verificar pacote" }));
    const group = await within(dialog).findByRole("radiogroup", { name: "Decisão para o script postinstall" });
    expect(within(group).getByRole("radio", { name: "Aceitar sem executar" })).toBeTruthy();
    expect(within(group).getByRole("radio", { name: "Não instalar" })).toBeTruthy();
  });
});

describe("add flow: live log and a real Cancel", () => {
  useSidecarStub();
  beforeEach(() => {
    window.__OH_HUMAN__ = "h-token";
    usePluginsStore.getState().reset();
  });
  afterEach(cleanup);

  it("shows the steps in a polite live log while it downloads, and Cancel deletes the download", async () => {
    serve();
    routes.set("POST /cordis/plugins/fetch", { body: runningJob() });
    routes.set(`GET /cordis/plugins/fetch/${FETCH_ID}`, { body: runningJob({ events: [{ step: "downloading", at: 1 }, { step: "verifying", at: 2 }] }) });
    routes.set(`DELETE /cordis/plugins/fetch/${FETCH_ID}`, { body: runningJob({ state: "cancelled" }) });
    render(<PluginsScreen />);
    const dialog = await openAdd();
    const log = await within(dialog).findByRole("log", { name: "Progress" });
    expect(log.getAttribute("aria-live")).toBe("polite");
    await waitFor(() => expect(within(log).getByText("Checking integrity")).toBeTruthy());
    expect(within(log).getByText("Downloading the package")).toBeTruthy();
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === `/cordis/plugins/fetch/${FETCH_ID}`)).toBe(true));
    expect(within(dialog).getByLabelText("Package name")).toBeTruthy();
  });

  it("keeps the log in the preview and after installing, with Installing and Done", async () => {
    serve();
    serveFetch({ scripts: [] });
    routes.set("POST /cordis/plugins/install", { body: plugin({ enabled: false, state: "disabled" }) });
    render(<PluginsScreen />);
    const dialog = await openAdd();
    const log = await within(dialog).findByRole("log", { name: "Progress" });
    expect(within(log).getByText("Review ready")).toBeTruthy();
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "I read the warning and trust this plugin" }));
    routes.set(`GET /cordis/plugins/fetch/${FETCH_ID}`, { body: { ...readyJob({ scripts: [] }), state: "installed", events: [...readyJob().events, { step: "installing", at: 7 }, { step: "done", at: 8 }] } });
    await userEvent.click(within(dialog).getByRole("button", { name: "Install" }));
    await within(dialog).findByText("notes-tool 1.2.0 installed");
    const after = within(dialog).getByRole("log", { name: "Progress" });
    expect(within(after).getByText("Installing")).toBeTruthy();
    expect(within(after).getByText("Done")).toBeTruthy();
  });

  it("a failed job returns to the form with the reason", async () => {
    serve();
    routes.set("POST /cordis/plugins/fetch", { body: runningJob() });
    routes.set(`GET /cordis/plugins/fetch/${FETCH_ID}`, { body: runningJob({ state: "failed", events: [{ step: "failed", at: 1 }], error: { code: "not_found", message: "No such package" } }) });
    render(<PluginsScreen />);
    const dialog = await openAdd();
    expect(await within(dialog).findByText(/No such package/)).toBeTruthy();
    expect(within(dialog).getByLabelText("Package name")).toBeTruthy();
    void preview;
  });
});
