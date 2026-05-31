import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rendererSource = readFileSync(resolve("src/renderer/renderer.js"), "utf8");

describe("Renderer source contracts", () => {
  it("renders assistant messages as Markdown instead of raw text", () => {
    expect(rendererSource).toContain("renderMarkdownInto");
    expect(rendererSource).toContain('message.role !== "assistant"');
    expect(rendererSource).toContain('container.classList.add("markdown-content")');
    expect(rendererSource).toContain("appendTable");
  });

  it("does not inject raw LLM Markdown as HTML", () => {
    expect(rendererSource).not.toContain("container.innerHTML = message.content");
    expect(rendererSource).not.toContain("container.innerHTML = content");
    expect(rendererSource).toContain("document.createTextNode");
    expect(rendererSource).toContain("codeNode.textContent = code");
  });
});
