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

  it("renders an accessible global loading indicator in the status area", () => {
    expect(rendererHtml).toContain('role="status"');
    expect(rendererHtml).toContain('aria-live="polite"');
    expect(rendererHtml).toContain("status-spinner");
    expect(rendererHtml).toContain("statusText");
  });

  it("uses a runtime app version placeholder instead of hardcoding release text", () => {
    expect(rendererHtml).toContain("appVersionText");
    expect(rendererHtml).toContain("updateStatusText");
    expect(rendererHtml).toContain("updateActionButton");
    expect(rendererHtml).not.toContain("v0.1.");
  });

  it("renders provider mode switch and Notion configuration fields", () => {
    expect(rendererHtml).toContain("providerModeSwitch");
    expect(rendererHtml).toContain('data-provider="local"');
    expect(rendererHtml).toContain('data-provider="notion"');
    expect(rendererHtml).toContain("notionTokenInput");
    expect(rendererHtml).toContain("notionTokenProfilePicker");
    expect(rendererHtml).toContain("addNotionTokenButton");
    expect(rendererHtml).toContain("removeNotionTokenButton");
    expect(rendererHtml).toContain("Notion token");
    expect(rendererHtml).toContain("notionTasksDatabaseIdInput");
    expect(rendererHtml).toContain("discoverNotionDatabasesButton");
    expect(rendererHtml).toContain("notionDatabasePicker");
    expect(rendererHtml).toContain("notionSelectedSources");
    expect(rendererHtml).toContain("notionTaskSourceInput");
    expect(rendererHtml).toContain("Find Sources");
    expect(rendererHtml).toContain("Accessible Notion sources");
    expect(rendererHtml).toContain("Selected task sources");
  });

  it("includes Notion primary and advanced task fields", () => {
    expect(rendererHtml).toContain("notionTaskFields");
    expect(rendererHtml).toContain("notionStatusInput");
    expect(rendererHtml).toContain("notionPriorityInput");
    expect(rendererHtml).toContain("notionTaskTypeInput");
    expect(rendererHtml).toContain("notionAssignInput");
    expect(rendererHtml).toContain("notionProjectInput");
    expect(rendererHtml).toContain("notionTaskReceiveDateInput");
    expect(rendererHtml).toContain("notionSprintInput");
    expect(rendererHtml).toContain("notionReadonlyFields");
  });
});
