import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(resolve("src/main/main.cjs"), "utf8");

describe("Electron main source contracts", () => {
  it("does not auto-seed samples when listing or asking cards", () => {
    const listCardsHandler = mainSource.match(/ipcMain\.handle\("denote:listCards"[\s\S]*?\n}\);/)?.[0] ?? "";
    const askHandler = mainSource.match(/ipcMain\.handle\("denote:ask"[\s\S]*?\n}\);/)?.[0] ?? "";

    expect(listCardsHandler).not.toContain("ensureSampleCards()");
    expect(askHandler).not.toContain("ensureSampleCards()");
  });

  it("uses the configured LLM for card drafting and ask answers", () => {
    const generateDraftHandler = mainSource.match(/ipcMain\.handle\("denote:generateDraft"[\s\S]*?\n}\);/)?.[0] ?? "";
    const refineDraftHandler = mainSource.match(/ipcMain\.handle\("denote:refineDraft"[\s\S]*?\n}\);/)?.[0] ?? "";
    const askHandler = mainSource.match(/ipcMain\.handle\("denote:ask"[\s\S]*?\n}\);/)?.[0] ?? "";

    expect(generateDraftHandler).toContain("generateDraftWithLlm");
    expect(refineDraftHandler).toContain("refineDraftWithLlm");
    expect(askHandler).toContain("answerWithLlm");
  });

  it("supports demo schedule cards and soft delete", () => {
    expect(mainSource).toContain("CARD_KINDS");
    expect(mainSource).toContain("CARD_STATUSES");
    expect(mainSource).toContain("due_date");
    expect(mainSource).toContain("denote:updateCardStatus");
    expect(mainSource).toContain('card.status = "deleted"');
    expect(mainSource).toContain("isScheduleQuestion");
    expect(mainSource).toContain("visibleCards");
  });

  it("logs LLM diagnostics and exposes log paths", () => {
    expect(mainSource).toContain("getLogFilePath");
    expect(mainSource).toContain("denote:getDiagnostics");
    expect(mainSource).toContain("writeLog");
    expect(mainSource).toContain("LLM_TIMEOUT_MS");
    expect(mainSource).toContain("llm.request.timeout");
    expect(mainSource).toContain("llm.response.invalid_json");
    expect(mainSource).toContain("responseSnippet");
  });

  it("exposes app version from Electron metadata instead of hardcoding it in the UI", () => {
    expect(mainSource).toContain('ipcMain.handle("denote:getAppInfo"');
    expect(mainSource).toContain("app.getVersion()");
  });

  it("configures manual GitHub auto-update IPC", () => {
    expect(mainSource).toContain('require("electron-updater")');
    expect(mainSource).toContain("autoUpdater.autoDownload = false");
    expect(mainSource).toContain('ipcMain.handle("denote:getUpdateState"');
    expect(mainSource).toContain('ipcMain.handle("denote:checkForUpdates"');
    expect(mainSource).toContain('ipcMain.handle("denote:downloadUpdate"');
    expect(mainSource).toContain('ipcMain.handle("denote:installUpdate"');
    expect(mainSource).toContain("autoUpdater.checkForUpdates()");
    expect(mainSource).toContain("autoUpdater.downloadUpdate()");
    expect(mainSource).toContain("autoUpdater.quitAndInstall()");
    expect(mainSource).toContain('"denote:updateStateChanged"');
  });

  it("does not return the old local insufficient evidence answer", () => {
    expect(mainSource).not.toContain("I do not have enough saved Denote knowledge to answer that yet.");
  });

  it("registers task provider IPC handlers", () => {
    expect(mainSource).toContain('ipcMain.handle("denote:setTaskProvider"');
    expect(mainSource).toContain('ipcMain.handle("denote:getTaskProviderMetadata"');
    expect(mainSource).toContain('ipcMain.handle("denote:discoverNotionDatabases"');
    expect(mainSource).toContain('ipcMain.handle("denote:listTasks"');
    expect(mainSource).toContain('ipcMain.handle("denote:createTask"');
    expect(mainSource).toContain('ipcMain.handle("denote:updateTaskStatus"');
  });

  it("discovers Notion databases from saved settings when no token payload is passed", () => {
    expect(mainSource).toContain("return discoverNotionDatabases(input, await readSettings())");
    expect(mainSource).toContain("resolveActiveNotionToken(settings)");
    expect(mainSource).toContain("input?.notionToken || tokenProfile.token");
  });

  it("uses current Notion data source APIs instead of deprecated database search/query calls", () => {
    expect(mainSource).toContain('filter: { property: "object", value: "data_source" }');
    expect(mainSource).not.toContain('filter: { property: "object", value: "database" }');
    expect(mainSource).toContain("notion.dataSources.retrieve");
    expect(mainSource).toContain("notion.dataSources.query");
    expect(mainSource).toContain("data_source_id:");
    expect(mainSource).not.toContain("notion.databases.query");
  });

  it("normalizes Notion settings and keeps provider mode local by default", () => {
    expect(mainSource).toContain("taskProvider");
    expect(mainSource).toContain("notionToken");
    expect(mainSource).toContain("notionTasksDatabaseId");
    expect(mainSource).toContain("notionTaskSources");
    expect(mainSource).toContain("notionTokens");
    expect(mainSource).toContain("activeNotionTokenId");
    expect(mainSource).toContain("normalizeNotionTaskSources");
    expect(mainSource).toContain("normalizeNotionTokens");
    expect(mainSource).toContain('taskProvider: "local"');
  });

  it("scopes Notion reads and writes to the active token profile", () => {
    expect(mainSource).toContain("resolveActiveNotionToken(settings)");
    expect(mainSource).toContain("createNotionClientForToken(tokenProfile)");
    expect(mainSource).toContain("getEnabledNotionTaskSources(tokenProfile)");
    expect(mainSource).toContain("resolveNotionTargetSourceId(tokenProfile, input)");
    expect(mainSource).toContain("tokenProfileId");
    expect(mainSource).toContain("tokenProfileName");
  });

  it("does not fall back to local cards when Notion mode is not configured", () => {
    const listTasksHandler = mainSource.match(/ipcMain\.handle\("denote:listTasks"[\s\S]*?\n}\);/)?.[0] ?? "";
    expect(listTasksHandler).toContain("listNotionTasks(settings)");
    expect(listTasksHandler).not.toContain("readStore()");
  });

  it("queries every enabled Notion task source and preserves source identity on returned tasks", () => {
    expect(mainSource).toContain("getEnabledNotionTaskSources(tokenProfile)");
    expect(mainSource).toContain("Promise.allSettled");
    expect(mainSource).toContain("normalizeNotionTaskPageWithSource");
    expect(mainSource).toContain("sourceId");
    expect(mainSource).toContain("sourceName");
  });

  it("requires a target Notion source when creating a task across multiple sources", () => {
    const createTaskBody = mainSource.match(/async function createNotionTask[\s\S]*?\r?\n}\r?\n\r?\nasync function updateNotionTaskStatus/)?.[0] ?? "";
    expect(createTaskBody).toContain("resolveNotionTargetSourceId(tokenProfile, input)");
    expect(mainSource).toContain("input?.sourceId");
    expect(createTaskBody).toContain("Notion task source is required");
  });
});
