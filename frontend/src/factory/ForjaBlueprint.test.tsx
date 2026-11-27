import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { axeViolations } from "@/test/axe";
import { ForjaBlueprint } from "./ForjaBlueprint";

const HASH = "a".repeat(64);
const route = { from: "implement", to: "end", when: "has label stop", reason: "Done." };
const gate = { id: "ask", stage: "implement", prompt: "Which environment?", when: "has label docs" };

let posts: { path: string; body: Record<string, unknown> }[] = [];
const routes = new Map<string, unknown>();

beforeEach(() => {
  posts = [];
  routes.clear();
  routes.set("GET /factory/blueprint", { hash: HASH, blueprint: { entry: [{ to: "intake" }], routes: [route], gates: [gate] }, stages: {} });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (init.method === "POST") posts.push({ path: u.pathname, body });
    const answer = routes.get(`${init.method ?? "GET"} ${u.pathname}`);
    if (answer === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(typeof answer === "function" ? (answer as (b: Record<string, unknown>) => unknown)(body) : answer), { status: 200 });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useLocaleStore.setState({ locale: "en" });
});

async function load() {
  render(<ForjaBlueprint />);
  await userEvent.type(screen.getByLabelText("Forja"), "payments");
  await userEvent.click(screen.getByRole("button", { name: "Load" }));
  await screen.findByText(/Which environment\?/);
}

describe("the blueprint editor", () => {
  it("starts from the active blueprint and sends it back whole, with the version it loaded", async () => {
    routes.set("POST /factory/blueprint", (body: Record<string, unknown>) => (body.preview ? { status: "preview", removed: [], reasons: [] } : { status: "canary" }));
    await load();
    expect(screen.getByText(/has label stop/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText("Condition"), "has label docs");
    await userEvent.click(screen.getByRole("radio", { name: "Implement" }));
    await userEvent.click(screen.getByRole("button", { name: "Add entry" }));
    await userEvent.click(screen.getByRole("button", { name: "Save as a trial" }));
    await waitFor(() => expect(posts.filter((post) => !post.body.preview)).toHaveLength(1));
    const saved = posts.find((post) => !post.body.preview)!.body;
    expect(saved.base_hash).toBe(HASH);
    expect(saved.blueprint).toEqual({ entry: [{ when: "has label docs", to: "implement" }, { to: "intake" }], routes: [route], gates: [gate] });
    expect(await screen.findByText(/The trial has started/)).toBeTruthy();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("names what a save would remove and waits for the person to confirm", async () => {
    routes.set("POST /factory/blueprint", (body: Record<string, unknown>) =>
      body.preview ? { status: "preview", removed: [{ kind: "gates", rule: gate }], reasons: [] } : { status: "canary" });
    await load();
    await userEvent.click(screen.getByRole("button", { name: /remove gate/i }));
    await userEvent.click(screen.getByRole("button", { name: "Save as a trial" }));
    expect(await screen.findByText(/This save removes/)).toBeTruthy();
    expect(posts.filter((post) => !post.body.preview)).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Remove and save" }));
    await waitFor(() => expect(posts.filter((post) => !post.body.preview)).toHaveLength(1));
  });

  it("simulates the draft with example labels", async () => {
    routes.set("POST /factory/blueprint/simulate", { path: [{ stage: "intake", gate: null }, { stage: "end", reason: "Done." }] });
    await load();
    await userEvent.type(screen.getByLabelText("Labels on the example item"), "stop");
    await userEvent.click(screen.getByRole("button", { name: "Simulate" }));
    expect(await screen.findByText(/Intake → End/)).toBeTruthy();
    expect(posts.at(-1)?.body.facts).toEqual({ labels: ["stop"] });
  });

  it("does not offer to save before a blueprint is loaded, and refuses a malformed Forja name", async () => {
    render(<ForjaBlueprint />);
    expect(screen.queryByRole("button", { name: "Save as a trial" })).toBeNull();
    await userEvent.type(screen.getByLabelText("Forja"), "Bad Name");
    expect((screen.getByRole("button", { name: "Load" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
