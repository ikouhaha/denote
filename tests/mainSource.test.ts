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

  it("serves the Vite renderer through a privileged app protocol", () => {
    expect(mainSource).toContain("protocol.registerSchemesAsPrivileged");
    expect(mainSource).toContain("protocol.handle(RENDERER_PROTOCOL");
    expect(mainSource).toContain("pathToFileURL(filePath)");
    expect(mainSource).toContain("net.fetch");
    expect(mainSource).toContain("mainWindow.loadURL");
    expect(mainSource).not.toContain("mainWindow.loadFile");
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
    expect(mainSource).toContain('ipcMain.handle("denote:generateNotionTaskDraft"');
    expect(mainSource).toContain('ipcMain.handle("denote:getNotionTaskDetail"');
    expect(mainSource).toContain('ipcMain.handle("denote:askNotion"');
    expect(mainSource).toContain('ipcMain.handle("denote:applyNotionAction"');
    expect(mainSource).toContain('ipcMain.handle("denote:archiveNotionTask"');
    expect(mainSource).toContain('ipcMain.handle("denote:syncNotionTasks"');
  });

  it("registers SFTP sync connection testing behind the main process", () => {
    expect(mainSource).toContain('ipcMain.handle("denote:testSftpConnection"');
    expect(mainSource).toContain('require("ssh2-sftp-client")');
    expect(mainSource).toContain("testSftpConnection");
    expect(mainSource).toContain("ensureSftpDirectory");
    expect(mainSource).toContain("normalizeRemoteAbsolutePath");
    expect(mainSource).toContain("normalizeRemoteRelativePath");
    expect(mainSource).toContain("sftp.connection.success");
    expect(mainSource).toContain("sftp.connection.failed");
  });

  it("opens external links through main process instead of navigating the renderer", () => {
    expect(mainSource).toContain('shell.openExternal');
    expect(mainSource).toContain('ipcMain.handle("denote:openExternal"');
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
    expect(mainSource).toContain("syncProvider");
    expect(mainSource).toContain("normalizeSftpSettings");
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
    expect(listTasksHandler).toContain("listNotionTasks(settings, input)");
    expect(listTasksHandler).not.toContain("readStore()");
  });

  it("queries every enabled Notion task source and preserves source identity on returned tasks", () => {
    expect(mainSource).toContain("getEnabledNotionTaskSources(tokenProfile)");
    expect(mainSource).toContain("Promise.allSettled");
    expect(mainSource).toContain("queryAllNotionDataSourcePages");
    expect(mainSource).toContain("start_cursor");
    expect(mainSource).toContain("normalizeNotionTaskPageWithSource");
    expect(mainSource).toContain("enrichNotionTasksWithRelationNames");
    expect(mainSource).toContain("sourceId");
    expect(mainSource).toContain("sourceName");
  });

  it("excludes completed Notion statuses by default and allows explicit inclusion", () => {
    expect(mainSource).toContain("DEFAULT_COMPLETED_NOTION_STATUSES");
    expect(mainSource).toContain("buildNotionTaskQueryFilter");
    expect(mainSource).toContain("includeCompleted");
    expect(mainSource).toContain("does_not_equal");
    expect(mainSource).toContain("UAT");
    expect(mainSource).toContain("Done");
    expect(mainSource).toContain("Archived");
  });

  it("uses controlled Notion AI playbooks and validates actions before Notion writes", () => {
    expect(mainSource).toContain("generateNotionTaskDraftWithLlm");
    expect(mainSource).toContain("answerNotionMetadataQuestion");
    expect(mainSource).toContain("answerNotionWithLlm");
    expect(mainSource).toContain("planNotionActionsWithLlm");
    expect(mainSource).toContain("shouldPlanNotionActions");
    expect(mainSource).toContain('notion.ask.action_plan.skipped');
    expect(mainSource).toContain('notion.ask.action_plan.done');
    expect(mainSource).toContain("formatNotionTaskSummaryList");
    expect(mainSource).toContain("Count and filter questions must use every row below");
    expect(mainSource).toContain("Task, Status, Assignees, Due, Project");
    expect(mainSource).toContain("Do not cite internal summary row numbers");
    expect(mainSource).toContain("Link:");
    expect(mainSource).toContain("validateNotionActionPlan");
    expect(mainSource).toContain("applyNotionAction");
    expect(mainSource).toContain("createNotionSprint");
    expect(mainSource).toContain("create_sprint");
    expect(mainSource).toContain("assignCreatedSprintToTasks");
    expect(mainSource).toContain("metadata.sprintDataSourceId");
    expect(mainSource).toContain("parent: { data_source_id: metadata.sprintDataSourceId }");
    expect(mainSource).toContain("needsConfirmation");
    expect(mainSource).toContain("ALL Notion content written by Denote must be English");
    expect(mainSource).toContain("Do not claim that a Notion write has happened");
  });

  it("does not run Notion action planning for read-only ask questions", () => {
    const answerNotionBody = mainSource.match(/async function answerNotionWithLlm[\s\S]*?\r?\n}\r?\n\r?\nfunction shouldPlanNotionActions/)?.[0] ?? "";
    expect(answerNotionBody).toContain("shouldPlanNotionActions(question)");
    expect(answerNotionBody).toContain("actionPlan = null");
    expect(answerNotionBody).toContain("if (shouldPlanNotionActions(question))");
    expect(answerNotionBody).toContain("planNotionActionsWithLlm");
    expect(answerNotionBody).not.toContain("const actionPlan = await planNotionActionsWithLlm");
  });

  it("teaches Notion action planning to create and assign sprints through relation data sources", () => {
    const planBody = mainSource.match(/async function planNotionActionsWithLlm[\s\S]*?\r?\n}\r?\n\r?\nfunction validateNotionActionPlan/)?.[0] ?? "";
    expect(planBody).toContain("Allowed metadata");
    expect(planBody).toContain("create_sprint");
    expect(planBody).toContain("sprintName");
    expect(planBody).toContain("taskIds");

    const applyBody = mainSource.match(/async function applyNotionAction[\s\S]*?\r?\n}\r?\n\r?\nfunction buildNotionPageUpdateProperties/)?.[0] ?? "";
    expect(applyBody).toContain('action.type === "create_sprint"');
    expect(applyBody).toContain("createNotionSprint(settings, action.sprintName)");
    expect(applyBody).toContain("assignCreatedSprintToTasks");
  });

  it("lazy-loads Notion task blocks and comments for detail/AI context", () => {
    expect(mainSource).toContain("getNotionTaskDetail");
    expect(mainSource).toContain("readNotionBlockChildren");
    expect(mainSource).toContain("readNotionComments");
    expect(mainSource).toContain("notion.blocks.children.list");
    expect(mainSource).toContain("notion.comments.list");
    expect(mainSource).toContain("notionDetailCache");
  });

  it("requires a target Notion source when creating a task across multiple sources", () => {
    const createTaskBody = mainSource.match(/async function createNotionTask[\s\S]*?\r?\n}\r?\n\r?\nasync function updateNotionTaskStatus/)?.[0] ?? "";
    expect(createTaskBody).toContain("resolveNotionTargetSourceId(tokenProfile, input)");
    expect(mainSource).toContain("input?.sourceId");
    expect(createTaskBody).toContain("Notion task source is required");
  });

  it("defines the Notion page property readers used by task normalization", () => {
    expect(mainSource).toContain("function readNotionStatus");
    expect(mainSource).toContain("function readNotionSelect");
    expect(mainSource).toContain("function readNotionPeople");
    expect(mainSource).toContain("function readNotionDate");
    expect(mainSource).toContain("function readNotionRelationIds");
    expect(mainSource).toContain("function readNotionNumber");
  });
});
