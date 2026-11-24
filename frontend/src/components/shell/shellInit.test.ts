import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* public/shell-init.js runs before first paint, outside React: it must put the right `lang` on <html>
   (screen readers pick the voice from it before hydration) and the frame width the layout needs. */
const script = fs.readFileSync(path.resolve(__dirname, "../../../public/shell-init.js"), "utf8");
const run = () => new Function(script)();

const languages = (list: string[]) => vi.spyOn(window.navigator, "languages", "get").mockReturnValue(list);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = "";
  document.documentElement.style.removeProperty("--oh-side-w");
});
afterEach(() => vi.restoreAllMocks());

describe("shell-init.js", () => {
  it("wears the saved language before paint", () => {
    languages(["en-US"]);
    window.localStorage.setItem("oharness-locale", "pt-BR");
    run();
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("follows the browser when nothing is saved", () => {
    languages(["pt-PT", "en"]);
    run();
    expect(document.documentElement.lang).toBe("pt-BR");
  });

  it("falls back to English for any other language or a bad saved value", () => {
    languages(["de-DE"]);
    window.localStorage.setItem("oharness-locale", "klingon");
    run();
    expect(document.documentElement.lang).toBe("en");
  });

  it("sets the sidebar width from the saved frame", () => {
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
    window.localStorage.setItem("oh.shell.v9", JSON.stringify({ sidebar: "rail" }));
    run();
    expect(document.documentElement.style.getPropertyValue("--oh-side-w")).toBe("56px");
  });
});
