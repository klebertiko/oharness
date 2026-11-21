import { describe, expect, it } from "vitest";
import { hrefFor, isAppPath, parsePath } from "./routes";

describe("routes", () => {
  it("parses and rebuilds every destination address", () => {
    expect(parsePath("/s/abc")).toEqual({ dest: "chats", sessionId: "abc" });
    expect(hrefFor({ dest: "chats", sessionId: "abc" })).toBe("/s/abc");
    expect(parsePath("/forja/item/item-1")).toEqual({ dest: "forja", itemId: "item-1" });
    expect(hrefFor({ dest: "forja", itemId: "item-1" })).toBe("/forja/item/item-1");
    expect(parsePath("/studio/daily")).toEqual({ dest: "studio", harness: "daily" });
    expect(hrefFor({ dest: "studio", harness: "daily" })).toBe("/studio/daily");
    expect(parsePath("/plugins")).toEqual({ dest: "plugins" });
    expect(parsePath("/settings/shortcuts")).toEqual({ dest: "settings", section: "shortcuts" });
    expect(hrefFor({ dest: "settings", section: "shortcuts" })).toBe("/settings/shortcuts");
    expect(parsePath("/settings/nope").section).toBe("general");
  });

  it("treats those paths as the app document", () => {
    expect(isAppPath("/s/abc")).toBe(true);
    expect(isAppPath("/dev/canvas")).toBe(false);
    expect(isAppPath("/_next/static/x.js")).toBe(false);
  });
});
