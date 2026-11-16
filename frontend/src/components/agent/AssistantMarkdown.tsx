import { useMemo, type ReactNode } from "react";
import { parseAssistantMarkdown, type Inline, type MarkdownBlock } from "./safeMarkdown";

/**
 * Assistant reply (saved message and the live stream) as markdown.
 * Model text is untrusted. Elements come from the parser; this file does not
 * parse or write HTML. External links open in a new tab with a safe rel.
 * The column stays at most 68ch, including code, which wraps inside it.
 */
const EXTERNAL_REL = "noopener noreferrer";

function renderInlines(nodes: Inline[], key: string): ReactNode[] {
  const out: ReactNode[] = [];
  nodes.forEach((node, index) => {
    const id = `${key}.${index}`;
    if (node.type === "text") {
      if (node.text) out.push(node.text);
      return;
    }
    if (node.type === "break") {
      out.push(<br key={id} />);
      return;
    }
    if (node.type === "code") {
      out.push(<code key={id} className="t-code">{node.text}</code>);
      return;
    }
    if (node.type === "strong") {
      out.push(<strong key={id}>{renderInlines(node.children, id)}</strong>);
      return;
    }
    if (node.type === "em") {
      out.push(<em key={id}>{renderInlines(node.children, id)}</em>);
      return;
    }
    const children = renderInlines(node.children, id);
    const body = children.length > 0 ? children : node.href;
    // Scheme was checked in the parser. Check again at the element so a bad
    // href cannot become an anchor even if a caller builds a node by hand.
    if (!node.href.startsWith("https://") && !node.href.startsWith("http://")) {
      out.push(<span key={id}>{body}</span>);
      return;
    }
    out.push(
      <a key={id} href={node.href} target="_blank" rel={EXTERNAL_REL} className="text-signal-text underline underline-offset-2">
        {body}
      </a>,
    );
  });
  return out;
}

function renderBlock(block: MarkdownBlock, index: number): ReactNode {
  const key = `b${index}`;
  if (block.type === "code") {
    return (
      <pre key={key} className="t-code min-w-0 max-w-full whitespace-pre-wrap wrap-anywhere rounded-control bg-sub-200 p-2">
        <code>{block.text}</code>
      </pre>
    );
  }
  if (block.type === "list") {
    const items = block.items.map((item, itemIndex) => (
      <li key={itemIndex}>{renderInlines(item, `${key}.${itemIndex}`)}</li>
    ));
    if (block.ordered) {
      return (
        <ol key={key} className="m-0 list-decimal pl-5" start={block.start === 1 ? undefined : block.start}>
          {items}
        </ol>
      );
    }
    return <ul key={key} className="m-0 list-disc pl-5">{items}</ul>;
  }
  return (
    <p key={key} className={block.type === "heading" ? "m-0 font-medium" : "m-0"}>
      {renderInlines(block.children, key)}
    </p>
  );
}

export function AssistantMarkdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseAssistantMarkdown(text), [text]);
  if (blocks.length === 0) return null;
  return (
    <div className="flex min-w-0 max-w-[68ch] flex-col gap-2 text-reading wrap-anywhere text-ink-dim">
      {blocks.map(renderBlock)}
    </div>
  );
}
