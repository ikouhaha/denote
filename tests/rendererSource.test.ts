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

  it("loads diagnostics paths and avoids stuck LLM status", () => {
    expect(rendererSource).toContain("loadDiagnostics");
    expect(rendererSource).toContain("window.denote.getDiagnostics");
    expect(rendererSource).toContain("requestCompleted");
    expect(rendererSource).toContain("LLM request ended without a response");
  });

  it("shows and clears a global loading indicator around async actions", () => {
    expect(rendererSource).toContain("busyCount");
    expect(rendererSource).toContain("beginBusy(label)");
    expect(rendererSource).toContain("endBusy()");
    expect(rendererSource).toContain("Loading workspace");
    expect(rendererSource).toContain('classList.add("busy")');
    expect(rendererSource).toContain('setAttribute("aria-busy", "true")');
    expect(rendererSource).toContain('classList.remove("busy")');
  });

  it("loads app version from the main process", () => {
    expect(rendererSource).toContain("loadAppInfo");
    expect(rendererSource).toContain("window.denote.getAppInfo");
    expect(rendererSource).toContain("appVersionText");
  });

  it("renders manual update controls in the sidebar", () => {
    expect(rendererSource).toContain("loadUpdateState");
    expect(rendererSource).toContain("renderUpdateState");
    expect(rendererSource).toContain("handleUpdateAction");
    expect(rendererSource).toContain("window.denote.getUpdateState");
    expect(rendererSource).toContain("window.denote.checkForUpdates");
    expect(rendererSource).toContain("window.denote.downloadUpdate");
    expect(rendererSource).toContain("window.denote.installUpdate");
    expect(rendererSource).toContain("window.denote.onUpdateStateChanged");
    expect(rendererSource).toContain("updateActionButton");
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

  it("switches task provider mode and loads provider metadata", () => {
    expect(rendererSource).toContain("setTaskProvider");
    expect(rendererSource).toContain("window.denote.setTaskProvider");
    expect(rendererSource).toContain("loadTaskProviderMetadata");
    expect(rendererSource).toContain("window.denote.getTaskProviderMetadata");
    expect(rendererSource).toContain("renderProviderMode");
    expect(rendererSource).toContain("renderProviderSetupState");
  });

  it("loads provider settings before refreshing provider-scoped cards", () => {
    expect(rendererSource).toContain("await loadSettings();");
    expect(rendererSource).toContain("await Promise.all([refreshCards(), loadDiagnostics()]);");
    expect(rendererSource).toContain("renderProviderMode();");
  });

  it("uses provider task APIs for Notion mode without hardcoded project options", () => {
    expect(rendererSource).toContain("window.denote.listTasks");
    expect(rendererSource).toContain("window.denote.createTask");
    expect(rendererSource).toContain("window.denote.updateTaskStatus");
    expect(rendererSource).toContain("renderNotionMetadataOptions");
    expect(rendererSource).toContain("window.denote.discoverNotionDatabases");
    expect(rendererSource).toContain("discoverNotionDatabases");
    expect(rendererSource).toContain("notionTokens");
    expect(rendererSource).toContain("activeNotionTokenId");
    expect(rendererSource).toContain("getActiveNotionToken");
    expect(rendererSource).toContain("addNotionToken");
    expect(rendererSource).toContain("switchNotionToken");
    expect(rendererSource).toContain("formatNotionTokenOptionLabel");
    expect(rendererSource).toContain("renderNotionTokens();");
    expect(rendererSource).toContain("removeActiveNotionToken");
    expect(rendererSource).toContain("isNotionSourceAccessError");
    expect(rendererSource).toContain("isNotionSourceSchemaError");
    expect(rendererSource).toContain("clearActiveNotionTaskSources");
    expect(rendererSource).toContain("hasEnabledNotionTaskSources");
    expect(rendererSource).toContain("Click Find Sources while this token is selected");
    expect(rendererSource).toContain("Selected Notion source does not match the Dennis Tasks schema");
    expect(rendererSource).toContain("No Notion task sources selected. Open Settings and click Find Sources for the selected token.");
    expect(rendererSource).toContain('setView("settings")');
    expect(rendererSource).toContain("window.confirm");
    expect(rendererSource).toContain("state.notionTokens.filter");
    expect(rendererSource).toContain("notionTaskSources");
    expect(rendererSource).toContain("notionSelectedSources");
    expect(rendererSource).toContain("notionTaskSourceInput");
    expect(rendererSource).toContain("toggleNotionTaskSource");
    expect(rendererSource).toContain("renderSelectedNotionSources");
    expect(rendererSource).toContain("sourceId: elements.notionTaskSourceInput.value");
    expect(rendererSource).toContain("Finding Notion sources");
    expect(rendererSource).toContain("Choose a Notion source");
    expect(rendererSource).toContain("await window.denote.saveSettings(readSettingsForm())");
    expect(rendererSource).toContain("notionIntegrationError");
    expect(rendererSource).not.toContain("ICAC CCSP & DIMS");
    expect(rendererSource).not.toContain("DPO SmartLab");
    expect(rendererSource).not.toContain("BOCPT");
  });
});
