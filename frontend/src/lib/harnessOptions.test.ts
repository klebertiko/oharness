import { describe, expect, it } from "vitest";
import { RECENT_FROM, SEARCH_FROM, buildHarnessOptions } from "./harnessOptions";

const entry = (id: string, over: Partial<{ name: string; isDefault: boolean; description: string }> = {}) => ({
  id,
  name: over.name ?? id,
  isDefault: over.isDefault ?? false,
  description: over.description,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => entry(`h${i}`, { name: `Harness ${i}` }));
const build = (over: Partial<Parameters<typeof buildHarnessOptions>[0]> = {}) =>
  buildHarnessOptions({ entries: [], status: { state: "none" }, recent: [], studioActive: null, ...over });

describe("buildHarnessOptions", () => {
  it("always starts with No harness, in words a non-expert understands", () => {
    const { options } = build();
    expect(options[0]).toMatchObject({ id: "", label: "No harness", detail: "Talk to the model directly" });
  });

  it("groups bundled and your own harnesses under plain headings, yours first", () => {
    const { options } = build({ entries: [entry("agile", { name: "Agile Harness", isDefault: true, description: "Delivery loop. More detail." }), entry("mine", { name: "Mine" })] });
    expect(options.map((o) => [o.label, o.group])).toEqual([
      ["No harness", undefined],
      ["Mine", "Your harnesses"],
      ["Agile Harness", "Bundled harnesses"],
    ]);
    expect(options[2].detail).toBe("Delivery loop.");
  });

  it("describes a harness by purpose, never by provider or model", () => {
    const { options } = build({ entries: [entry("a", { description: "Writes briefs." }), entry("b", { isDefault: true })] });
    const text = options.map((o) => `${o.label} ${o.detail ?? ""}`).join(" ");
    expect(text).not.toMatch(/provider|model(?!\b.*directly)|connection|api key/i);
    expect(options[2].detail).toBe("Bundled harness");
  });

  it("shows the filter only from the threshold, counting No harness", () => {
    expect(build({ entries: many(SEARCH_FROM - 2) }).searchable).toBe(false);
    expect(build({ entries: many(SEARCH_FROM - 1) }).searchable).toBe(true);
  });

  it("surfaces recents only when the list is long enough to need them, moving them out of their group", () => {
    const short = build({ entries: many(RECENT_FROM - 1), recent: ["h1"] });
    expect(short.options.some((o) => o.group === "Recent")).toBe(false);
    const long = build({ entries: many(RECENT_FROM), recent: ["h4", "gone", "h2", "h1", "h0"] });
    expect(long.options.filter((o) => o.group === "Recent").map((o) => o.id)).toEqual(["h4", "h2", "h1"]);
    expect(long.options.filter((o) => o.id === "h4")).toHaveLength(1);
  });

  it("keeps a harness that is gone visible, disabled and explained, instead of swapping it", () => {
    const { options } = build({ status: { state: "missing", id: "x", name: "Old (src)" }, entries: many(1) });
    expect(options[1]).toMatchObject({ id: "x", label: "Old", detail: "No longer available", disabled: true, group: "Unavailable" });
  });

  it("lists a harness put in use from Studio even though it is not in the library", () => {
    const { options } = build({ studioActive: { id: "s", name: "From my canvas" }, entries: many(1) });
    expect(options.find((o) => o.id === "s")).toMatchObject({ group: "Your harnesses", detail: "From Studio" });
  });
});
