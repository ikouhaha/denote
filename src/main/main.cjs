const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");
const { autoUpdater } = require("electron-updater");
const { Client } = require("@notionhq/client");

const CONTENT_TYPES = new Set([
  "technical_note",
  "project_note",
  "reference",
  "personal_note",
  "captured_qa",
  "other"
]);
const CARD_KINDS = new Set(["knowledge", "task", "event", "reminder"]);
const CARD_STATUSES = new Set(["open", "done", "archived", "deleted"]);
const SCHEDULE_KINDS = new Set(["task", "event", "reminder"]);
const LLM_TIMEOUT_MS = 45000;
const UPDATE_STATUS = {
  IDLE: "idle",
  CHECKING: "checking",
  AVAILABLE: "available",
  NOT_AVAILABLE: "not-available",
  DOWNLOADING: "downloading",
  DOWNLOADED: "downloaded",
  ERROR: "error"
};
let updateState = {
  status: UPDATE_STATUS.IDLE,
  currentVersion: "",
  availableVersion: "",
  progress: null,
  message: "Ready to check for updates"
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "can",
  "does",
  "from",
  "how",
  "into",
  "should",
  "that",
  "the",
  "this",
  "what",
  "when",
  "where",
  "while",
  "will",
  "with",
  "work"
]);

function getCardsFilePath() {
  return path.join(app.getPath("userData"), "cards.json");
}

function getSettingsFilePath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function getLogFilePath() {
  return path.join(app.getPath("userData"), "denote.log");
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: "Denote",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
}

configureAutoUpdater();

ipcMain.handle("denote:generateDraft", async (_event, sourceText) => {
  return generateDraftWithLlm(String(sourceText ?? ""));
});

ipcMain.handle("denote:refineDraft", async (_event, payload) => {
  return refineDraftWithLlm(payload);
});

ipcMain.handle("denote:saveCard", async (_event, input) => {
  return saveCard(input);
});

ipcMain.handle("denote:deleteCard", async (_event, id) => {
  return deleteCard(String(id ?? ""));
});

ipcMain.handle("denote:updateCardStatus", async (_event, input) => {
  return updateCardStatus(String(input?.id ?? ""), String(input?.status ?? ""));
});

ipcMain.handle("denote:getAppInfo", () => {
  return {
    version: app.getVersion()
  };
});

ipcMain.handle("denote:getUpdateState", () => {
  return getUpdateState();
});

ipcMain.handle("denote:checkForUpdates", async () => {
  if (!app.isPackaged) {
    setUpdateState({
      status: UPDATE_STATUS.ERROR,
      message: "Update checks only run in packaged builds."
    });
    return getUpdateState();
  }

  setUpdateState({
    status: UPDATE_STATUS.CHECKING,
    progress: null,
    message: "Checking for updates..."
  });

  await autoUpdater.checkForUpdates();
  return getUpdateState();
});

ipcMain.handle("denote:downloadUpdate", async () => {
  if (updateState.status !== UPDATE_STATUS.AVAILABLE) {
    return getUpdateState();
  }

  setUpdateState({
    status: UPDATE_STATUS.DOWNLOADING,
    progress: null,
    message: "Downloading update..."
  });
  await autoUpdater.downloadUpdate();
  return getUpdateState();
});

ipcMain.handle("denote:installUpdate", () => {
  if (updateState.status === UPDATE_STATUS.DOWNLOADED) {
    autoUpdater.quitAndInstall();
  }
  return getUpdateState();
});

ipcMain.handle("denote:setTaskProvider", async (_event, provider) => {
  const settings = await readSettings();
  const nextProvider = provider === "notion" ? "notion" : "local";
  await saveSettings({ ...settings, taskProvider: nextProvider });
  return nextProvider;
});

ipcMain.handle("denote:getTaskProviderMetadata", async () => {
  const settings = await readSettings();
  if (settings.taskProvider !== "notion") {
    return { provider: "local" };
  }
  return readNotionMetadata(settings);
});

ipcMain.handle("denote:discoverNotionDatabases", async (_event, input) => {
  return discoverNotionDatabases(input, await readSettings());
});

ipcMain.handle("denote:listTasks", async () => {
  const settings = await readSettings();
  if (settings.taskProvider !== "notion") {
    throw new Error("Task provider is not Notion");
  }
  return listNotionTasks(settings);
});

ipcMain.handle("denote:createTask", async (_event, input) => {
  const settings = await readSettings();
  if (settings.taskProvider !== "notion") {
    return saveCard(input);
  }
  return createNotionTask(settings, input);
});

ipcMain.handle("denote:updateTaskStatus", async (_event, input) => {
  const settings = await readSettings();
  if (settings.taskProvider !== "notion") {
    return updateCardStatus(String(input?.id ?? ""), String(input?.status ?? ""));
  }
  return updateNotionTaskStatus(settings, String(input?.id ?? ""), String(input?.status ?? ""));
});

ipcMain.handle("denote:listCards", async () => {
  const store = await readStore();
  return store.cards.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
});

ipcMain.handle("denote:ask", async (_event, question) => {
  const store = await readStore();
  return answerWithLlm(question, store.cards);
});

ipcMain.handle("denote:getSettings", async () => {
  return readSettings();
});

ipcMain.handle("denote:getDiagnostics", async () => {
  return {
    userDataPath: app.getPath("userData"),
    logFilePath: getLogFilePath(),
    cardsFilePath: getCardsFilePath(),
    settingsFilePath: getSettingsFilePath()
  };
});

ipcMain.handle("denote:saveSettings", async (_event, input) => {
  return saveSettings(input);
});

ipcMain.handle("denote:seedSamples", async () => {
  const result = await ensureSampleCards();
  return { added: result.added, cards: (await readStore()).cards };
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

function configureAutoUpdater() {
  autoUpdater.autoDownload = false;

  autoUpdater.on("checking-for-update", () => {
    setUpdateState({
      status: UPDATE_STATUS.CHECKING,
      progress: null,
      message: "Checking for updates..."
    });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({
      status: UPDATE_STATUS.AVAILABLE,
      availableVersion: String(info?.version || ""),
      progress: null,
      message: `Version ${info?.version || "update"} is available.`
    });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateState({
      status: UPDATE_STATUS.NOT_AVAILABLE,
      availableVersion: "",
      progress: null,
      message: "You are up to date."
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({
      status: UPDATE_STATUS.DOWNLOADING,
      progress: Math.round(Number(progress?.percent || 0)),
      message: `Downloading update ${Math.round(Number(progress?.percent || 0))}%`
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({
      status: UPDATE_STATUS.DOWNLOADED,
      availableVersion: String(info?.version || updateState.availableVersion || ""),
      progress: 100,
      message: "Update ready to install."
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateState({
      status: UPDATE_STATUS.ERROR,
      progress: null,
      message: `Update failed: ${errorMessage(error)}`
    });
  });
}

function getUpdateState() {
  return {
    ...updateState,
    currentVersion: app.getVersion()
  };
}

function setUpdateState(nextState) {
  updateState = {
    ...updateState,
    currentVersion: app.getVersion(),
    ...nextState
  };

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("denote:updateStateChanged", getUpdateState());
  }
}

function generateDraft(sourceText) {
  const source = sourceText.trim();
  if (!source) {
    throw new Error("Source text is required");
  }

  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const title = truncate((lines[0] || source).match(/^[^.!?。！？]+/)?.[0]?.trim() || "Untitled", 80);
  const body = lines.length > 1 ? lines.slice(1).join(" ") : source;
  const summary = truncate(body.match(/[^.!?。！？]+[.!?。！？]?/)?.[0]?.trim() || source, 180);

  return {
    title,
    summary,
    project: deriveProject(lines),
    card_kind: "knowledge",
    status: "open",
    due_date: "",
    due_time: "",
    tags: deriveTags(source),
    content_type: "technical_note",
    source_text: source
  };
}

async function generateDraftWithLlm(sourceText) {
  const source = sourceText.trim();
  if (!source) {
    throw new Error("Source text is required");
  }

  const settings = await readSettings();
  requireApiKey(settings);

  const text = await callChatCompletion(settings, [
    {
      role: "system",
      content:
        "You convert messy notes into a Denote card. Return only JSON with fields: title, summary, project, card_kind, status, due_date, due_time, tags, content_type, source_text. card_kind must be one of knowledge, task, event, reminder. status must be open unless the source says it is done. due_date must be YYYY-MM-DD when the text contains a date or relative date; use the current date context from the user message to resolve words like tomorrow. due_time must be HH:MM 24-hour time or empty. content_type must be one of technical_note, project_note, reference, personal_note, captured_qa, other. tags must be an array of short lowercase strings. Preserve the original source_text exactly."
    },
    {
      role: "user",
      content: `Current date: ${currentLocalDate()}\nTimezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || "local"}\n\nSource text:\n${source}`
    }
  ]);
  const parsed = await parseLlmJsonObject(text, "generateDraft");

  return normalizeDraftPayload({ ...parsed, source_text: source }, source);
}

async function refineDraftWithLlm(payload) {
  const source = String(payload?.sourceText || payload?.currentDraft?.source_text || "").trim();
  const instruction = String(payload?.instruction || "").trim();
  if (!source) {
    throw new Error("Source text is required");
  }
  if (!instruction) {
    throw new Error("Tell AI what to change in the draft");
  }

  const currentDraft = normalizeDraftPayload(payload?.currentDraft, source);
  const settings = await readSettings();
  requireApiKey(settings);

  const text = await callChatCompletion(settings, [
    {
      role: "system",
      content:
        "You revise a Denote card draft. Return only JSON with fields: title, summary, project, card_kind, status, due_date, due_time, tags, content_type, source_text. Apply the user's instruction to the current draft. card_kind must be one of knowledge, task, event, reminder. status must be one of open, done, archived, deleted. due_date must be YYYY-MM-DD or empty; use the current date context to resolve relative date instructions. due_time must be HH:MM 24-hour time or empty. content_type must be one of technical_note, project_note, reference, personal_note, captured_qa, other. tags must be an array of short lowercase strings. Preserve source_text unless the user explicitly asks to correct it."
    },
    {
      role: "user",
      content: [
        `Current date: ${currentLocalDate()}`,
        `Original source text:\n${source}`,
        `Current draft JSON:\n${JSON.stringify(currentDraft, null, 2)}`,
        `User instruction:\n${instruction}`
      ].join("\n\n")
    }
  ]);
  const parsed = await parseLlmJsonObject(text, "refineDraft");
  return normalizeDraftPayload(parsed, source);
}

function normalizeDraftPayload(input, fallbackSourceText) {
  return {
    title: requireText(input?.title, "Title"),
    summary: requireText(input?.summary, "Summary"),
    project: normalizeProject(input?.project),
    card_kind: normalizeCardKind(input?.card_kind),
    status: normalizeCardStatus(input?.status),
    due_date: normalizeScheduleField(input?.due_date),
    due_time: normalizeScheduleField(input?.due_time),
    tags: normalizeTags(Array.isArray(input?.tags) ? input.tags : splitTags(input?.tags)),
    content_type: CONTENT_TYPES.has(input?.content_type) ? input.content_type : "technical_note",
    source_text: requireText(input?.source_text || fallbackSourceText, "Source text")
  };
}

async function saveCard(input) {
  const store = await readStore();
  const now = new Date().toISOString();
  const id = String(input?.id || crypto.randomUUID());
  const existingIndex = store.cards.findIndex((card) => card.id === id);
  const existing = existingIndex >= 0 ? store.cards[existingIndex] : undefined;
  const contentType = CONTENT_TYPES.has(input?.content_type) ? input.content_type : "technical_note";

  const card = {
    id,
    title: requireText(input?.title, "Title"),
    summary: requireText(input?.summary, "Summary"),
    project: normalizeProject(input?.project),
    card_kind: normalizeCardKind(input?.card_kind || existing?.card_kind),
    status: normalizeCardStatus(input?.status || existing?.status),
    due_date: normalizeScheduleField(input?.due_date),
    due_time: normalizeScheduleField(input?.due_time),
    tags: normalizeTags(Array.isArray(input?.tags) ? input.tags : splitTags(input?.tags)),
    content_type: contentType,
    source_text: requireText(input?.source_text, "Source text"),
    created_at: existing?.created_at || now,
    updated_at: now
  };

  if (existingIndex >= 0) {
    store.cards[existingIndex] = card;
  } else {
    store.cards.push(card);
  }

  await writeStore(store);
  return card;
}

async function deleteCard(id) {
  const store = await readStore();
  const card = store.cards.find((item) => item.id === id);
  if (!card) {
    return { deleted: false };
  }

  card.status = "deleted";
  card.updated_at = new Date().toISOString();
  await writeStore(store);
  return { deleted: true };
}

async function updateCardStatus(id, status) {
  if (!CARD_STATUSES.has(status)) {
    throw new Error("Invalid card status");
  }
  const store = await readStore();
  const card = store.cards.find((item) => item.id === id);
  if (!card) {
    return { updated: false };
  }
  card.status = status;
  card.updated_at = new Date().toISOString();
  await writeStore(store);
  return { updated: true, card };
}

async function readNotionMetadata(settings) {
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const sources = getEnabledNotionTaskSources(tokenProfile);
  const tasksDataSourceId = sources[0].id;
  const dataSource = await notion.dataSources.retrieve({ data_source_id: tasksDataSourceId });
  const metadata = validateDennisTasksSchema(dataSource.properties || {});
  const [projects, sprints, users] = await Promise.all([
    listNotionDataSourceTitles(notion, metadata.projectDataSourceId),
    listNotionDataSourceTitles(notion, metadata.sprintDataSourceId),
    listNotionUsers(notion)
  ]);
  return {
    provider: "notion",
    tokenProfileId: tokenProfile.id,
    tokenProfileName: tokenProfile.name,
    ...metadata,
    taskSources: sources,
    projects,
    sprints,
    users
  };
}

async function discoverNotionDatabases(input, settings) {
  const tokenProfile = resolveActiveNotionToken(settings, { allowMissing: true });
  const token = input?.notionToken || tokenProfile.token;
  const notion = new Client({ auth: requireText(token, "Notion integration token") });
  const dataSources = [];
  let cursor = undefined;
  do {
    const response = await notion.search({
      filter: { property: "object", value: "data_source" },
      page_size: 50,
      ...(cursor ? { start_cursor: cursor } : {})
    });
    for (const dataSource of response.results) {
      dataSources.push({
        id: dataSource.id,
        name: readNotionRichText(dataSource.title) || dataSource.url || dataSource.id,
        url: dataSource.url || ""
      });
    }
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return dataSources.sort((a, b) => a.name.localeCompare(b.name));
}

async function listNotionTasks(settings) {
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const sources = getEnabledNotionTaskSources(tokenProfile);
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const response = await notion.dataSources.query({
        data_source_id: source.id,
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }]
      });
      return response.results.map((page) => normalizeNotionTaskPageWithSource(page, source));
    })
  );
  const tasks = [];
  const failures = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      tasks.push(...result.value);
    } else {
      failures.push(errorMessage(result.reason));
    }
  }
  if (!tasks.length && failures.length) {
    throw new Error(`Notion task sources failed: ${failures.join("; ")}`);
  }
  return tasks.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

async function createNotionTask(settings, input) {
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const requestedSourceId = input?.sourceId;
  const targetSourceId = resolveNotionTargetSourceId(tokenProfile, input);
  if (!targetSourceId && !requestedSourceId) {
    throw new Error("Notion task source is required");
  }
  const response = await notion.pages.create({
    parent: { data_source_id: targetSourceId },
    properties: buildNotionPageProperties(input || {}),
    children: buildNotionTaskChildren(input?.description || input?.source_text || "")
  });
  const source = getEnabledNotionTaskSources(tokenProfile).find((item) => item.id === targetSourceId) || { id: targetSourceId, name: targetSourceId };
  return normalizeNotionTaskPageWithSource(response, source);
}

async function updateNotionTaskStatus(settings, id, status) {
  if (!id || !status) {
    throw new Error("Task id and status are required");
  }
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const response = await notion.pages.update({
    page_id: id,
    properties: {
      Status: { status: { name: status } }
    }
  });
  return { updated: true, card: normalizeNotionTaskPage(response) };
}

function createNotionClientForToken(tokenProfile) {
  return new Client({ auth: requireText(tokenProfile.token, "Notion integration token") });
}

function resolveActiveNotionToken(settings, options = {}) {
  const tokenProfiles = normalizeNotionTokens(settings.notionTokens ?? settings.notionWorkspaces, settings.notionToken, settings.notionTaskSources);
  const activeId = String(settings.activeNotionTokenId || settings.activeNotionWorkspaceId || "").trim();
  const tokenProfile = tokenProfiles.find((item) => item.id === activeId) || tokenProfiles[0];
  if (tokenProfile) {
    return tokenProfile;
  }
  if (options.allowMissing) {
    return {
      id: "",
      name: "",
      token: String(settings.notionToken || "").trim(),
      taskSources: normalizeNotionTaskSources(settings.notionTaskSources, settings.notionTasksDatabaseId)
    };
  }
  throw new Error("Notion token profile is required");
}

function getEnabledNotionTaskSources(tokenProfile) {
  const sources = normalizeNotionTaskSources(tokenProfile.taskSources).filter((source) => source.enabled);
  if (!sources.length) {
    throw new Error("Notion Tasks data source ID is required");
  }
  return sources;
}

function resolveNotionTargetSourceId(tokenProfile, input) {
  const requestedSourceId = String(input?.sourceId || "").trim();
  const sources = getEnabledNotionTaskSources(tokenProfile);
  if (requestedSourceId) {
    if (!sources.some((source) => source.id === requestedSourceId)) {
      throw new Error("Selected Notion task source is not enabled");
    }
    return requestedSourceId;
  }
  if (sources.length === 1) {
    return sources[0].id;
  }
  throw new Error("Notion task source is required");
}

async function listNotionDataSourceTitles(notion, dataSourceId) {
  const response = await notion.dataSources.query({ data_source_id: dataSourceId });
  return response.results.map((page) => ({
    id: page.id,
    name: readNotionFirstTitle(page.properties || {}) || page.url || page.id,
    url: page.url || ""
  }));
}

async function listNotionUsers(notion) {
  const response = await notion.users.list({});
  return response.results
    .filter((user) => user.type === "person" && user.name)
    .map((user) => ({
      id: user.id,
      name: user.name,
      email: user.person?.email || ""
    }));
}

function validateDennisTasksSchema(schema) {
  const required = [
    ["Task name", "title"],
    ["Status", "status"],
    ["Assign", "people"],
    ["Due", "date"],
    ["Priority", "select"],
    ["Task Type", "select"],
    ["Task Receive Date", "date"],
    ["Project", "relation"],
    ["Sprint", "relation"],
    ["Number", "number"],
    ["ID", "unique_id"]
  ];
  for (const [name, type] of required) {
    if (!schema[name]) {
      throw new Error(`Missing Notion Tasks column: ${name}`);
    }
    if (schema[name].type !== type) {
      throw new Error(`Notion Tasks column ${name} must be type ${type}`);
    }
  }
  const projectDataSourceId = schema.Project.relation?.data_source_id;
  const sprintDataSourceId = schema.Sprint.relation?.data_source_id;
  if (!projectDataSourceId || !sprintDataSourceId) {
    throw new Error("Notion relation columns must point to data sources");
  }
  return {
    statusOptions: readNotionSchemaOptions(schema.Status, "status", "Status"),
    priorityOptions: readNotionSchemaOptions(schema.Priority, "select", "Priority"),
    taskTypeOptions: readNotionSchemaOptions(schema["Task Type"], "select", "Task Type"),
    projectDataSourceId,
    sprintDataSourceId
  };
}

function readNotionSchemaOptions(property, kind, name) {
  const options = property?.[kind]?.options?.map((option) => String(option.name || "").trim()).filter(Boolean);
  if (!options?.length) {
    throw new Error(`Notion Tasks column ${name} has no ${kind} options`);
  }
  return options;
}

function buildNotionPageProperties(input) {
  const properties = {
    "Task name": { title: [{ text: { content: requireText(input.title, "Task name") } }] }
  };
  if (input.status) properties.Status = { status: { name: input.status } };
  if (input.priority) properties.Priority = { select: { name: input.priority } };
  if (input.taskType) properties["Task Type"] = { select: { name: input.taskType } };
  if (Array.isArray(input.assigneeIds) && input.assigneeIds.length > 0) {
    properties.Assign = { people: input.assigneeIds.map((id) => ({ id })) };
  }
  if (input.dueDate) properties.Due = { date: { start: input.dueDate } };
  if (input.taskReceiveDate) properties["Task Receive Date"] = { date: { start: input.taskReceiveDate } };
  if (input.projectId) properties.Project = { relation: [{ id: input.projectId }] };
  if (input.sprintId) properties.Sprint = { relation: [{ id: input.sprintId }] };
  return properties;
}

function buildNotionTaskChildren(description) {
  const content = String(description || "").trim();
  if (!content) {
    return [];
  }
  return [
    {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: truncate(content, 1800) } }]
      }
    }
  ];
}

function normalizeNotionTaskPage(page) {
  const properties = page.properties || {};
  const title = readNotionTitle(properties["Task name"]);
  return {
    id: page.id || "",
    provider: "notion",
    sourceId: "",
    sourceName: "",
    title,
    summary: page.url || "",
    status: properties.Status?.status?.name || "",
    priority: properties.Priority?.select?.name || "",
    taskType: properties["Task Type"]?.select?.name || "",
    assignees: (properties.Assign?.people || []).map((person) => ({ id: person.id, name: person.name || "" })),
    dueDate: properties.Due?.date?.start || "",
    taskReceiveDate: properties["Task Receive Date"]?.date?.start || "",
    projectIds: (properties.Project?.relation || []).map((relation) => relation.id),
    sprintIds: (properties.Sprint?.relation || []).map((relation) => relation.id),
    number: typeof properties.Number?.number === "number" ? properties.Number.number : null,
    notionId: formatNotionUniqueId(properties.ID?.unique_id),
    url: page.url || "",
    updated_at: page.last_edited_time || new Date().toISOString(),
    tags: [],
    raw: page
  };
}

function normalizeNotionTaskPageWithSource(page, source) {
  return {
    ...normalizeNotionTaskPage(page),
    sourceId: source.id || "",
    sourceName: source.name || source.id || ""
  };
}

function readNotionFirstTitle(properties) {
  for (const property of Object.values(properties)) {
    if (property?.type === "title") {
      return readNotionTitle(property);
    }
  }
  return "";
}

function readNotionTitle(property) {
  return (property?.title || []).map((item) => item.plain_text || "").join("").trim();
}

function readNotionRichText(items) {
  return (items || []).map((item) => item.plain_text || "").join("").trim();
}

function formatNotionUniqueId(uniqueId) {
  if (!uniqueId || typeof uniqueId.number !== "number") {
    return "";
  }
  return uniqueId.prefix ? `${uniqueId.prefix}-${uniqueId.number}` : String(uniqueId.number);
}

async function readStore() {
  try {
    const raw = await fs.readFile(getCardsFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    return { cards: Array.isArray(parsed.cards) ? parsed.cards.map(normalizeStoredCard) : [] };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { cards: [] };
    }
    throw error;
  }
}

async function writeStore(store) {
  await fs.mkdir(path.dirname(getCardsFilePath()), { recursive: true });
  await fs.writeFile(getCardsFilePath(), JSON.stringify(store, null, 2), "utf8");
}

async function readSettings() {
  try {
    const raw = await fs.readFile(getSettingsFilePath(), "utf8");
    return applySafeCodexDefaults(normalizeSettings(JSON.parse(raw)));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return readDefaultSettings();
    }
    throw error;
  }
}

async function saveSettings(input) {
  const settings = normalizeSettings(input || {});
  await fs.mkdir(path.dirname(getSettingsFilePath()), { recursive: true });
  await fs.writeFile(getSettingsFilePath(), JSON.stringify(settings, null, 2), "utf8");
  return settings;
}

async function answerWithLlm(input, cards) {
  const question = normalizeQuestionInput(input).trim();
  if (!question) {
    throw new Error("Question is required");
  }

  const settings = await readSettings();
  requireApiKey(settings);

  const visibleCards = cards.filter((card) => normalizeCardStatus(card.status) !== "deleted");
  const contextCards = selectContextCards(question, visibleCards);
  const contextText =
    contextCards.length > 0
      ? contextCards.map(formatContextCard).join("\n\n---\n\n")
      : "No saved cards matched. Answer normally, and say clearly when the saved library has no supporting evidence.";
  const text = await callChatCompletion(settings, [
    {
      role: "system",
      content:
        "You are Denote, an LLM knowledge assistant. Answer the user directly in concise Markdown. Use headings, bullet lists, tables, blockquotes, inline code, or fenced code blocks when they improve clarity. Use saved card context when relevant, cite card titles in the answer, and be explicit when the saved library does not contain enough evidence. Do not invent database facts not present in the provided context."
    },
    {
      role: "user",
      content: `Current date: ${currentLocalDate()}\nTimezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone || "local"}\n\nQuestion:\n${question}\n\nSaved card context:\n${contextText}`
    }
  ]);

  return {
    status: "answered",
    text,
    sources: contextCards.map((card) => ({
      card_id: card.id,
      title: card.title,
      excerpt: truncate(card.source_text, 360)
    }))
  };
}

async function ensureSampleCards() {
  const store = await readStore();
  const existingTitles = new Set(store.cards.map((card) => card.title));
  let added = 0;

  for (const sample of SAMPLE_CARDS) {
    if (!existingTitles.has(sample.title)) {
      store.cards.push(toSavedSample(sample));
      existingTitles.add(sample.title);
      added += 1;
    }
  }

  if (added > 0) {
    await writeStore(store);
  }

  return { added };
}

function toSavedSample(sample) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: sample.title,
    summary: sample.summary,
    project: normalizeProject(sample.project),
    card_kind: "knowledge",
    status: "open",
    due_date: "",
    due_time: "",
    tags: normalizeTags(sample.tags),
    content_type: CONTENT_TYPES.has(sample.content_type) ? sample.content_type : "reference",
    source_text: sample.source_text,
    created_at: now,
    updated_at: now
  };
}

function normalizeQuestionInput(input) {
  if (typeof input === "string") {
    return input;
  }
  const current = String(input?.question || "");
  const history = Array.isArray(input?.history) ? input.history : [];
  const recentUserTurns = history
    .filter((message) => message && message.role === "user")
    .slice(-3)
    .map((message) => String(message.content || ""))
    .filter(Boolean);
  return [...recentUserTurns, current].join("\n");
}

function scoreCard(terms, card) {
  const haystack =
    `${card.title} ${card.summary} ${card.project || ""} ${(card.tags || []).join(" ")} ${card.source_text}`.toLowerCase();
  return terms.reduce((score, term) => (haystack.includes(term) ? score + 1 : score), 0);
}

function selectContextCards(question, cards) {
  const terms = tokenize(question).filter((term) => !STOP_WORDS.has(term));
  const scheduleCards = isScheduleQuestion(question)
    ? cards.filter((card) => SCHEDULE_KINDS.has(normalizeCardKind(card.card_kind))).sort(compareScheduleCards).slice(0, 8)
    : [];
  if (terms.length === 0) {
    return mergeCards(scheduleCards, cards.slice(0, 6));
  }

  const ranked = cards
    .map((card) => ({ card, score: scoreCard(terms, card) }))
    .sort((a, b) => b.score - a.score || b.card.updated_at.localeCompare(a.card.updated_at));
  const hits = ranked.filter((hit) => hit.score > 0).slice(0, 8).map((hit) => hit.card);
  return mergeCards(scheduleCards, hits.length > 0 ? hits : cards.slice(0, 6));
}

function isScheduleQuestion(question) {
  return /today|tomorrow|upcoming|schedule|calendar|due|task|event|reminder|日程|行程|待辦|任务|任務|今天|明天|後天|下周|下週/i.test(
    question
  );
}

function compareScheduleCards(a, b) {
  const aDue = formatDue(a) || "9999-12-31 23:59";
  const bDue = formatDue(b) || "9999-12-31 23:59";
  return aDue.localeCompare(bDue) || b.updated_at.localeCompare(a.updated_at);
}

function mergeCards(primary, secondary) {
  const seen = new Set();
  const merged = [];
  for (const card of [...primary, ...secondary]) {
    if (!seen.has(card.id)) {
      seen.add(card.id);
      merged.push(card);
    }
  }
  return merged.slice(0, 10);
}

function formatContextCard(card) {
  return [
    `Title: ${card.title}`,
    `Project: ${card.project || "No project"}`,
    `Kind: ${card.card_kind || "knowledge"}`,
    `Status: ${card.status || "open"}`,
    `Due: ${formatDue(card) || "No due date"}`,
    `Summary: ${card.summary}`,
    `Tags: ${(card.tags || []).join(", ")}`,
    `Source:\n${truncate(card.source_text, 1600)}`
  ].join("\n");
}

async function callChatCompletion(settings, messages) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const endpoint = `${settings.baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  await writeLog("info", "llm.request.start", {
    requestId,
    endpoint,
    model: settings.chatModel,
    messageCount: messages.length
  });

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.chatModel,
        messages,
        temperature: 0.2
      })
    });
  } catch (error) {
    const timeoutError = error?.name === "AbortError";
    await writeLog("error", timeoutError ? "llm.request.timeout" : "llm.request.error", {
      requestId,
      elapsedMs: Date.now() - startedAt,
      error: timeoutError ? `LLM request timed out after ${LLM_TIMEOUT_MS}ms` : errorMessage(error)
    });
    throw new Error(timeoutError ? "LLM request timed out. Check provider connectivity and settings." : `LLM request failed: ${errorMessage(error)}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    await writeLog("error", "llm.response.error", {
      requestId,
      elapsedMs: Date.now() - startedAt,
      status: response.status,
      body: truncate(errorText, 500)
    });
    throw new Error(`LLM request failed (${response.status}): ${truncate(errorText, 240)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    await writeLog("error", "llm.response.empty", {
      requestId,
      elapsedMs: Date.now() - startedAt
    });
    throw new Error("LLM response did not contain message content");
  }
  await writeLog("info", "llm.response.success", {
    requestId,
    elapsedMs: Date.now() - startedAt,
    status: response.status,
    contentLength: String(content).length
  });
  return String(content).trim();
}

function requireApiKey(settings) {
  if (!settings.apiKey) {
    throw new Error("Set an API key in Settings before using LLM features.");
  }
}

function parseJsonObject(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("LLM did not return JSON for the card draft");
  }
  return JSON.parse(raw.slice(start, end + 1));
}

async function parseLlmJsonObject(text, operation) {
  try {
    return parseJsonObject(text);
  } catch (error) {
    await writeLog("error", "llm.response.invalid_json", {
      operation,
      contentLength: String(text || "").length,
      responseSnippet: truncate(String(text || ""), 500),
      parserError: errorMessage(error)
    });
    throw error;
  }
}

function selectExcerpt(terms, sourceText) {
  const sentences = sourceText.match(/[^.!?。！？]+[.!?。！？]?/g) || [sourceText];
  const scored = sentences
    .map((sentence) => ({
      sentence: sentence.trim(),
      score: terms.reduce((score, term) => (sentence.toLowerCase().includes(term) ? score + 1 : score), 0)
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best) {
    return sourceText.trim();
  }
  const index = sentences.findIndex((sentence) => sentence.trim() === best.sentence);
  const next = sentences[index + 1]?.trim();
  return next ? `${best.sentence} ${next}`.trim() : best.sentence;
}

function deriveTags(sourceText) {
  const counts = new Map();
  for (const word of tokenize(sourceText)) {
    if (!STOP_WORDS.has(word)) {
      counts.set(word, (counts.get(word) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([word]) => word);
}

function deriveProject(lines) {
  const firstLine = lines[0] || "";
  return firstLine.match(/^([A-Z][A-Z0-9_-]{1,30})\s*[:：]/)?.[1] || "";
}

function tokenize(value) {
  return String(value).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
}

function normalizeTags(tags) {
  return [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))];
}

function normalizeProject(value) {
  return String(value || "").trim();
}

function normalizeStoredCard(card) {
  return {
    ...card,
    project: normalizeProject(card.project),
    card_kind: normalizeCardKind(card.card_kind),
    status: normalizeCardStatus(card.status),
    due_date: normalizeScheduleField(card.due_date),
    due_time: normalizeScheduleField(card.due_time)
  };
}

function normalizeCardKind(value) {
  return CARD_KINDS.has(value) ? value : "knowledge";
}

function normalizeCardStatus(value) {
  return CARD_STATUSES.has(value) ? value : "open";
}

function normalizeScheduleField(value) {
  return String(value || "").trim();
}

function formatDue(card) {
  const date = normalizeScheduleField(card.due_date);
  const time = normalizeScheduleField(card.due_time);
  return [date, time].filter(Boolean).join(" ");
}

function currentLocalDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function requireText(value, label) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required`);
  }
  return text;
}

function truncate(value, maxLength) {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}...`;
}

async function writeLog(level, event, details = {}) {
  try {
    await fs.mkdir(path.dirname(getLogFilePath()), { recursive: true });
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...details
    };
    await fs.appendFile(getLogFilePath(), `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Logging must never break the app flow.
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function normalizeSettings(input) {
  const notionTasksDatabaseId = String(input.notionTasksDatabaseId || "").trim();
  const notionTaskSources = normalizeNotionTaskSources(input.notionTaskSources, notionTasksDatabaseId);
  const notionToken = String(input.notionToken || "").trim();
  const notionTokens = normalizeNotionTokens(input.notionTokens ?? input.notionWorkspaces, notionToken, notionTaskSources);
  const requestedTokenId = String(input.activeNotionTokenId || input.activeNotionWorkspaceId || "").trim();
  const activeNotionTokenId = notionTokens.some((tokenProfile) => tokenProfile.id === requestedTokenId)
    ? requestedTokenId
    : notionTokens[0]?.id || "";
  return {
    baseUrl: String(input.baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, ""),
    apiKey: String(input.apiKey || "").trim(),
    chatModel: String(input.chatModel || DEFAULT_SETTINGS.chatModel).trim(),
    embeddingModel: String(input.embeddingModel || DEFAULT_SETTINGS.embeddingModel).trim(),
    taskProvider: input.taskProvider === "notion" ? "notion" : "local",
    notionToken,
    notionTasksDatabaseId,
    notionTaskSources,
    activeNotionTokenId,
    notionTokens
  };
}

function normalizeNotionTokens(input, legacyToken = "", legacyTaskSources = []) {
  const tokenProfiles = Array.isArray(input) ? input : [];
  const seen = new Set();
  const normalized = [];
  for (const tokenProfile of tokenProfiles) {
    const id = String(tokenProfile?.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      name: String(tokenProfile?.name || "").trim() || id,
      token: String(tokenProfile?.token || "").trim(),
      taskSources: normalizeNotionTaskSources(tokenProfile?.taskSources)
    });
  }
  if (normalized.length === 0 && legacyToken) {
    normalized.push({
      id: "notion-token-1",
      name: "Notion token 1",
      token: legacyToken,
      taskSources: legacyTaskSources
    });
  }
  return normalized;
}

function normalizeNotionTaskSources(input, legacySourceId = "") {
  const sources = Array.isArray(input) ? input : [];
  const seen = new Set();
  const normalized = [];
  for (const source of sources) {
    const id = String(source?.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      name: String(source?.name || "").trim() || id,
      enabled: source?.enabled !== false
    });
  }
  const legacyId = String(legacySourceId || "").trim();
  if (legacyId && normalized.length === 0 && !seen.has(legacyId)) {
    normalized.unshift({ id: legacyId, name: legacyId, enabled: true });
  }
  return normalized;
}

async function readDefaultSettings() {
  const codexDefaults = await readCodexProviderDefaults();
  return normalizeSettings({
    ...DEFAULT_SETTINGS,
    ...codexDefaults,
    apiKey: ""
  });
}

async function applySafeCodexDefaults(settings) {
  if (
    settings.apiKey ||
    settings.baseUrl !== DEFAULT_SETTINGS.baseUrl ||
    settings.chatModel !== DEFAULT_SETTINGS.chatModel
  ) {
    return settings;
  }

  const codexDefaults = await readCodexProviderDefaults();
  if (!codexDefaults.baseUrl && !codexDefaults.chatModel) {
    return settings;
  }

  return normalizeSettings({
    ...settings,
    ...codexDefaults,
    apiKey: ""
  });
}

async function readCodexProviderDefaults() {
  try {
    const raw = await fs.readFile(path.join(os.homedir(), ".codex", "config.toml"), "utf8");
    const provider = readTomlString(raw, "model_provider");
    const model = readTomlString(raw, "model");
    const baseUrl = provider ? readTomlSectionString(raw, `model_providers.${provider}`, "base_url") : undefined;
    return {
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { chatModel: model } : {})
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function readTomlString(raw, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escapedKey}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1];
}

function readTomlSectionString(raw, section, key) {
  const lines = raw.split(/\r?\n/);
  let inSection = false;
  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inSection = sectionMatch[1] === section;
      continue;
    }
    if (inSection) {
      const value = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`));
      if (value) {
        return value[1];
      }
    }
  }
  return undefined;
}

const DEFAULT_SETTINGS = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  chatModel: "gpt-4.1-mini",
  embeddingModel: "text-embedding-3-small",
  taskProvider: "local",
  notionToken: "",
  notionTasksDatabaseId: "",
  notionTaskSources: [],
  activeNotionTokenId: "",
  notionTokens: []
};

const SAMPLE_CARDS = [
  {
    title: "QVAT support case: wholesale invoice mismatch",
    summary: "When a wholesale order is closed but the pending header is missing, rebuild the OS invoice source for the target invoice and rerun extraction before marking it manual.",
    tags: ["qvat", "support-case", "wholesale", "invoice"],
    content_type: "reference",
    source_text:
      "Support case: wholesale invoice mismatch. If order status is close, rebuild QVAT_AR_OS_INVOICE_SOURCE for the specified invoice number, run SP_EXTRACT_OS_INVOICES before deleting unfinished records, then update QVAT_AR_OS_PENDING_HEADER so DATA_SOURCE is MANUAL for that invoice. Final check: QVAT_AR_OS_PENDING_HEADER should contain the invoice."
  },
  {
    title: "QVAT support case: RPT08 amount mismatch",
    summary: "For RPT08 special invoice amount mismatches, compare grouping dates because the user may have downloaded only one grouping date.",
    tags: ["qvat", "support-case", "rpt08", "invoice"],
    content_type: "reference",
    source_text:
      "Support case: RPT08 special invoice amount differs from the actual issued invoice amount. First inspect QVAT_INTERNAL_SOURCE_DATA_RETOUCH GROUPING_DATETIME. There may be multiple grouping dates while the user downloaded only one date. Sum TOTAL_AMOUNT_WITH_MARKUP, row count, discount amount, and discount VAT amount over the relevant GROUPING_DATETIME range to reconcile the report total."
  },
  {
    title: "QVAT support case: JE regeneration",
    summary: "If a generated JE record used an amount-difference rule incorrectly, regenerate before Oracle upload and avoid generating JE for unmatched rows.",
    tags: ["qvat", "support-case", "je", "oracle"],
    content_type: "reference",
    source_text:
      "Support case: QVAT JE has an error and needs regeneration. The generated JE record may have used AMOUNT DIFFERENCE and a 5-series rule. If the JE has not been uploaded to Oracle, set the relevant generated flag before unmatch, or regenerate JE after unmatch. Unmatched JE rows should not be generated. The support procedure referenced is SP_QVAT_SUPPORT_REGEN_JE."
  },
  {
    title: "QVAT support case: wholesale manual split",
    summary: "For manual wholesale invoice split, stage split rows, execute the split support procedure, then reconcile header and group totals before committing.",
    tags: ["qvat", "support-case", "wholesale", "split"],
    content_type: "reference",
    source_text:
      "Support case: wholesale manual split invoice. Inspect QVAT_INTERNAL_INVOICE_PENDING and QVAT_INTERNAL_SOURCE_DATA_GROUP for the request batch. Clear related Bawang detail/header rows for the pending invoice, stage split quantities in QVAT_SPLIT_RED_INVOICE, then execute SP_QVAT_SUPPORT_SPLIT_WHOLESALE_PENDING_INVOICE. Check SUM(TOTAL_AMOUNT_WITH_MARKUP), COUNT, TOTAL_TAX_AMOUNT, and VAT_AMOUNT_ROUNDED across original and new headers/groups. If only tax or markup differs by a small rounding amount, adjust the affected group before commit."
  }
];
