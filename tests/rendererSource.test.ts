import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(resolve("src/renderer-app/src/App.tsx"), "utf8");
const localWorkspaceSource = readFileSync(resolve("src/renderer-app/src/workspaces/LocalWorkspace.tsx"), "utf8");
const notionWorkspaceSource = readFileSync(resolve("src/renderer-app/src/workspaces/NotionWorkspace.tsx"), "utf8");
const settingsWorkspaceSource = readFileSync(resolve("src/renderer-app/src/workspaces/SettingsWorkspace.tsx"), "utf8");
const providerViewsSource = readFileSync(resolve("src/renderer-app/src/lib/providerViews.ts"), "utf8");
const chatRevealSource = readFileSync(resolve("src/renderer-app/src/lib/chatReveal.ts"), "utf8");

describe("React renderer source contracts", () => {
  it("uses provider-scoped navigation and workspaces", () => {
    expect(providerViewsSource).toContain("providerViews");
    expect(providerViewsSource).toContain('local: ["add", "library", "calendar", "ask", "settings"]');
    expect(providerViewsSource).toContain('notion: ["notionTasks", "notionAddTask", "notionAsk", "settings"]');
    expect(providerViewsSource).toContain("getDefaultViewForProvider");
    expect(providerViewsSource).toContain("coerceViewForProvider");
    expect(appSource).toContain("LocalWorkspace");
    expect(appSource).toContain("NotionWorkspace");
    expect(appSource).toContain("data-provider-views");
  });

  it("keeps Local Ask scoped to local cards", () => {
    expect(localWorkspaceSource).toContain("window.denote.ask");
    expect(localWorkspaceSource).toContain("LocalWorkspace");
    expect(localWorkspaceSource).toContain("LLM answers using saved local cards as context");
    expect(notionWorkspaceSource).not.toContain("window.denote.ask({");
    expect(notionWorkspaceSource).toContain("window.denote.askNotion");
    expect(appSource).toContain("Local cards provide context for Ask");
  });

  it("keeps Notion tasks out of the Local Library", () => {
    expect(localWorkspaceSource).toContain("libraryFilterInput");
    expect(localWorkspaceSource).not.toContain("notionStatusFilterInput");
    expect(localWorkspaceSource).not.toContain("notionProjectFilterInput");
    expect(localWorkspaceSource).not.toContain("notionAssigneeFilterInput");
    expect(notionWorkspaceSource).toContain("notionStatusFilterInput");
    expect(notionWorkspaceSource).toContain("notionProjectFilterInput");
    expect(notionWorkspaceSource).toContain("notionAssigneeFilterInput");
    expect(notionWorkspaceSource).toContain("matchesNotionTaskFilters");
  });

  it("uses a dense Notion task workspace on desktop with mobile-specific controls", () => {
    expect(notionWorkspaceSource).toContain("notionTaskFilterToolbar");
    expect(notionWorkspaceSource).toContain("notionMobileFilterPanel");
    expect(notionWorkspaceSource).toContain("notionSourceFilterInput");
    expect(notionWorkspaceSource).toContain("notionTaskTable");
    expect(notionWorkspaceSource).toContain("notionTaskMobileList");
    expect(notionWorkspaceSource).toContain("notion-task-table-shell");
    expect(notionWorkspaceSource).toContain("notion-task-mobile-list");
    expect(notionWorkspaceSource).toContain("openNotionTask");
    expect(notionWorkspaceSource).not.toContain('id="notionTaskList" className="card-list"');
  });

  it("uses provider task APIs and metadata without hardcoded project names", () => {
    expect(notionWorkspaceSource).toContain("window.denote.getTaskProviderMetadata");
    expect(notionWorkspaceSource).toContain("window.denote.listTasks");
    expect(notionWorkspaceSource).toContain("window.denote.createTask");
    expect(notionWorkspaceSource).toContain("window.denote.updateTaskStatus");
    expect(notionWorkspaceSource).toContain("window.denote.generateNotionTaskDraft");
    expect(notionWorkspaceSource).toContain("window.denote.getNotionTaskDetail");
    expect(notionWorkspaceSource).toContain("window.denote.applyNotionAction");
    expect(notionWorkspaceSource).toContain("window.denote.archiveNotionTask");
    expect(notionWorkspaceSource).toContain("window.denote.syncNotionTasks");
    expect(notionWorkspaceSource).toContain("window.denote.openExternal");
    expect(notionWorkspaceSource).toContain("formatProjectLabel");
    expect(notionWorkspaceSource).toContain("formatSourceLabel");
    expect(notionWorkspaceSource).toContain("projectNames");
    expect(notionWorkspaceSource).toContain("values={uniqueSorted(tasks.flatMap((task) => task.projectNames))}");
    expect(notionWorkspaceSource).toContain("values={uniqueSorted(tasks.map(formatSourceLabel))}");
    expect(notionWorkspaceSource).toContain("Open in Notion");
    expect(notionWorkspaceSource).not.toContain("ICAC CCSP & DIMS");
    expect(notionWorkspaceSource).not.toContain("DPO SmartLab");
    expect(notionWorkspaceSource).not.toContain("BOCPT");
  });

  it("mirrors Local Generate/Save/Ask in the Notion workspace without mixing storage", () => {
    expect(providerViewsSource).toContain('notion: ["notionTasks", "notionAddTask", "notionAsk", "settings"]');
    expect(notionWorkspaceSource).toContain("Generate Task");
    expect(notionWorkspaceSource).toContain("Refine generated task");
    expect(notionWorkspaceSource).toContain("Save Task");
    expect(notionWorkspaceSource).toContain("notionSourceTextInput");
    expect(notionWorkspaceSource).toContain("notionAskView");
    expect(notionWorkspaceSource).toContain("notionAskFilterPanel");
    expect(notionWorkspaceSource).toContain("notion-ask-filter-toolbar");
    expect(notionWorkspaceSource).toContain("formatFilterSummary");
    expect(notionWorkspaceSource).toContain("formatAskScopeSummary");
    expect(notionWorkspaceSource).toContain("Using ${filteredCount} filtered task");
    expect(notionWorkspaceSource).toContain("return filteredTasks;");
    expect(notionWorkspaceSource).toContain("Combobox");
    expect(notionWorkspaceSource).not.toContain("selectedTaskIds");
    expect(notionWorkspaceSource).not.toContain("toggleTaskSelection");
    expect(notionWorkspaceSource).not.toContain('<th scope="col">Select</th>');
    expect(notionWorkspaceSource).not.toContain("mobile-task-select");
    expect(notionWorkspaceSource).not.toContain("Ask selected Notion tasks");
    expect(notionWorkspaceSource).not.toContain("notionAskScopeInput");
    expect(notionWorkspaceSource).not.toContain("Selected task");
    expect(notionWorkspaceSource).not.toContain("Selected tasks");
    expect(notionWorkspaceSource).not.toContain("Select one task from the task list");
    expect(notionWorkspaceSource).toContain("answer.actionPlan?.actions?.length ? answer.actionPlan : null");
    expect(notionWorkspaceSource).not.toContain("window.denote.saveCard");
  });

  it("renders assistant Markdown as React elements without raw HTML", () => {
    expect(localWorkspaceSource).toContain("MarkdownMessage");
    expect(notionWorkspaceSource).toContain("MarkdownMessage");
    const markdownMessageSource = readFileSync(resolve("src/renderer-app/src/components/MarkdownMessage.tsx"), "utf8");
    expect(markdownMessageSource).toContain("markdown-table");
    expect(markdownMessageSource).toContain("window.denote.openExternal");
    expect(markdownMessageSource).toContain("https?:");
    expect(`${appSource}${localWorkspaceSource}${notionWorkspaceSource}`).not.toContain("dangerouslySetInnerHTML");
    expect(`${appSource}${localWorkspaceSource}${notionWorkspaceSource}`).not.toContain("innerHTML");
  });

  it("reveals assistant answers progressively instead of replacing Thinking with a full response", () => {
    expect(localWorkspaceSource).toContain("revealAssistantMessage");
    expect(notionWorkspaceSource).toContain("revealAssistantMessage");
    expect(notionWorkspaceSource).toContain("answer.text.includes(\"|---\")");
    expect(notionWorkspaceSource).toContain("void revealAssistantMessage");
    expect(notionWorkspaceSource).toContain("messageId: assistantMessageId");
    expect(chatRevealSource).toContain("messageId?: string");
    expect(chatRevealSource).toContain("message.id === nextMessage.id");
    expect(chatRevealSource).toContain("splitRevealChunks");
    expect(chatRevealSource).toContain("REVEAL_INTERVAL_MS");
    expect(chatRevealSource).toContain("replaceStreamingAssistant");
    expect(chatRevealSource).toContain("window.setTimeout");
    expect(localWorkspaceSource).not.toContain('content: answer.text, sources: answer.sources || []');
    expect(notionWorkspaceSource).not.toContain('content: answer.text, sources: answer.sources || []');
    expect(notionWorkspaceSource).not.toContain("await revealAssistantMessage");
  });

  it("exposes completed-task sync controls and action previews", () => {
    expect(notionWorkspaceSource).toContain("includeCompleted");
    expect(notionWorkspaceSource).toContain("notionIncludeCompletedInput");
    expect(notionWorkspaceSource).toContain("Completed statuses are skipped by default");
    expect(notionWorkspaceSource).toContain("selected Notion schema");
    expect(notionWorkspaceSource).toContain('setFilters({ status: "", project: "", assignee: "", source: "", query: "" })');
    expect(notionWorkspaceSource).toContain("pendingActionPlan");
    expect(notionWorkspaceSource).toContain("Apply Action");
    expect(notionWorkspaceSource).toContain("Applying Notion action");
    expect(notionWorkspaceSource).toContain("await syncTasks(false)");
    expect(notionWorkspaceSource).toContain("Archive in Notion");
  });

  it("preserves Notion token profile and source management in settings", () => {
    expect(settingsWorkspaceSource).toContain("notionTokenProfilePicker");
    expect(settingsWorkspaceSource).toContain("addNotionTokenButton");
    expect(settingsWorkspaceSource).toContain("removeNotionTokenButton");
    expect(settingsWorkspaceSource).toContain("notionNewTokenNameInput");
    expect(settingsWorkspaceSource).toContain("notionNewTokenInput");
    expect(settingsWorkspaceSource).toContain("discoverNotionDatabasesButton");
    expect(settingsWorkspaceSource).toContain("notionSelectedSources");
    expect(settingsWorkspaceSource).toContain("formatNotionTokenOptionLabel");
    expect(settingsWorkspaceSource).toContain("Each token keeps its own task sources.");
  });

  it("renders SFTP sync provider settings and connection testing", () => {
    expect(settingsWorkspaceSource).toContain("syncProviderInput");
    expect(settingsWorkspaceSource).toContain("sftpHostInput");
    expect(settingsWorkspaceSource).toContain("sftpPortInput");
    expect(settingsWorkspaceSource).toContain("sftpUsernameInput");
    expect(settingsWorkspaceSource).toContain("sftpPasswordInput");
    expect(settingsWorkspaceSource).toContain("sftpPrivateKeyPathInput");
    expect(settingsWorkspaceSource).toContain("sftpRootPathInput");
    expect(settingsWorkspaceSource).toContain("sftpNotesPathInput");
    expect(settingsWorkspaceSource).toContain("testSftpConnectionButton");
    expect(settingsWorkspaceSource).toContain("window.denote.testSftpConnection");
    expect(settingsWorkspaceSource).toContain("normalizeSftpSettings");
  });

  it("retains loading, diagnostics, and update controls", () => {
    expect(appSource).toContain("runAction");
    expect(appSource).toContain("aria-busy");
    expect(appSource).toContain("status-spinner");
    expect(appSource).toContain("window.denote.getDiagnostics");
    expect(appSource).toContain("window.denote.getUpdateState");
    expect(appSource).toContain("window.denote.checkForUpdates");
    expect(appSource).toContain("window.denote.downloadUpdate");
    expect(appSource).toContain("window.denote.installUpdate");
    expect(settingsWorkspaceSource).toContain("diagnosticsText");
  });
});
