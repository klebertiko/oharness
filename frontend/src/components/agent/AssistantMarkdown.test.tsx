import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { axeViolations } from "@/test/axe";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { parseAssistantMarkdown, safeHref, type Inline, type MarkdownBlock } from "./safeMarkdown";

function hrefs(blocks: MarkdownBlock[]): string[] {
  const found: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const node of nodes) {
      if (node.type === "link") found.push(node.href);
      if (node.type === "link" || node.type === "strong" || node.type === "em") walk(node.children);
    }
  };
  for (const block of blocks) {
    if (block.type === "paragraph" || block.type === "heading") walk(block.children);
    if (block.type === "list") for (const item of block.items) walk(item);
  }
  return found;
}

function assertNoActiveHtml(container: HTMLElement) {
  expect(container.querySelector("script, iframe, img, object, embed, svg, math, form, style, video, audio, meta, base")).toBeNull();
  for (const el of container.querySelectorAll("*")) {
    for (const attr of el.attributes) {
      expect(attr.name.toLowerCase().startsWith("on")).toBe(false);
      if (attr.name === "href" || attr.name === "src") {
        const value = attr.value.trim().toLowerCase();
        expect(value.startsWith("javascript:")).toBe(false);
        expect(value.startsWith("data:")).toBe(false);
        expect(value.startsWith("vbscript:")).toBe(false);
        expect(value.startsWith("http://") || value.startsWith("https://")).toBe(true);
      }
    }
  }
}

describe("AssistantMarkdown structure", () => {
  it("renders fenced code with t-code inside a column of at most 68ch", () => {
    const { container } = render(<AssistantMarkdown text={"```ts\nconst n = 1;\n```"} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("max-w-[68ch]");
    expect(root.className).toContain("min-w-0");
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre!.className).toContain("t-code");
    expect(pre!.className).toContain("min-w-0");
    expect(pre!.className).toContain("max-w-full");
    expect(pre!.textContent).toBe("const n = 1;");
    expect(container.textContent).not.toContain("```");
  });

  it("renders lists, inline code, emphasis and a heading that is not an h1", () => {
    const { container } = render(<AssistantMarkdown text={"# Title\n\nUse `npm test` and **bold** and *em*.\n\n- one\n- two\n\n1. first\n2. second"} />);
    expect(container.querySelector("h1, h2, h3")).toBeNull();
    expect(container.querySelector("p.font-medium")?.textContent).toBe("Title");
    expect(container.querySelector("code.t-code")?.textContent).toBe("npm test");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("em");
    const lists = container.querySelectorAll("ul, ol");
    expect(lists[0].tagName).toBe("UL");
    expect(lists[0].textContent).toContain("one");
    expect(lists[0].textContent).toContain("two");
    expect(lists[1].tagName).toBe("OL");
    expect(lists[1].textContent).toContain("first");
  });

  it("keeps a single newline as a break and a blank line as a new paragraph", () => {
    const { container } = render(<AssistantMarkdown text={"Hello\nworld\n\nNext"} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(container.querySelector("br")).not.toBeNull();
    expect(container.textContent).toContain("Hello");
    expect(container.textContent).toContain("world");
    expect(container.textContent).toContain("Next");
  });

  it("does not italicize snake_case", () => {
    const { container } = render(<AssistantMarkdown text={"use snake_case here"} />);
    expect(container.querySelector("em")).toBeNull();
    expect(container.textContent).toContain("snake_case");
  });

  it("starts an ordered list at the number the reply used", () => {
    const { container } = render(<AssistantMarkdown text={"2. two\n3. three"} />);
    expect(container.querySelector("ol")?.getAttribute("start")).toBe("2");
  });
});

describe("AssistantMarkdown links", () => {
  it("gives an external link a safe rel and a new tab", () => {
    const { container } = render(<AssistantMarkdown text={"See [docs](https://example.com/docs?q=1&x=2)."} />);
    const link = container.querySelector("a");
    expect(link).not.toBeNull();
    expect(link!.getAttribute("href")).toBe("https://example.com/docs?q=1&x=2");
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link!.getAttribute("target")).toBe("_blank");
    expect(link!.textContent).toBe("docs");
    expect(link!.className).toContain("underline");
    expect(link!.tabIndex).not.toBe(-1);
  });

  it("normalizes the scheme and treats http the same way", () => {
    const { container } = render(<AssistantMarkdown text={"[docs](HTTP://Example.COM/a)"} />);
    const link = container.querySelector("a");
    expect(link!.getAttribute("href")).toBe("http://example.com/a");
    expect(link!.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders an autolink and turns an image into a link, never an img", () => {
    const { container } = render(<AssistantMarkdown text={"<https://example.com/auto> and ![plot](https://example.com/plot.png)"} />);
    expect(container.querySelector("img")).toBeNull();
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.getAttribute("rel") === "noopener noreferrer")).toBe(true);
    expect(links[1].textContent).toBe("plot");
  });
});

describe("AssistantMarkdown hostile input", () => {
  const blocked = [
    "[click](javascript:alert(1))",
    "[click](JaVaScRiPt:alert(1))",
    "[click]( javascript:alert(1))",
    "[click](data:text/html,hi)",
    "[click](vbscript:msgbox(1))",
    "[click](file:///example/secret)",
    "[click](//example.com)",
    "[click](/example/secret)",
    "![x](javascript:alert(1))",
    "[click](https://example.com\" onclick=\"alert(1))",
    "<script>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<a href=\"javascript:alert(1)\">x</a>",
    "<iframe src=\"https://example.com\"></iframe>",
  ];

  it.each(blocked)("does not activate %s", (source) => {
    const { container } = render(<AssistantMarkdown text={source} />);
    assertNoActiveHtml(container);
    expect(hrefs(parseAssistantMarkdown(source)).every((href) => href.startsWith("https://") || href.startsWith("http://"))).toBe(true);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent?.length).toBeGreaterThan(0);
  });

  it("keeps markup inside a code block as text", () => {
    const source = "```\n<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n```";
    const { container } = render(<AssistantMarkdown text={source} />);
    assertNoActiveHtml(container);
    const pre = container.querySelector("pre");
    expect(pre?.className).toContain("t-code");
    expect(pre?.textContent).toContain("<script>alert(1)</script>");
    expect(pre?.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.innerHTML.toLowerCase()).not.toContain("<script");
    expect(container.innerHTML.toLowerCase()).not.toContain("<img");
  });

  it("leaves an unfinished link and an unfinished code span as text", () => {
    const { container } = render(<AssistantMarkdown text={"See [docs](https://example.com and `const n"} />);
    expect(container.querySelector("a, code")).toBeNull();
    expect(container.textContent).toContain("[docs](https://example.com");
    expect(container.textContent).toContain("`const n");
  });

  it("renders an open fence as a code block so a live stream can show code", () => {
    const { container } = render(<AssistantMarkdown text={"```\nconst n = 1;"} />);
    const pre = container.querySelector("pre");
    expect(pre?.className).toContain("t-code");
    expect(pre?.textContent).toBe("const n = 1;");
  });

  it("rejects schemes that are not http or https", () => {
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("https://example.com/\u0000x")).toBeNull();
    expect(safeHref("https://example.com/\u2028x")).toBeNull();
    expect(safeHref("https://example.com/ok")).toBe("https://example.com/ok");
  });

  it("does not parse or write HTML in the renderer source", () => {
    const dir = path.resolve(__dirname);
    const sources = ["AssistantMarkdown.tsx", "safeMarkdown.ts"].map((name) => fs.readFileSync(path.join(dir, name), "utf8"));
    for (const source of sources) {
      expect(source).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML|document\.write|outerHTML/);
    }
  });
});

describe("AssistantMarkdown accessibility and weight", () => {
  it("has no axe violations on a reply with a link, lists and code", async () => {
    const text = [
      "Read [the notes](https://example.com/notes) and `inline`.",
      "",
      "- first",
      "- second",
      "",
      "1. one",
      "2. two",
      "",
      "```",
      "const n = 1;",
      "```",
    ].join("\n");
    const { container } = render(<AssistantMarkdown text={text} />);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("adds no markdown package to the frontend bundle", () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(names.some((name) => /markdown|remark|rehype|marked|micromark|mdast|dompurify|sanitize-html/i.test(name))).toBe(false);
  });
});
