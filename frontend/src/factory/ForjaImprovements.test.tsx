import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocaleStore } from "@/i18n/store";
import { axeViolations } from "@/test/axe";
import { ForjaImprovements } from "./ForjaImprovements";

const proposal = (over: Record<string, unknown> = {}) => ({
  id: "p1", factory_id: "payments", status: "pending", justification: "Ask sooner", target: "definition", failure_ids: ["f1"],
  reasons: [], verdict: null, estimated_tokens: 120, diff: [{ path: "agents.builder.instructions", op: "changed" }],
  created_at: "2026-11-01T10:00:00Z", ...over,
});

let calls: { method: string; path: string }[] = [];
const routes = new Map<string, unknown>();

beforeEach(() => {
  calls = [];
  routes.clear();
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname + u.search });
    const key = `${init.method ?? "GET"} ${u.pathname}`;
    const body = routes.get(key);
    if (body === undefined) return new Response("{}", { status: 404 });
    return new Response(JSON.stringify(typeof body === "function" ? (body as (u: URL) => unknown)(u) : body), { status: 200 });
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useLocaleStore.setState({ locale: "en" });
});

const listing = (proposals: unknown[], extra: Record<string, unknown> = {}) =>
  routes.set("GET /factory/improvements", { proposals, failures: [], events: [], next: null, ...extra });

const noRawKeys = () => expect(document.body.textContent ?? "").not.toMatch(/forja\.improve\./);

describe("the improvements screen", () => {
  it("shows a reason, a status or a check it has no words for without breaking", async () => {
    listing([proposal({ status: "something_new", reasons: [{ code: "brand_new_rule", path: "policy.x", message: "Plain words from the server." }] })], {
      failures: [{ id: "f1", agent_id: "builder", stage: "implement", reason: "label-from-a-scorer", run_id: "run-9", superseded: true, at: null }],
    });
    render(<ForjaImprovements />);
    await userEvent.click(await screen.findByRole("radio", { name: "History" }));
    expect(await screen.findByText(/Plain words from the server\./)).toBeTruthy();
    noRawKeys();
    await userEvent.click(screen.getByRole("radio", { name: "Scorers" }));
    expect(await screen.findByText("Below the pass line")).toBeTruthy();
    expect(screen.getByText("Scored again")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /score/i })).toBeNull();
    noRawKeys();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("names a known check and a refusal in words", async () => {
    listing([proposal({ status: "rejected", reasons: [{ code: "protected_field", path: "runners.local", message: "x" }, { code: "protected_field", path: "mcp.shell", message: "x" }] })], {
      failures: [{ id: "f2", agent_id: "builder", stage: "review", reason: "qa_rejected", run_id: "run-1", superseded: false, at: null }],
    });
    render(<ForjaImprovements />);
    expect((await screen.findAllByText(/Only a person changes this field/)).length).toBe(2);
    await userEvent.click(screen.getByRole("radio", { name: "Scorers" }));
    expect(await screen.findByText("QA sent it back")).toBeTruthy();
  });

  it("shows the diff, the cost and the trail, and a trial can be measured, promoted or reverted", async () => {
    listing([proposal({ status: "canary", verdict: "improved" })], {
      events: [{ id: 1, type: "proposed", at: null, proposal_id: "p1", actor: { kind: "human", id: "local-user" } },
               { id: 2, type: "canary_started", at: null, proposal_id: "p1", actor: { kind: "human", id: "local-user" } }],
    });
    routes.set("POST /factory/improvements/p1/measure", { verdict: "improved" });
    routes.set("POST /factory/improvements/p1/promoted", proposal({ status: "promoted" }));
    routes.set("POST /factory/improvements/p1/revert", proposal({ status: "rolled_back" }));
    render(<ForjaImprovements />);
    await userEvent.click(await screen.findByRole("radio", { name: "In trial" }));
    const card = (await screen.findByText("Ask sooner")).closest("li") as HTMLElement;
    expect(within(card).getByText(/about 120 tokens/)).toBeTruthy();
    expect(within(card).getByText("1 change")).toBeTruthy();
    expect(within(card).getByText("2 events in the trail")).toBeTruthy();
    expect(within(card).getByText(/Trial started/)).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "Measure now" }));
    await userEvent.click(within(card).getByRole("button", { name: "Promote" }));
    await userEvent.click(within(card).getByRole("button", { name: "Revert" }));
    await waitFor(() => expect(calls.filter((c) => c.method === "POST").map((c) => c.path)).toEqual([
      "/factory/improvements/p1/measure", "/factory/improvements/p1/promoted", "/factory/improvements/p1/revert",
    ]));
    noRawKeys();
  });

  it("does not offer promotion before the trial measured as improved", async () => {
    listing([proposal({ status: "canary", verdict: null })]);
    render(<ForjaImprovements />);
    await userEvent.click(await screen.findByRole("radio", { name: "In trial" }));
    await screen.findByText("Ask sooner");
    expect(screen.queryByRole("button", { name: "Promote" })).toBeNull();
    expect(screen.getByRole("button", { name: "Revert" })).toBeTruthy();
  });

  it("exports every page of the trail", async () => {
    listing([proposal()]);
    routes.set("GET /factory/improvements/export", (u: URL) =>
      u.searchParams.get("after_id") ? { events: [{ id: 2, type: "approved", at: null, proposal_id: "p1" }], next: null }
        : { events: [{ id: 1, type: "proposed", at: null, proposal_id: "p1" }], next: 1 });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
    render(<ForjaImprovements />);
    await userEvent.click(await screen.findByRole("button", { name: "Export the trail" }));
    await waitFor(() => expect(calls.filter((c) => c.path.startsWith("/factory/improvements/export")).map((c) => c.path)).toEqual([
      "/factory/improvements/export", "/factory/improvements/export?after_id=1",
    ]));
  });

  it("refuses a Forja name that is not an id before asking the server", async () => {
    listing([]);
    render(<ForjaImprovements />);
    await userEvent.type(await screen.findByLabelText("Forja"), "Bad Name");
    expect(await screen.findByText(/lowercase letters/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Run now" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("is in Portuguese when the language is, plurals included", async () => {
    useLocaleStore.setState({ locale: "pt-BR" });
    listing([proposal({ failure_ids: ["a", "b"] })]);
    render(<ForjaImprovements />);
    expect(await screen.findByText(/2 regressões tratadas/)).toBeTruthy();
    noRawKeys();
  });
});
