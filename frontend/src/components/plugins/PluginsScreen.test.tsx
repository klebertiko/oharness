import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { usePluginsStore } from "@/store/pluginsStore";
import { axeViolations } from "@/test/axe";
import { PluginsScreen } from "./PluginsScreen";
import { calls, plugin, routes, serveFetch, useSidecarStub } from "./testKit";

const id = "0123456789abcdef";
const running = { state: "running", reason: null, restarts: 0, node: "22.20.0", hostLog: [], plugins: 1 };
const serve = (plugins = [plugin()], status: Record<string, unknown> = running) => {
  routes.set("GET /cordis/status", { body: status });
  routes.set("GET /cordis/plugins", { body: { plugins } });
};
const human = () => {
  window.__OH_HUMAN__ = "h-token";
};

describe("PluginsScreen", () => {
  useSidecarStub();
  beforeEach(() => usePluginsStore.getState().reset());
  afterEach(() => {
    cleanup();
    useLocaleStore.setState({ locale: "en" });
  });

  it("shows the host state, the isolation mode, the fixed safety notice and the plugins with state and capabilities", async () => {
    serve([plugin(), plugin({ id: "aaaaaaaaaaaaaaaa", name: "broken-one", state: "failed", message: "boom", capabilities: [], enabled: true })]);
    render(<PluginsScreen />);
    expect(screen.getByRole("status", { name: "Loading plugins" })).toBeTruthy();
    expect(await screen.findByText("notes-tool")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText(/own process, with limits on files, processes and environment/)).toBeTruthy();
    expect(screen.getByText(/protect the agent's actions, not the plugin's own code/)).toBeTruthy();
    const list = screen.getByRole("list", { name: "Plugins" });
    expect(list.children).toHaveLength(2);
    expect(within(list).getByText("Active")).toBeTruthy();
    expect(within(list).getByText("Failed")).toBeTruthy();
    expect(within(list).getByText("Files")).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("says why the host is unavailable instead of failing", async () => {
    serve([], { ...running, state: "unavailable", reason: "Node.js was not found; plugins are off." });
    render(<PluginsScreen />);
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    expect(screen.getByText(/Node\.js was not found/)).toBeTruthy();
  });

  it("teaches in the empty state and the action opens the add sheet", async () => {
    human();
    serve([]);
    render(<PluginsScreen />);
    expect(await screen.findByText("No plugins yet")).toBeTruthy();
    await userEvent.click(screen.getAllByRole("button", { name: "Add plugin" })[0]);
    expect(await screen.findByRole("dialog", { name: "Add a plugin" })).toBeTruthy();
  });

  it("explains what failed, why, and offers Try again", async () => {
    render(<PluginsScreen />);
    expect(await screen.findByText("The plugin list could not be loaded")).toBeTruthy();
    expect(screen.getByText(/Why:/)).toBeTruthy();
    serve();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("notes-tool")).toBeTruthy();
  });

  it("without the human credential says so and disables the changes", async () => {
    serve();
    render(<PluginsScreen />);
    await screen.findByText("notes-tool");
    expect(screen.getByText(/needs the app's own credential/)).toBeTruthy();
    expect((screen.getAllByRole("button", { name: "Add plugin" })[0] as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "notes-tool active" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("switches a plugin off with the credential and shows the new state", async () => {
    human();
    serve();
    render(<PluginsScreen />);
    const toggle = await screen.findByRole("switch", { name: "notes-tool active" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    routes.set(`POST /cordis/plugins/${id}/disable`, { body: plugin({ enabled: false, state: "disabled" }) });
    await userEvent.click(toggle);
    await waitFor(() => expect(screen.getByRole("switch", { name: "notes-tool active" }).getAttribute("aria-checked")).toBe("false"));
    expect(screen.getByText("Off")).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith("/disable"))?.headers["x-oharness-human"]).toBe("h-token");
  });

  it("removes only after confirming, where it was asked", async () => {
    human();
    serve();
    render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Details of notes-tool" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    routes.set(`DELETE /cordis/plugins/${id}`, { status: 204 });
    await userEvent.click(screen.getByRole("button", { name: "Remove plugin" }));
    await waitFor(() => expect(screen.queryByText("notes-tool")).toBeNull());
    expect(await screen.findByText("No plugins yet")).toBeTruthy();
  });

  it("shows logs of the selected plugin and refreshes them", async () => {
    human();
    serve();
    routes.set(`GET /cordis/plugins/${id}/logs`, { body: { lines: ["[plugin notes-tool] started"] } });
    render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Details of notes-tool" }));
    const log = () => screen.getByRole("textbox", { name: "Log lines of notes-tool" }) as HTMLTextAreaElement;
    await waitFor(() => expect(log().value).toBe("[plugin notes-tool] started"));
    routes.set(`GET /cordis/plugins/${id}/logs`, { body: { lines: ["[plugin notes-tool] started", "[plugin notes-tool] error: x"] } });
    await userEvent.click(screen.getByRole("button", { name: "Refresh logs" }));
    await waitFor(() => expect(log().value).toContain("[plugin notes-tool] error: x"));
  });

  it("the scrolling log of a plugin is reachable by keyboard and keeps its name", async () => {
    human();
    serve();
    routes.set(`GET /cordis/plugins/${id}/logs`, { body: { lines: ["[plugin notes-tool] started"] } });
    render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Details of notes-tool" }));
    const log = (await screen.findByRole("textbox", { name: "Log lines of notes-tool" })) as HTMLTextAreaElement;
    expect(log.readOnly).toBe(true);
    log.focus();
    expect(document.activeElement).toBe(log);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("explains a 403 human_only on logs and on export with the credential sentence", async () => {
    human();
    serve();
    routes.set(`GET /cordis/plugins/${id}/logs`, { status: 403, body: { detail: { code: "human_only", message: "no" } } });
    routes.set(`GET /cordis/plugins/${id}/export`, { status: 403, body: { detail: { code: "human_only", message: "no" } } });
    render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Details of notes-tool" }));
    const detail = screen.getByRole("region", { name: "notes-tool details" });
    await waitFor(() => expect(within(detail).getAllByText(/needs the app's own credential/).length).toBeGreaterThan(0));
    await userEvent.click(within(detail).getByRole("button", { name: "Download package (.tgz)" }));
    await waitFor(() => expect(within(detail).getAllByText(/needs the app's own credential/).length).toBe(2));
  });

  it("Export has the package, the index and the GitHub link, and nothing says Share or Publish", async () => {
    human();
    const link = `https://github.com/o/r/tree/${"a".repeat(40)}`;
    serve([plugin({ source: { kind: "github", spec: "o/r", commit: "a".repeat(40), subdir: "" }, shareLink: link })]);
    routes.set(`GET /cordis/plugins/${id}/logs`, { body: { lines: [] } });
    routes.set(`GET /cordis/plugins/${id}/export/index`, { raw: '{"format":1}', headers: { "content-disposition": 'attachment; filename="index.json"' } });
    const created = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const { container } = render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Details of notes-tool" }));
    const section = screen.getByRole("region", { name: "Export" });
    expect(within(section).getByText(/without running any code/)).toBeTruthy();
    expect(within(section).getByText(/must be replaced by the https address/)).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Download package (.tgz)" })).toBeTruthy();
    expect(within(section).getByRole("button", { name: "Copy GitHub link" })).toBeTruthy();
    expect(screen.queryByText(/^Share$/)).toBeNull();
    expect(screen.queryByRole("button", { name: /publish/i })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(within(section).getByRole("button", { name: "Download index (index.json)" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(calls.some((c) => c.path === `/cordis/plugins/${id}/export/index` && c.headers["x-oharness-human"] === "h-token")).toBe(true);
    expect(created).toHaveBeenCalled();
    click.mockRestore();
  });

  it("shows the four capabilities with their effect in the review and in the details", async () => {
    human();
    serve([plugin({ capabilities: ["files"] })]);
    serveFetch();
    routes.set(`GET /cordis/plugins/${id}/logs`, { body: { lines: [] } });
    render(<PluginsScreen />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Add plugin" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Package name"), "notes-tool");
    await userEvent.type(within(dialog).getByLabelText("Exact version"), "1.2.0");
    await userEvent.click(within(dialog).getByRole("button", { name: "Check package" }));
    const review = await within(dialog).findByRole("list", { name: "What each capability does" });
    expect(within(review).getAllByRole("listitem")).toHaveLength(4);
    expect(within(review).getAllByText("Asked for")).toHaveLength(1);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "I read the warning and trust this plugin" }));
    expect(within(review).getAllByText("Accepted")).toHaveLength(1);
    expect(within(review).getByText("Declared only")).toBeTruthy();
    expect(await axeViolations(dialog)).toEqual([]);
    await userEvent.click(within(dialog).getByRole("button", { name: "Back" }));
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await userEvent.click(await screen.findByRole("button", { name: "Details of notes-tool" }));
    const detail = screen.getByRole("region", { name: "notes-tool details" });
    const rows = within(within(detail).getByRole("list", { name: "What each capability does" })).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("Accepted")).toBeTruthy();
    expect(within(rows[3]).getByText("Blocked")).toBeTruthy();
  });

  it("downloads the package and copies the GitHub link", async () => {
    human();
    const link = "https://github.com/o/r/tree/" + "a".repeat(40);
    serve([plugin({ source: { kind: "github", spec: "o/r", commit: "a".repeat(40), subdir: "" }, shareLink: link })]);
    routes.set(`GET /cordis/plugins/${id}/logs`, { body: { lines: [] } });
    routes.set(`GET /cordis/plugins/${id}/export`, { raw: "tgz", headers: { "content-disposition": 'attachment; filename="notes-tool-1.2.0.tgz"' } });
    const created = vi.fn(() => "blob:x");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<PluginsScreen />);
    await userEvent.click(await screen.findByRole("button", { name: "Details of notes-tool" }));
    await userEvent.click(screen.getByRole("button", { name: "Download package (.tgz)" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(created).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Copy GitHub link" }));
    expect(writeText).toHaveBeenCalledWith(link);
    expect(await screen.findByText("Link copied")).toBeTruthy();
    click.mockRestore();
  });

  it("adds a plugin: validates, previews, gates install on the confirmation, installs, then offers Activate now", async () => {
    human();
    serve([]);
    serveFetch();
    routes.set("POST /cordis/plugins/install", { body: plugin({ enabled: false, state: "disabled" }) });
    render(<PluginsScreen />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Add plugin" }))[0]);
    const dialog = await screen.findByRole("dialog", { name: "Add a plugin" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Check package" }));
    expect(within(dialog).getByText("Enter the package name.")).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText("Package name"), "notes-tool");
    await userEvent.type(within(dialog).getByLabelText("Exact version"), "1.2.0");
    await userEvent.click(within(dialog).getByRole("button", { name: "Check package" }));
    expect(await within(dialog).findByText("Review before installing")).toBeTruthy();
    expect(within(dialog).getByText("Host warning in English.")).toBeTruthy();
    expect(within(dialog).getByText(/Reads and writes any file you can reach/)).toBeTruthy();
    expect(within(dialog).getAllByText(/the network is not limited/).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("radiogroup", { name: "Decision for script postinstall" })).toBeTruthy();
    const install = within(dialog).getByRole("button", { name: "Install" }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    await userEvent.click(within(dialog).getByRole("checkbox", { name: "I read the warning and trust this plugin" }));
    expect(install.disabled).toBe(true);
    await userEvent.click(within(dialog).getByRole("radio", { name: "Accept without running" }));
    expect(install.disabled).toBe(false);
    await userEvent.click(install);
    expect(await within(dialog).findByText("notes-tool 1.2.0 installed")).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith("/install"))?.body).toMatchObject({ accept: true, digest: "d".repeat(64), scripts: "do-not-run", scripts_accepted: ["postinstall"] });
    routes.set(`POST /cordis/plugins/${id}/enable`, { body: plugin() });
    await userEvent.click(within(dialog).getByRole("button", { name: "Activate now" }));
    await waitFor(() => expect(calls.some((c) => c.path.endsWith("/enable"))).toBe(true));
  });

  it("builds the GitHub request with the 40-hex commit and the optional folder", async () => {
    human();
    serve([]);
    serveFetch();
    render(<PluginsScreen />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Add plugin" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("radio", { name: "GitHub" }));
    await userEvent.type(within(dialog).getByLabelText("Repository (owner/repo)"), "o/r");
    await userEvent.type(within(dialog).getByLabelText("Commit (40 hex characters)"), "abc");
    await userEvent.click(within(dialog).getByRole("button", { name: "Check package" }));
    expect(within(dialog).getByText("Enter the full 40-character commit.")).toBeTruthy();
    await userEvent.clear(within(dialog).getByLabelText("Commit (40 hex characters)"));
    await userEvent.type(within(dialog).getByLabelText("Commit (40 hex characters)"), "b".repeat(40));
    await userEvent.type(within(dialog).getByLabelText("Folder inside the repository (optional)"), "packages/x");
    await userEvent.click(within(dialog).getByRole("button", { name: "Check package" }));
    await within(dialog).findByText("Review before installing");
    expect(calls.find((c) => c.path.endsWith("/fetch"))?.body).toEqual({ kind: "github", spec: "o/r", commit: "b".repeat(40), subdir: "packages/x", live: true });
  });

  it("explains a 403 human_only on install and keeps the preview", async () => {
    human();
    serve([]);
    serveFetch({ scripts: [] });
    routes.set("POST /cordis/plugins/install", { status: 403, body: { detail: { code: "human_only", message: "no" } } });
    render(<PluginsScreen />);
    await userEvent.click((await screen.findAllByRole("button", { name: "Add plugin" }))[0]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Package name"), "notes-tool");
    await userEvent.type(within(dialog).getByLabelText("Exact version"), "1.2.0");
    await userEvent.click(within(dialog).getByRole("button", { name: "Check package" }));
    await userEvent.click(await within(dialog).findByRole("checkbox"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Install" }));
    expect(await within(dialog).findByText(/needs the app's own credential/)).toBeTruthy();
    expect(within(dialog).getByText("Review before installing")).toBeTruthy();
    expect(calls.find((c) => c.path.endsWith("/install"))?.body).not.toHaveProperty("scripts");
  });

  it("shows the host warning in the current language and the screen in Portuguese", async () => {
    human();
    useLocaleStore.setState({ locale: "pt-BR" });
    serve([]);
    serveFetch();
    render(<PluginsScreen />);
    expect(await screen.findByText("Nenhum plugin ainda")).toBeTruthy();
    expect(screen.getAllByText(/Instale só o que você confia/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getAllByRole("button", { name: "Adicionar plugin" })[0]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome do pacote"), "notes-tool");
    await userEvent.type(within(dialog).getByLabelText("Versão exata"), "1.2.0");
    await userEvent.click(within(dialog).getByRole("button", { name: "Verificar pacote" }));
    expect(await within(dialog).findByText("Aviso do host em portugues.")).toBeTruthy();
    expect(within(dialog).getByRole("checkbox", { name: "Li o aviso e confio neste plugin" })).toBeTruthy();
  });
});
