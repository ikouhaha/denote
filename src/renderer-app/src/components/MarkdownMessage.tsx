import type { ReactNode } from "react";

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "blockquote"; lines: string[] }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "code"; code: string }
  | { type: "paragraph"; text: string };

export function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="message-content markdown-message">
      {parseMarkdownBlocks(content).map((block, index) => (
        <MarkdownBlockView block={block} key={`${block.type}-${index}`} />
      ))}
    </div>
  );
}

function MarkdownBlockView({ block }: { block: MarkdownBlock }) {
  if (block.type === "heading") {
    const Tag = block.level === 1 ? "h3" : block.level === 2 ? "h4" : "h5";
    return <Tag>{renderInlineMarkdown(block.text)}</Tag>;
  }
  if (block.type === "blockquote") {
    return (
      <blockquote>
        {block.lines.map((line, index) => (
          <p key={`${line}-${index}`}>{renderInlineMarkdown(line)}</p>
        ))}
      </blockquote>
    );
  }
  if (block.type === "list") {
    const Tag = block.ordered ? "ol" : "ul";
    return (
      <Tag>
        {block.items.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </Tag>
    );
  }
  if (block.type === "table") {
    return (
      <div className="markdown-table-shell">
        <table className="markdown-table">
          <thead>
            <tr>
              {block.headers.map((header) => (
                <th key={header}>{renderInlineMarkdown(header)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`${row.join("|")}-${rowIndex}`}>
                {block.headers.map((header, cellIndex) => (
                  <td key={`${header}-${cellIndex}`}>{renderInlineMarkdown(row[cellIndex] || "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  if (block.type === "code") {
    return <pre className="markdown-code">{block.code}</pre>;
  }
  return <p>{renderInlineMarkdown(block.text)}</p>;
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] || "";
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.trim().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] || "").trim().startsWith("```")) {
        code.push(lines[index] || "");
        index += 1;
      }
      blocks.push({ type: "code", code: code.join("\n") });
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]?.length || 1, text: heading[2] || "" });
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] || "")) {
        quoteLines.push((lines[index] || "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      const itemPattern = ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*]\s+(.+)$/;
      while (index < lines.length) {
        const item = (lines[index] || "").match(itemPattern);
        if (!item) break;
        items.push(item[1] || "");
        index += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }
    if (isMarkdownTableStart(lines, index)) {
      const tableLines: string[] = [];
      while (index < lines.length && isMarkdownTableLine(lines[index] || "")) {
        tableLines.push(lines[index] || "");
        index += 1;
      }
      blocks.push(parseMarkdownTable(tableLines));
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] || "").trim() && !isMarkdownBlockStart(lines[index] || "")) {
      paragraph.push((lines[index] || "").trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }
  return blocks.length ? blocks : [{ type: "paragraph", text: "" }];
}

function isMarkdownBlockStart(line: string): boolean {
  return line.trim().startsWith("```") || /^(#{1,3})\s+/.test(line) || /^>\s?/.test(line) || /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line) || isMarkdownTableLine(line);
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\[[^\]]+\]\(https?:\/\/[^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      const label = link?.[1] || token;
      const url = link?.[2] || "";
      nodes.push(
        <a
          href={url}
          key={`${token}-${match.index}`}
          onClick={(event) => {
            event.preventDefault();
            if (url) {
              void window.denote.openExternal(url);
            }
          }}
        >
          {label}
        </a>
      );
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={`${token}-${match.index}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={`${token}-${match.index}`}>{token.slice(1, -1)}</code>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
  return isMarkdownTableLine(lines[index] || "") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || "");
}

function isMarkdownTableLine(line: string): boolean {
  return line.includes("|") && line.split("|").length >= 3;
}

function parseMarkdownTable(lines: string[]): MarkdownBlock {
  const headers = splitMarkdownTableRow(lines[0] || "");
  const bodyLines = lines.slice(2);
  return {
    type: "table",
    headers,
    rows: bodyLines.map(splitMarkdownTableRow)
  };
}

function splitMarkdownTableRow(line: string): string[] {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((cell) => cell.trim());
}
