import { describe, expect, it } from "vitest";
import { filterModelGroups, IDLE_CAP, QUERY_CAP, scoreModel, type ModelGroupInput } from "./modelSearch";

/* A synthetic stand-in for OpenRouter's GET /models: this sandbox cannot reach
   the real endpoint, so the list is built to the same shape (`vendor/model`,
   optional `:free`/`:beta` suffix, date-stamped variants) at a realistic size. */
function openRouterLike(): string[] {
  const vendors = ["anthropic", "openai", "google", "meta-llama", "mistralai", "deepseek", "qwen", "cohere", "x-ai", "nousresearch", "perplexity", "microsoft"];
  const families = ["chat", "instruct", "mini", "pro", "flash", "large", "small", "turbo", "vision", "coder", "reasoner", "lite"];
  const ids: string[] = [];
  for (const v of vendors) {
    for (const f of families) {
      for (const n of [1, 2, 3]) {
        ids.push(`${v}/${v.split("-")[0]}-${f}-${n}`);
        if (n === 2) ids.push(`${v}/${v.split("-")[0]}-${f}-${n}:free`);
      }
    }
  }
  ids.push("anthropic/claude-sonnet-4.5", "anthropic/claude-opus-4.1", "openai/gpt-4o", "openai/gpt-4o-mini", "openai/gpt-4o-mini-2024-07-18", "deepseek/deepseek-r1");
  return ids;
}

const groups = (): ModelGroupInput[] => [
  { connectionId: "ollama-local", label: "Ollama local", models: ["gemma4:26b", "llama3.2:latest", "qwen3:8b"] },
  { connectionId: "openrouter", label: "OpenRouter", models: openRouterLike() },
];

describe("model search over a connection with hundreds of ids", () => {
  it("the fixture is a real-sized list", () => {
    expect(groups()[1].models.length).toBeGreaterThan(400);
  });

  it("with no query every group shows a capped slice and says how many are hidden", () => {
    const [ollama, router] = filterModelGroups(groups(), "");
    expect(ollama).toMatchObject({ items: ["gemma4:26b", "llama3.2:latest", "qwen3:8b"], hidden: 0 });
    expect(router.items).toHaveLength(IDLE_CAP);
    expect(router.hidden).toBe(groups()[1].models.length - IDLE_CAP);
  });

  it("a known model is the first row after a few keystrokes, whatever the connection", () => {
    const top = (q: string) => filterModelGroups(groups(), q).flatMap((g) => g.items)[0];
    expect(top("gpt-4o")).toBe("openai/gpt-4o");
    expect(top("opus")).toBe("anthropic/claude-opus-4.1");
    expect(top("r1")).toBe("deepseek/deepseek-r1");
    expect(top("qwen3")).toBe("qwen3:8b");
  });

  it("each token must match, in any order", () => {
    const res = filterModelGroups(groups(), "mini openai");
    expect(res).toHaveLength(1);
    expect(res[0].items.every((id) => id.includes("openai") && id.includes("mini"))).toBe(true);
  });

  it("groups with no match disappear while typing, and the cap applies per group", () => {
    const res = filterModelGroups(groups(), "chat");
    expect(res.map((g) => g.connectionId)).toEqual(["openrouter"]);
    expect(res[0].items).toHaveLength(QUERY_CAP);
    expect(res[0].hidden).toBeGreaterThan(0);
  });

  it("filtering the whole list stays far below a frame budget", () => {
    const g = groups();
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) filterModelGroups(g, "gpt mini");
    expect((performance.now() - t0) / 50).toBeLessThan(5);
  });

  it("scores exact over prefix over word-start over substring", () => {
    expect(scoreModel("gpt-4o", "gpt-4o")).toBeGreaterThan(scoreModel("gpt-4o-mini", "gpt-4o"));
    expect(scoreModel("gpt-4o-mini", "mini")).toBeGreaterThan(scoreModel("xgpt-4ominix", "mini"));
    expect(scoreModel("anything", "zzz")).toBe(0);
  });
});
