import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const rendererHtml = readFileSync(resolve("src/renderer/index.html"), "utf8");

describe("Renderer HTML contracts", () => {
  it("keeps draft refinement in the Generate Card capture panel", () => {
    const addPanel = rendererHtml.match(/<section class="panel add-panel">[\s\S]*?<\/section>/)?.[0] ?? "";
    const cardForm = rendererHtml.match(/<form id="cardForm"[\s\S]*?<\/form>/)?.[0] ?? "";

    expect(addPanel).toContain("draftQuestionInput");
    expect(addPanel).toContain("refineDraftButton");
    expect(addPanel).toContain("Refine generated card");
    expect(cardForm).not.toContain("draftQuestionInput");
    expect(cardForm).not.toContain("refineDraftButton");
  });

  it("exposes demo schedule fields and library filters", () => {
    expect(rendererHtml).toContain("cardKindInput");
    expect(rendererHtml).toContain("statusInput");
    expect(rendererHtml).toContain("dueDateInput");
    expect(rendererHtml).toContain("dueTimeInput");
    expect(rendererHtml).toContain("libraryFilterInput");
    expect(rendererHtml).toContain('data-view="calendar"');
    expect(rendererHtml).toContain("calendarView");
    expect(rendererHtml).toContain("calendarBoard");
    expect(rendererHtml).toContain("Schedule");
    expect(rendererHtml).toContain("Trash");
  });

  it("shows diagnostics log paths in settings", () => {
    expect(rendererHtml).toContain("diagnosticsText");
    expect(rendererHtml).toContain("Diagnostics");
  });

  it("uses a runtime app version placeholder instead of hardcoding release text", () => {
    expect(rendererHtml).toContain("appVersionText");
    expect(rendererHtml).not.toContain("v0.1.");
  });
});