import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rendererSource = readFileSync(resolve("src/renderer/renderer.js"), "utf8");

describe("Renderer source contracts", () => {
  it("lets users ask AI to revise generated card drafts", () => {
    expect(rendererSource).toContain("refineCurrentDraft");
    expect(rendererSource).toContain("window.denote.refineDraft");
    expect(rendererSource).toContain("draftQuestionInput");
  });

  it("supports demo schedule card fields and status actions", () => {
    expect(rendererSource).toContain("cardKindInput");
    expect(rendererSource).toContain("dueDateInput");
    expect(rendererSource).toContain("libraryFilterInput");
    expect(rendererSource).toContain("matchesLibraryFilter");
    expect(rendererSource).toContain("renderCalendar");
    expect(rendererSource).toContain("getCalendarGroup");
    expect(rendererSource).toContain("window.denote.updateCardStatus");
  });

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
