/**
 * Safe subset of markdown for an assistant reply (issue #299).
 *
 * Model text is untrusted. This parser returns data; the component turns that
 * data into React elements. It never produces HTML. A link is kept only when
 * the URL's scheme is http or https after WHATWG parsing. Anything else
 * (including raw tags) stays text.
 */

export type Inline =
  | { type: "text"; text: string }
  | { type: "break" }
  | { type: "code"; text: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "link"; href: string; children: Inline[] };

export type MarkdownBlock =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "list"; ordered: boolean; start: number; items: Inline[][] };

const LIST_RE = /^( {0,3})(?:([-*+])|(\d{1,9})[.)])\s+(\S.*)$/;
const FENCE_RE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})\s*$/;
const HEADING_RE = /^ {0,3}#{1,6}\s+(\S.*)$/;
const ESCAPABLE = /[\\`*_{}[\]()#+\-.!]/;
const WORD = /[A-Za-z0-9]/;
const LABEL_MAX = 1000;
const DEST_MAX = 2048;
const EMPHASIS_MAX = 2000;
const DEPTH_MAX = 6;

/** Spaces, quotes, angles, backslash, and controls that can break out of a URL. */
function hasUnsafeUrlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) return true;
    const ch = value[i];
    if (ch === '"' || ch === "'" || ch === "<" || ch === ">" || ch === "\\") return true;
  }
  return false;
}

/** http(s) only, normalized by the URL parser. Rejects spaces, quotes, and other schemes. */
export function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > DEST_MAX) return null;
  if (hasUnsafeUrlChar(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!/^https?:\/\//.test(url.href)) return null;
  if (hasUnsafeUrlChar(url.href)) return null;
  return url.href;
}

function isFence(line: string): boolean {
  const match = FENCE_RE.exec(line);
  if (!match) return false;
  return !(match[2][0] === "`" && match[3].includes("`"));
}

function isHeading(line: string): boolean {
  return HEADING_RE.test(line);
}

function listMatch(line: string): { ordered: boolean; number: number; text: string } | null {
  const match = LIST_RE.exec(line);
  if (!match) return null;
  return {
    ordered: match[3] !== undefined,
    number: match[3] !== undefined ? Number(match[3]) : 1,
    text: match[4],
  };
}

function isBlockStart(line: string): boolean {
  return isFence(line) || isHeading(line) || listMatch(line) !== null;
}

function headingText(line: string): string | null {
  const match = HEADING_RE.exec(line);
  if (!match) return null;
  const text = match[1].replace(/\s+#+\s*$/, "").trim();
  return text.length > 0 ? text : null;
}

function joinLines(lines: string[]): Inline[] {
  const out: Inline[] = [];
  lines.forEach((line, index) => {
    if (index > 0) out.push({ type: "break" });
    out.push(...parseInlines(line));
  });
  return out;
}

interface ReadLink { label: string; dest: string; end: number }

function readLink(input: string, start: number): ReadLink | null {
  if (input[start] !== "[") return null;
  let i = start + 1;
  const labelStart = i;
  const labelLimit = Math.min(input.length, start + 1 + LABEL_MAX);
  let depth = 1;
  while (i < labelLimit && depth > 0) {
    if (input[i] === "\\") {
      i += 2;
      continue;
    }
    if (input[i] === "[") depth += 1;
    else if (input[i] === "]") depth -= 1;
    if (depth > 0) i += 1;
  }
  if (depth !== 0 || input[i] !== "]") return null;
  const label = input.slice(labelStart, i);
  i += 1;
  if (input[i] !== "(") return null;
  i += 1;

  if (input[i] === "<") {
    const close = input.indexOf(">", i + 1);
    if (close === -1 || close - i > DEST_MAX || input[close + 1] !== ")") return null;
    return { label, dest: input.slice(i + 1, close), end: close + 2 };
  }

  const destStart = i;
  const destLimit = Math.min(input.length, i + DEST_MAX);
  let paren = 0;
  while (i < destLimit) {
    const ch = input[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "(") paren += 1;
    else if (ch === ")") {
      if (paren === 0) break;
      paren -= 1;
    } else if (ch === " " || ch === "\n" || ch === "\t" || ch === '"' || ch === "'") break;
    i += 1;
  }
  if (i >= input.length || (i === destStart && input[i] !== ")")) return null;
  const dest = input.slice(destStart, i);
  if (input[i] === ")") return { label, dest, end: i + 1 };
  if (input[i] !== " " && input[i] !== "\t") return null;
  while (input[i] === " " || input[i] === "\t") i += 1;
  const quote = input[i];
  if (quote !== '"' && quote !== "'") return null;
  const titleEnd = input.indexOf(quote, i + 1);
  if (titleEnd === -1 || titleEnd - i > LABEL_MAX || input[titleEnd + 1] !== ")") return null;
  return { label, dest, end: titleEnd + 2 };
}

function linkNode(label: string, href: string, depth: number): Inline {
  const children = parseInlines(label, depth + 1);
  return { type: "link", href, children: children.length > 0 ? children : [{ type: "text", text: href }] };
}

function matchEmphasis(input: string, i: number, marker: string, len: number, depth: number): { node: Inline; end: number } | null {
  if (depth > DEPTH_MAX) return null;
  const after = input[i + len];
  if (after === undefined || /\s/.test(after)) return null;
  if (marker === "_" && i > 0 && WORD.test(input[i - 1])) return null;
  const from = i + len;
  const limit = Math.min(input.length, from + EMPHASIS_MAX);
  for (let j = from; j < limit; j += 1) {
    if (input[j] === "\\") {
      j += 1;
      continue;
    }
    if (input[j] !== marker) continue;
    let run = 0;
    while (input[j + run] === marker) run += 1;
    if (run !== len) {
      j += run - 1;
      continue;
    }
    const before = input[j - 1];
    if (before === undefined || /\s/.test(before)) {
      j += run - 1;
      continue;
    }
    const next = input[j + run];
    if (marker === "_" && next !== undefined && WORD.test(next)) {
      j += run - 1;
      continue;
    }
    const inner = input.slice(from, j);
    if (!inner) return null;
    const children = parseInlines(inner, depth + 1);
    return { node: { type: len === 2 ? "strong" : "em", children }, end: j + run };
  }
  return null;
}

function parseInlines(input: string, depth = 0): Inline[] {
  if (!input) return [];
  if (depth > DEPTH_MAX) return [{ type: "text", text: input }];
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ type: "text", text: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === "\\" && input[i + 1] && ESCAPABLE.test(input[i + 1])) {
      buf += input[i + 1];
      i += 2;
      continue;
    }
    if (ch === "`") {
      let len = 0;
      while (input[i + len] === "`") len += 1;
      const closer = input.indexOf("`".repeat(len), i + len);
      if (closer !== -1 && input[closer + len] !== "`") {
        flush();
        let code = input.slice(i + len, closer);
        if (code.startsWith(" ") && code.endsWith(" ") && code.trim().length > 0) code = code.slice(1, -1);
        out.push({ type: "code", text: code });
        i = closer + len;
        continue;
      }
      buf += "`".repeat(len);
      i += len;
      continue;
    }
    if (ch === "<" && /^https?:\/\//i.test(input.slice(i + 1, i + 10))) {
      const end = input.indexOf(">", i + 1);
      if (end !== -1 && end - i <= DEST_MAX) {
        const href = safeHref(input.slice(i + 1, end));
        if (href) {
          flush();
          out.push({ type: "link", href, children: [{ type: "text", text: href }] });
          i = end + 1;
          continue;
        }
      }
    }
    if (ch === "!" && input[i + 1] === "[") {
      const link = readLink(input, i + 1);
      if (link) {
        const href = safeHref(link.dest);
        if (href) {
          flush();
          out.push(linkNode(link.label, href, depth));
          i = link.end;
          continue;
        }
      }
    }
    if (ch === "[") {
      const link = readLink(input, i);
      if (link) {
        const href = safeHref(link.dest);
        if (href) {
          flush();
          out.push(linkNode(link.label, href, depth));
          i = link.end;
          continue;
        }
      }
    }
    if (ch === "*" || ch === "_") {
      let run = 0;
      while (input[i + run] === ch) run += 1;
      if (run < 3) {
        const emph = matchEmphasis(input, i, ch, run, depth);
        if (emph) {
          flush();
          out.push(emph.node);
          i = emph.end;
          continue;
        }
      }
      buf += ch.repeat(run);
      i += run;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

function parseFence(lines: string[], start: number): { block: MarkdownBlock; next: number } | null {
  const open = FENCE_RE.exec(lines[start]);
  if (!open || (open[2][0] === "`" && open[3].includes("`"))) return null;
  const marker = open[2][0];
  const min = open[2].length;
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length) {
    const close = FENCE_CLOSE_RE.exec(lines[i]);
    if (close && close[1][0] === marker && close[1].length >= min) {
      i += 1;
      break;
    }
    body.push(lines[i]);
    i += 1;
  }
  return { block: { type: "code", text: body.join("\n") }, next: i };
}

function parseList(lines: string[], start: number): { block: MarkdownBlock; next: number } | null {
  const first = listMatch(lines[start]);
  if (!first) return null;
  const items: Inline[][] = [];
  let i = start;
  let startNum = first.number;
  while (i < lines.length) {
    const item = listMatch(lines[i]);
    if (!item || item.ordered !== first.ordered) break;
    if (items.length === 0) startNum = item.number;
    const parts = [item.text];
    i += 1;
    while (i < lines.length && /^ {2,}\S/.test(lines[i]) && !isBlockStart(lines[i])) {
      parts.push(lines[i].replace(/^ +/, ""));
      i += 1;
    }
    items.push(joinLines(parts));
  }
  return { block: { type: "list", ordered: first.ordered, start: startNum, items }, next: i };
}

/** Parse an assistant reply. An unclosed fence (a stream still in progress) is a code block. */
export function parseAssistantMarkdown(source: string): MarkdownBlock[] {
  if (!source || !source.trim()) return [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim() === "") {
      i += 1;
      continue;
    }
    if (isFence(lines[i])) {
      const fence = parseFence(lines, i);
      if (!fence) {
        i += 1;
        continue;
      }
      blocks.push(fence.block);
      i = fence.next;
      continue;
    }
    if (isHeading(lines[i])) {
      const heading = headingText(lines[i]);
      if (heading) blocks.push({ type: "heading", children: parseInlines(heading) });
      i += 1;
      continue;
    }
    const list = parseList(lines, i);
    if (list) {
      blocks.push(list.block);
      i = list.next;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !isBlockStart(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length > 0) blocks.push({ type: "paragraph", children: joinLines(para) });
  }
  return blocks;
}
