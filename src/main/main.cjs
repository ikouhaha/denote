const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, ipcMain, net, protocol, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { Client } = require("@notionhq/client");
const { answerNotionMetadataQuestion } = require("../providers/notionAsk.cjs");

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
const DEFAULT_COMPLETED_NOTION_STATUSES = ["UAT", "Done", "Archived"];
const NOTION_TASK_CACHE_TTL_MS = 60000;
const RENDERER_PROTOCOL = "denote";
const RENDERER_HOST = "app";
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

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_PROTOCOL,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
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

  mainWindow.loadURL(`${RENDERER_PROTOCOL}://${RENDERER_HOST}/index.html`);
}

function registerRendererProtocol() {
  protocol.handle(RENDERER_PROTOCOL, (request) => {
    const url = new URL(request.url);
    if (url.host !== RENDERER_HOST) {
      return new Response("Unknown renderer host", { status: 404 });
    }
    const rendererRoot = path.resolve(__dirname, "../renderer");
    const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = path.resolve(rendererRoot, `.${requestedPath}`);
    const relativePath = path.relative(rendererRoot, filePath);
    const isSafe = relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
    if (!isSafe) {
      return new Response("Invalid renderer path", { status: 400 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });
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

ipcMain.handle("denote:openExternal", async (_event, url) => {
  const target = String(url || "").trim();
  if (!target || !/^https?:\/\//i.test(target)) {
    throw new Error("External URL is required");
  }
  await shell.openExternal(target);
  return { opened: true };
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

ipcMain.handle("denote:listTasks", async (_event, input = {}) => {
  const settings = await readSettings();
  if (settings.taskProvider !== "notion") {
    throw new Error("Task provider is not Notion");
  }
  return listNotionTasks(settings, input);
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

ipcMain.handle("denote:generateNotionTaskDraft", async (_event, input) => {
  return generateNotionTaskDraftWithLlm(await readSettings(), input);
});

ipcMain.handle("denote:getNotionTaskDetail", async (_event, input) => {
  return getNotionTaskDetail(await readSettings(), input);
});

ipcMain.handle("denote:askNotion", async (_event, input) => {
  return answerNotionWithLlm(await readSettings(), input);
});

ipcMain.handle("denote:applyNotionAction", async (_event, input) => {
  return applyNotionAction(await readSettings(), input);
});

ipcMain.handle("denote:archiveNotionTask", async (_event, input) => {
  return archiveNotionTask(await readSettings(), input);
});

ipcMain.handle("denote:syncNotionTasks", async (_event, input = {}) => {
  return syncNotionTasks(await readSettings(), input);
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

ipcMain.handle("denote:testSftpConnection", async (_event, input = {}) => {
  const settings = await readSettings();
  const sftpSettings = normalizeSftpSettings({ ...settings.sftp, ...input });
  return testSftpConnection(sftpSettings);
});

ipcMain.handle("denote:seedSamples", async () => {
  const result = await ensureSampleCards();
  return { added: result.added, cards: (await readStore()).cards };
});

app.whenReady().then(() => {
  registerRendererProtocol();
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
    metadata.projectDataSourceId ? listNotionDataSourceTitles(notion, metadata.projectDataSourceId) : [],
    metadata.sprintDataSourceId ? listNotionDataSourceTitles(notion, metadata.sprintDataSourceId) : [],
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

async function listNotionTasks(settings, options = {}) {
  const cacheKey = getNotionTaskCacheKey(settings, options);
  const cached = notionTaskCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < NOTION_TASK_CACHE_TTL_MS && !options.forceRefresh) {
    return cached.tasks;
  }
  const tasks = await fetchNotionTasks(settings, options);
  notionTaskCache.set(cacheKey, { loadedAt: Date.now(), tasks });
  return tasks;
}

async function syncNotionTasks(settings, options = {}) {
  const tasks = await fetchNotionTasks(settings, { ...options, forceRefresh: true });
  notionTaskCache.set(getNotionTaskCacheKey(settings, options), { loadedAt: Date.now(), tasks });
  return {
    syncedAt: new Date().toISOString(),
    tasks
  };
}

async function fetchNotionTasks(settings, options = {}) {
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const sources = getEnabledNotionTaskSources(tokenProfile);
  const includeCompleted = Boolean(options.includeCompleted);
  const results = await Promise.allSettled(
    sources.map(async (source) => {
      const dataSource = await notion.dataSources.retrieve({ data_source_id: source.id });
      const resolvedSource = {
        ...source,
        name: readNotionRichText(dataSource.title) || source.name || source.id
      };
      const metadata = validateDennisTasksSchema(dataSource.properties || {});
      const pages = await queryAllNotionDataSourcePages(notion, {
        data_source_id: source.id,
        ...buildNotionTaskQueryFilter(metadata, includeCompleted),
        sorts: [{ timestamp: "last_edited_time", direction: "descending" }]
      });
      const tasks = pages.map((page) => normalizeNotionTaskPageWithSource(page, resolvedSource, metadata.propertyNames));
      return enrichNotionTasksWithRelationNames(notion, tasks, metadata);
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

function getNotionTaskCacheKey(settings, options = {}) {
  const tokenProfile = resolveActiveNotionToken(settings);
  return JSON.stringify({
    tokenProfileId: tokenProfile.id,
    sourceIds: getEnabledNotionTaskSources(tokenProfile).map((source) => source.id),
    includeCompleted: Boolean(options.includeCompleted)
  });
}

function buildNotionTaskQueryFilter(metadata, includeCompleted) {
  if (includeCompleted || !metadata.propertyNames.status) {
    return {};
  }
  return {
    filter: {
      and: DEFAULT_COMPLETED_NOTION_STATUSES.map((status) => ({
        property: metadata.propertyNames.status,
        status: { does_not_equal: status }
      }))
    }
  };
}

async function createNotionTask(settings, input) {
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const requestedSourceId = input?.sourceId;
  const targetSourceId = resolveNotionTargetSourceId(tokenProfile, input);
  if (!targetSourceId && !requestedSourceId) {
    throw new Error("Notion task source is required");
  }
  const dataSource = await notion.dataSources.retrieve({ data_source_id: targetSourceId });
  const metadata = validateDennisTasksSchema(dataSource.properties || {});
  const response = await notion.pages.create({
    parent: { data_source_id: targetSourceId },
    properties: buildNotionPageProperties(input || {}, metadata.propertyNames),
    children: buildNotionTaskChildren(input?.description || input?.source_text || "")
  });
  const source = getEnabledNotionTaskSources(tokenProfile).find((item) => item.id === targetSourceId) || { id: targetSourceId, name: targetSourceId };
  return normalizeNotionTaskPageWithSource(response, source, metadata.propertyNames);
}

async function updateNotionTaskStatus(settings, id, status) {
  if (!id || !status) {
    throw new Error("Task id and status are required");
  }
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const source = await resolveNotionSourceForTask(settings, id);
  const dataSource = await notion.dataSources.retrieve({ data_source_id: source.id });
  const metadata = validateDennisTasksSchema(dataSource.properties || {});
  const response = await notion.pages.update({
    page_id: id,
    properties: buildNotionStatusProperties(status, metadata.propertyNames)
  });
  return { updated: true, card: normalizeNotionTaskPage(response, metadata.propertyNames) };
}

async function archiveNotionTask(settings, input) {
  const taskId = requireText(input?.taskId || input?.id, "Task id");
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  await notion.pages.update({ page_id: taskId, archived: true });
  invalidateNotionCaches(taskId);
  return { archived: true, taskId };
}

async function getNotionTaskDetail(settings, input) {
  const taskId = requireText(input?.taskId || input?.id, "Task id");
  const updatedAt = String(input?.updated_at || input?.updatedAt || "");
  const cacheKey = `${resolveActiveNotionToken(settings).id}:${taskId}:${updatedAt}`;
  const cached = notionDetailCache.get(cacheKey);
  if (cached && !input?.forceRefresh) {
    return cached;
  }
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const [page, blocks, comments] = await Promise.all([
    notion.pages.retrieve({ page_id: taskId }),
    readNotionBlockChildren(notion, taskId),
    readNotionComments(notion, taskId)
  ]);
  const detail = {
    task: normalizeNotionTaskPage(page),
    blocks,
    comments,
    bodyText: blocks.map((block) => block.text).filter(Boolean).join("\n"),
    commentText: comments.map((comment) => comment.text).filter(Boolean).join("\n"),
    loadedAt: new Date().toISOString()
  };
  notionDetailCache.set(cacheKey, detail);
  return detail;
}

async function readNotionBlockChildren(notion, blockId) {
  const blocks = [];
  let cursor = undefined;
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    });
    blocks.push(...response.results.map(normalizeNotionBlockForContext));
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

async function readNotionComments(notion, blockId) {
  const comments = [];
  let cursor = undefined;
  do {
    const response = await notion.comments.list({
      block_id: blockId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    });
    comments.push(
      ...response.results.map((comment) => ({
        id: comment.id || "",
        createdTime: comment.created_time || "",
        text: readNotionRichText(comment.rich_text)
      }))
    );
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return comments;
}

function normalizeNotionBlockForContext(block) {
  const type = block?.type || "";
  const value = block?.[type] || {};
  return {
    id: block?.id || "",
    type,
    hasChildren: Boolean(block?.has_children),
    text: readNotionRichText(value.rich_text || value.caption || [])
  };
}

async function queryAllNotionDataSourcePages(notion, query) {
  const pages = [];
  let cursor = undefined;
  do {
    const response = await notion.dataSources.query({
      ...query,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {})
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return pages;
}

async function enrichNotionTasksWithRelationNames(notion, tasks, metadata) {
  const [projectNames, sprintNames] = await Promise.all([
    metadata.projectDataSourceId ? readNotionRelationNameMap(notion, metadata.projectDataSourceId) : new Map(),
    metadata.sprintDataSourceId ? readNotionRelationNameMap(notion, metadata.sprintDataSourceId) : new Map()
  ]);
  return tasks.map((task) => ({
    ...task,
    projectNames: task.projectIds.map((id) => projectNames.get(id)).filter(Boolean),
    sprintNames: task.sprintIds.map((id) => sprintNames.get(id)).filter(Boolean)
  }));
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
  const pages = await queryAllNotionDataSourcePages(notion, { data_source_id: dataSourceId });
  return pages.map((page) => ({
    id: page.id,
    name: readNotionFirstTitle(page.properties || {}) || page.url || page.id,
    url: page.url || ""
  }));
}

async function readNotionRelationNameMap(notion, dataSourceId) {
  const rows = await listNotionDataSourceTitles(notion, dataSourceId);
  return new Map(rows.map((row) => [row.id, row.name]));
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
  const propertyNames = inferNotionTaskPropertyNames(schema);
  if (!propertyNames.title) {
    throw new Error("Notion Tasks source must have a title column");
  }
  if (!propertyNames.status) {
    throw new Error("Notion Tasks source must have a status column");
  }
  const projectDataSourceId = propertyNames.project ? schema[propertyNames.project]?.relation?.data_source_id || "" : "";
  const sprintDataSourceId = propertyNames.sprint ? schema[propertyNames.sprint]?.relation?.data_source_id || "" : "";
  return {
    statusOptions: readNotionSchemaOptions(schema[propertyNames.status], "status"),
    priorityOptions: propertyNames.priority ? readNotionSchemaOptions(schema[propertyNames.priority], "select") : [],
    taskTypeOptions: propertyNames.taskType ? readNotionSchemaOptions(schema[propertyNames.taskType], "select") : [],
    projectDataSourceId,
    sprintDataSourceId,
    propertyNames
  };
}

function readNotionSchemaOptions(property, kind) {
  const options = property?.[kind]?.options?.map((option) => String(option.name || "").trim()).filter(Boolean);
  return options || [];
}

function buildNotionPageProperties(input, propertyNames = defaultNotionTaskPropertyNames()) {
  const properties = {
    [propertyNames.title]: { title: [{ text: { content: requireText(input.title, "Task name") } }] }
  };
  if (input.status && propertyNames.status) properties[propertyNames.status] = { status: { name: input.status } };
  if (input.priority && propertyNames.priority) properties[propertyNames.priority] = { select: { name: input.priority } };
  if (input.taskType && propertyNames.taskType) properties[propertyNames.taskType] = { select: { name: input.taskType } };
  if (Array.isArray(input.assigneeIds) && input.assigneeIds.length > 0 && propertyNames.assignee) {
    properties[propertyNames.assignee] = { people: input.assigneeIds.map((id) => ({ id })) };
  }
  if (input.dueDate && propertyNames.due) properties[propertyNames.due] = { date: { start: input.dueDate } };
  if (input.taskReceiveDate && propertyNames.taskReceiveDate) properties[propertyNames.taskReceiveDate] = { date: { start: input.taskReceiveDate } };
  if (input.projectId && propertyNames.project) properties[propertyNames.project] = { relation: [{ id: input.projectId }] };
  if (input.sprintId && propertyNames.sprint) properties[propertyNames.sprint] = { relation: [{ id: input.sprintId }] };
  return properties;
}

function buildNotionStatusProperties(status, propertyNames = defaultNotionTaskPropertyNames()) {
  if (!propertyNames.status) {
    throw new Error("Notion Tasks source must have a status column");
  }
  return {
    [propertyNames.status]: { status: { name: status } }
  };
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

async function generateNotionTaskDraftWithLlm(settings, input) {
  requireApiKey(settings);
  const sourceText = requireText(input?.sourceText || input?.source_text, "Source text");
  const metadata = input?.metadata || (settings.taskProvider === "notion" ? await readNotionMetadata(settings) : null);
  const text = await callChatCompletion(settings, [
    {
      role: "system",
      content: [
        "You draft Notion tasks for Denote.",
        "ALL Notion content written by Denote must be English.",
        "Return only JSON with fields: title, description, status, priority, taskType, assigneeIds, dueDate, taskReceiveDate, projectId, sprintId.",
        "Use only allowed schema values. If a project, assignee, sprint, or date is unclear, leave it empty instead of guessing.",
        "Do not use manual task numbering; Notion provides ID/Number fields."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Current date: ${currentLocalDate()}`,
        `Allowed metadata:\n${formatNotionMetadataForPrompt(metadata)}`,
        `Source text:\n${sourceText}`
      ].join("\n\n")
    }
  ]);
  return normalizeNotionTaskDraftPayload(await parseLlmJsonObject(text, "generateNotionTaskDraft"), metadata, sourceText);
}

async function answerNotionWithLlm(settings, input) {
  requireApiKey(settings);
  const question = normalizeQuestionInput(input).trim();
  if (!question) {
    throw new Error("Question is required");
  }
  const deterministicAnswer = answerNotionMetadataQuestion(input);
  if (deterministicAnswer) {
    return deterministicAnswer;
  }
  const context = await buildNotionAskContext(settings, input);
  const text = await callChatCompletion(settings, [
    {
      role: "system",
      content: [
        "You are Denote's Notion task assistant.",
        "Answer in concise Markdown using only the provided Notion context.",
        "For counting, grouping, and filtering questions, count from the complete Task summary section before using detail excerpts.",
        "For list/count answers, use a compact Markdown table with columns: Task, Status, Assignees, Due, Project.",
        "Use the task URL as a Markdown link in the Task column when Link is present.",
        "Do not cite internal summary row numbers such as #2 or #15 as task identifiers.",
        "You may propose actions, but Do not claim that a Notion write has happened.",
        "When a write is useful, return an action plan in the actionPlan field."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Question:\n${question}`,
        `Notion context:\n${context.contextText}`,
        `Allowed actions:\nupdate_task_properties, append_task_note, archive_task`
      ].join("\n\n")
    }
  ]);
  let actionPlan = null;
  if (shouldPlanNotionActions(question)) {
    actionPlan = await planNotionActionsWithLlm(settings, { ...input, question, contextText: context.contextText });
    await writeLog("info", "notion.ask.action_plan.done", {
      hasActions: Boolean(actionPlan?.actions?.length),
      needsConfirmation: Boolean(actionPlan?.needsConfirmation)
    });
  } else {
    await writeLog("info", "notion.ask.action_plan.skipped", {
      reason: "read_only_question"
    });
  }
  return {
    status: "answered",
    text,
    sources: context.sources,
    actionPlan
  };
}

function shouldPlanNotionActions(question) {
  const text = String(question || "").trim().toLowerCase();
  if (!text) {
    return false;
  }
  return [
    /\b(update|set|change|edit|modify|rename)\b.+\b(status|priority|assignee|assign|due|date|project|sprint|task type|field|property)\b/u,
    /\b(create|new|make|add)\b.+\bsprint\b/u,
    /\b(mark|move)\b.+\b(done|complete|completed|testing|test failed|uat|in progress|not started|dev|clarification)\b/u,
    /\b(assign|reassign)\b.+\b(to|sprint|assignee|user|person)\b/u,
    /\b(add|append|write)\b.+\b(note|comment|remark|description)\b/u,
    /\b(archive|delete|remove)\b/u
  ].some((pattern) => pattern.test(text));
}

async function planNotionActionsWithLlm(settings, input) {
  const question = String(input?.question || "").trim();
  if (!question) {
    return null;
  }
  const metadata = await readNotionMetadata(settings);
  const text = await callChatCompletion(settings, [
    {
      role: "system",
      content: [
        "You convert a user request into a Denote Notion controlled action plan.",
        "Return only JSON: {\"answer\":\"...\",\"actions\":[],\"needsConfirmation\":true}.",
        "Allowed action types: update_task_properties, append_task_note, archive_task, create_sprint.",
        "For create_sprint actions include sprintName and taskIds. Use it only when the user explicitly asks to create a new sprint.",
        "For assigning an existing sprint, use update_task_properties with properties.sprintId from Allowed metadata.",
        "Destructive archive_task always needs confirmation. Bulk updates need confirmation.",
        "If no write action is needed, return actions: [] and needsConfirmation: false.",
        "Do not claim that a Notion write has happened."
      ].join(" ")
    },
    {
      role: "user",
      content: [
        `Request:\n${question}`,
        `Allowed metadata:\n${formatNotionMetadataForPrompt(metadata)}`,
        `Context:\n${truncate(String(input?.contextText || ""), 6000)}`
      ].join("\n\n")
    }
  ]);
  return validateNotionActionPlan(await parseLlmJsonObject(text, "planNotionActions"));
}

function validateNotionActionPlan(plan) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  const safeActions = actions
    .filter((action) => ["update_task_properties", "append_task_note", "archive_task", "create_sprint"].includes(action?.type))
    .map((action) => ({
      type: action.type,
      taskId: String(action.taskId || action.id || "").trim(),
      taskIds: normalizeActionTaskIds(action.taskIds || action.tasks || action.taskId || action.id),
      sprintName: String(action.sprintName || action.name || action.title || "").trim(),
      properties: isPlainObject(action.properties) ? action.properties : {},
      note: String(action.note || action.content || "").trim(),
      reason: String(action.reason || "").trim()
    }))
    .filter((action) => (action.type === "create_sprint" ? action.sprintName : action.taskId));
  const needsConfirmation = safeActions.length > 0 ? true : Boolean(plan?.needsConfirmation);
  return {
    answer: String(plan?.answer || "").trim(),
    actions: safeActions,
    needsConfirmation
  };
}

function normalizeActionTaskIds(value) {
  return (Array.isArray(value) ? value : [value]).map((item) => String(item || "").trim()).filter(Boolean);
}

async function applyNotionAction(settings, input) {
  const plan = validateNotionActionPlan(input?.plan || input);
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const results = [];
  for (const action of plan.actions) {
    if (action.type === "create_sprint") {
      const sprint = await createNotionSprint(settings, action.sprintName);
      const assigned = await assignCreatedSprintToTasks(settings, action.taskIds, sprint.id);
      results.push({ type: action.type, sprint, assigned, taskIds: action.taskIds });
      action.taskIds.forEach((taskId) => invalidateNotionCaches(taskId));
      continue;
    }
    if (action.type === "update_task_properties") {
      const metadata = await readMetadataForTaskSource(settings, action.taskId);
      const response = await notion.pages.update({
        page_id: action.taskId,
        properties: buildNotionPageUpdateProperties(action.properties, metadata.propertyNames)
      });
      results.push({ type: action.type, taskId: action.taskId, task: normalizeNotionTaskPage(response, metadata.propertyNames) });
    }
    if (action.type === "append_task_note") {
      await appendNotionTaskNote(notion, action.taskId, action.note);
      results.push({ type: action.type, taskId: action.taskId, appended: true });
    }
    if (action.type === "archive_task") {
      await notion.pages.update({ page_id: action.taskId, archived: true });
      results.push({ type: action.type, taskId: action.taskId, archived: true });
    }
    invalidateNotionCaches(action.taskId);
  }
  return { applied: true, results };
}

async function createNotionSprint(settings, sprintName) {
  const name = requireText(sprintName, "Sprint name");
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const source = getEnabledNotionTaskSources(tokenProfile)[0];
  const dataSource = await notion.dataSources.retrieve({ data_source_id: source.id });
  const metadata = validateDennisTasksSchema(dataSource.properties || {});
  if (!metadata.sprintDataSourceId) {
    throw new Error("Notion Tasks source does not have a Sprint relation data source");
  }
  const sprintDataSource = await notion.dataSources.retrieve({ data_source_id: metadata.sprintDataSourceId });
  const titlePropertyName = findNotionPropertyName(sprintDataSource.properties || {}, "title", ["Name", "Sprint", "Title"], true);
  const response = await notion.pages.create({
    parent: { data_source_id: metadata.sprintDataSourceId },
    properties: {
      [titlePropertyName]: { title: [{ text: { content: name } }] }
    }
  });
  return {
    id: response.id,
    name,
    url: response.url || ""
  };
}

async function assignCreatedSprintToTasks(settings, taskIds, sprintId) {
  const ids = normalizeActionTaskIds(taskIds);
  const assigned = [];
  for (const taskId of ids) {
    const metadata = await readMetadataForTaskSource(settings, taskId);
    if (!metadata.propertyNames.sprint) {
      throw new Error("Notion Tasks source does not have a Sprint relation column");
    }
    const notion = createNotionClientForToken(resolveActiveNotionToken(settings));
    await notion.pages.update({
      page_id: taskId,
      properties: {
        [metadata.propertyNames.sprint]: { relation: [{ id: sprintId }] }
      }
    });
    assigned.push(taskId);
  }
  return assigned;
}

function buildNotionPageUpdateProperties(input, propertyNames = defaultNotionTaskPropertyNames()) {
  const properties = {};
  if (input.title && propertyNames.title) properties[propertyNames.title] = { title: [{ text: { content: requireText(input.title, "Task name") } }] };
  if (input.status && propertyNames.status) properties[propertyNames.status] = { status: { name: input.status } };
  if (input.priority && propertyNames.priority) properties[propertyNames.priority] = { select: { name: input.priority } };
  if (input.taskType && propertyNames.taskType) properties[propertyNames.taskType] = { select: { name: input.taskType } };
  if (Array.isArray(input.assigneeIds) && propertyNames.assignee) {
    properties[propertyNames.assignee] = { people: input.assigneeIds.map((id) => ({ id })) };
  }
  if (input.dueDate && propertyNames.due) properties[propertyNames.due] = { date: { start: input.dueDate } };
  if (input.taskReceiveDate && propertyNames.taskReceiveDate) properties[propertyNames.taskReceiveDate] = { date: { start: input.taskReceiveDate } };
  if (input.projectId && propertyNames.project) properties[propertyNames.project] = { relation: [{ id: input.projectId }] };
  if (input.sprintId && propertyNames.sprint) properties[propertyNames.sprint] = { relation: [{ id: input.sprintId }] };
  return properties;
}

async function readMetadataForTaskSource(settings, taskId) {
  const tokenProfile = resolveActiveNotionToken(settings);
  const notion = createNotionClientForToken(tokenProfile);
  const source = await resolveNotionSourceForTask(settings, taskId);
  const dataSource = await notion.dataSources.retrieve({ data_source_id: source.id });
  return validateDennisTasksSchema(dataSource.properties || {});
}

async function resolveNotionSourceForTask(settings, taskId) {
  const tokenProfile = resolveActiveNotionToken(settings);
  const enabledSources = getEnabledNotionTaskSources(tokenProfile);
  const cachedTask = findCachedNotionTask(taskId);
  const cachedSourceId = cachedTask?.sourceId || "";
  const matchedCachedSource = enabledSources.find((source) => source.id === cachedSourceId);
  if (matchedCachedSource) {
    return matchedCachedSource;
  }
  const notion = createNotionClientForToken(tokenProfile);
  const page = await notion.pages.retrieve({ page_id: taskId });
  const parentSourceId = page?.parent?.data_source_id || page?.parent?.database_id || "";
  const matchedParentSource = enabledSources.find((source) => source.id === parentSourceId);
  if (matchedParentSource) {
    return matchedParentSource;
  }
  if (enabledSources.length === 1) {
    return enabledSources[0];
  }
  throw new Error("Unable to resolve the Notion task source for this task");
}

function findCachedNotionTask(taskId) {
  for (const cacheEntry of notionTaskCache.values()) {
    const task = cacheEntry.tasks.find((item) => item.id === taskId);
    if (task) {
      return task;
    }
  }
  return null;
}

async function appendNotionTaskNote(notion, taskId, note) {
  const content = requireText(note, "Notion update note");
  await notion.blocks.children.append({
    block_id: taskId,
    children: buildNotionTaskChildren(content)
  });
}

async function buildNotionAskContext(settings, input) {
  const tasks = Array.isArray(input?.tasks) ? input.tasks : [];
  const selectedIds = new Set(Array.isArray(input?.taskIds) ? input.taskIds.map(String) : []);
  const selectedTasks = tasks.filter((task) => selectedIds.has(task.id));
  const scopedTasks = selectedTasks.length > 0 ? selectedTasks : tasks;
  const taskSummaryText = formatNotionTaskSummaryList(scopedTasks);
  const details = [];
  for (const task of scopedTasks.slice(0, 10)) {
    try {
      details.push(await getNotionTaskDetail(settings, { taskId: task.id, updated_at: task.updated_at }));
    } catch {
      details.push({ task, bodyText: "", commentText: "" });
    }
  }
  return {
    contextText: [taskSummaryText, details.length ? `Detail excerpts for first ${details.length} tasks:\n${details.map(formatNotionContextDetail).join("\n\n---\n\n")}` : ""].filter(Boolean).join("\n\n"),
    sources: details.map((detail) => ({
      title: detail.task?.title || detail.task?.id || "Notion task",
      excerpt: truncate([detail.bodyText, detail.commentText].filter(Boolean).join("\n"), 360)
    }))
  };
}

function formatNotionTaskSummaryList(tasks) {
  if (!tasks.length) {
    return "Task summary: 0 tasks.";
  }
  return [
    `Task summary: ${tasks.length} task${tasks.length === 1 ? "" : "s"}. Count and filter questions must use every row below.`,
    ...tasks.map((task, index) => formatNotionTaskSummaryLine(task, index + 1))
  ].join("\n");
}

function formatNotionTaskSummaryLine(task, index) {
  return [
    `${index}. ${task.title || task.id}`,
    `Status: ${task.status || "No status"}`,
    `Project: ${(task.projectNames || []).join(", ") || "No project"}`,
    `Assignees: ${(task.assignees || []).map((person) => person.name || person.id).filter(Boolean).join(", ") || "Unassigned"}`,
    `Due: ${task.dueDate || "No due date"}`,
    `Source: ${task.sourceName || task.sourceId || "No source"}`,
    `Link: ${task.url || ""}`
  ].join(" | ");
}

function formatNotionContextDetail(detail) {
  const task = detail.task || {};
  return [
    `Task: ${task.title || task.id}`,
    `Status: ${task.status || ""}`,
    `Project: ${(task.projectNames || []).join(", ") || "No project"}`,
    `Assignees: ${(task.assignees || []).map((person) => person.name || person.id).join(", ")}`,
    `Due: ${task.dueDate || "No due date"}`,
    `URL: ${task.url || ""}`,
    `Body:\n${truncate(detail.bodyText || "", 2400)}`,
    `Comments:\n${truncate(detail.commentText || "", 1200)}`
  ].join("\n");
}

function normalizeNotionTaskDraftPayload(input, metadata, sourceText) {
  const status = pickAllowedValue(input?.status, metadata?.statusOptions) || metadata?.statusOptions?.[0] || "";
  return {
    title: requireText(input?.title, "Task name"),
    description: requireText(input?.description || sourceText, "Description"),
    status,
    priority: pickAllowedValue(input?.priority, metadata?.priorityOptions),
    taskType: pickAllowedValue(input?.taskType, metadata?.taskTypeOptions),
    assigneeIds: normalizeAllowedIds(input?.assigneeIds, metadata?.users),
    dueDate: normalizeScheduleField(input?.dueDate),
    taskReceiveDate: normalizeScheduleField(input?.taskReceiveDate) || currentLocalDate(),
    projectId: pickAllowedEntityId(input?.projectId, metadata?.projects),
    sprintId: pickAllowedEntityId(input?.sprintId, metadata?.sprints),
    sourceId: pickAllowedEntityId(input?.sourceId, metadata?.taskSources) || metadata?.taskSources?.[0]?.id || ""
  };
}

function formatNotionMetadataForPrompt(metadata) {
  if (!metadata || metadata.provider !== "notion") {
    return "{}";
  }
  return JSON.stringify({
    statusOptions: metadata.statusOptions,
    priorityOptions: metadata.priorityOptions,
    taskTypeOptions: metadata.taskTypeOptions,
    users: metadata.users?.map((user) => ({ id: user.id, name: user.name })),
    projects: metadata.projects?.map((project) => ({ id: project.id, name: project.name })),
    sprints: metadata.sprints?.map((sprint) => ({ id: sprint.id, name: sprint.name })),
    taskSources: metadata.taskSources?.map((source) => ({ id: source.id, name: source.name }))
  });
}

function pickAllowedValue(value, allowed = []) {
  const requested = String(value || "").trim();
  return allowed.includes(requested) ? requested : "";
}

function pickAllowedEntityId(value, entities = []) {
  const requested = String(value || "").trim();
  return entities.some((entity) => entity.id === requested) ? requested : "";
}

function normalizeAllowedIds(values, entities = []) {
  const allowed = new Set(entities.map((entity) => entity.id));
  return (Array.isArray(values) ? values : []).map(String).filter((id) => allowed.has(id));
}

function invalidateNotionCaches(taskId) {
  for (const key of notionTaskCache.keys()) {
    notionTaskCache.delete(key);
  }
  for (const key of notionDetailCache.keys()) {
    if (key.includes(taskId)) {
      notionDetailCache.delete(key);
    }
  }
}

function normalizeNotionTaskPage(page, propertyNames = inferNotionTaskPropertyNamesFromPage(page.properties || {})) {
  const properties = page.properties || {};
  const title = readNotionTitle(properties[propertyNames.title]);
  return {
    id: page.id || "",
    provider: "notion",
    sourceId: "",
    sourceName: "",
    title,
    summary: page.url || "",
    status: readNotionStatus(properties[propertyNames.status]),
    priority: readNotionSelect(properties[propertyNames.priority]),
    taskType: readNotionSelect(properties[propertyNames.taskType]),
    assignees: readNotionPeople(properties[propertyNames.assignee]),
    dueDate: readNotionDate(properties[propertyNames.due]),
    taskReceiveDate: readNotionDate(properties[propertyNames.taskReceiveDate]),
    projectIds: readNotionRelationIds(properties[propertyNames.project]),
    projectNames: [],
    sprintIds: readNotionRelationIds(properties[propertyNames.sprint]),
    sprintNames: [],
    number: readNotionNumber(properties[propertyNames.number]),
    notionId: formatNotionUniqueId(properties[propertyNames.notionId]?.unique_id),
    url: page.url || "",
    updated_at: page.last_edited_time || new Date().toISOString(),
    tags: [],
    raw: page
  };
}

function normalizeNotionTaskPageWithSource(page, source, propertyNames) {
  return {
    ...normalizeNotionTaskPage(page, propertyNames),
    sourceId: source.id || "",
    sourceName: source.name || source.id || ""
  };
}

function inferNotionTaskPropertyNames(schema) {
  return {
    title: findNotionPropertyName(schema, "title", ["Task name", "Name", "Title"], true),
    status: findNotionPropertyName(schema, "status", ["Status"], true),
    assignee: findNotionPropertyName(schema, "people", ["Assign", "Assignee", "Person", "People"], false),
    due: findNotionPropertyName(schema, "date", ["Due", "Due date", "Deadline"], false),
    priority: findNotionPropertyName(schema, "select", ["Priority"], false),
    taskType: findNotionPropertyName(schema, "select", ["Task Type", "Task type"], false),
    taskReceiveDate: findNotionPropertyName(schema, "date", ["Task Receive Date"], false),
    project: findNotionPropertyName(schema, "relation", ["Project"], false),
    sprint: findNotionPropertyName(schema, "relation", ["Sprint"], false),
    number: findNotionPropertyName(schema, "number", ["Number"], false),
    notionId: findNotionPropertyName(schema, "unique_id", ["ID"], false)
  };
}

function inferNotionTaskPropertyNamesFromPage(properties) {
  const schema = Object.fromEntries(Object.entries(properties).map(([name, property]) => [name, { type: property?.type }]));
  return inferNotionTaskPropertyNames(schema);
}

function defaultNotionTaskPropertyNames() {
  return {
    title: "Task name",
    status: "Status",
    assignee: "Assign",
    due: "Due",
    priority: "Priority",
    taskType: "Task Type",
    taskReceiveDate: "Task Receive Date",
    project: "Project",
    sprint: "Sprint",
    number: "Number",
    notionId: "ID"
  };
}

function findNotionPropertyName(schema, type, preferredNames, allowFallback) {
  for (const name of preferredNames) {
    if (schema[name]?.type === type) {
      return name;
    }
  }
  return allowFallback ? Object.entries(schema).find(([, property]) => property?.type === type)?.[0] || "" : "";
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

function readNotionStatus(property) {
  return String(property?.status?.name || "");
}

function readNotionSelect(property) {
  return String(property?.select?.name || "");
}

function readNotionPeople(property) {
  const people = Array.isArray(property?.people) ? property.people : [];
  return people.map((person) => ({
    id: String(person?.id || ""),
    name: String(person?.name || "")
  }));
}

function readNotionDate(property) {
  return String(property?.date?.start || "");
}

function readNotionRelationIds(property) {
  const relations = Array.isArray(property?.relation) ? property.relation : [];
  return relations.map((relation) => String(relation?.id || "")).filter(Boolean);
}

function readNotionNumber(property) {
  return typeof property?.number === "number" ? property.number : null;
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

async function testSftpConnection(settings) {
  const config = await buildSftpConnectionConfig(settings);
  const rootPath = normalizeRemoteAbsolutePath(settings.rootPath, DEFAULT_SETTINGS.sftp.rootPath);
  const notesPath = joinRemotePath(rootPath, normalizeRemoteRelativePath(settings.notesPath, DEFAULT_SETTINGS.sftp.notesPath));
  const client = createSftpClient();

  try {
    await client.connect(config);
    await ensureSftpDirectory(client, rootPath);
    await ensureSftpDirectory(client, notesPath);
    await writeLog("info", "sftp.connection.success", {
      host: settings.host,
      port: settings.port,
      rootPath,
      notesPath
    });
    return { connected: true, rootPath, notesPath };
  } catch (error) {
    await writeLog("error", "sftp.connection.failed", {
      host: settings.host,
      port: settings.port,
      rootPath,
      notesPath,
      error: errorMessage(error)
    });
    throw new Error(`SFTP connection failed: ${errorMessage(error)}`);
  } finally {
    await closeSftpClient(client);
  }
}

function createSftpClient() {
  const SftpClient = require("ssh2-sftp-client");
  return new SftpClient("denote-sync");
}

async function buildSftpConnectionConfig(settings) {
  const host = requireText(settings.host, "SFTP host");
  const username = requireText(settings.username, "SFTP username");
  const config = {
    host,
    port: normalizeSftpPort(settings.port),
    username,
    readyTimeout: 20000
  };

  if (settings.privateKeyPath) {
    config.privateKey = await fs.readFile(settings.privateKeyPath, "utf8");
    if (settings.passphrase) {
      config.passphrase = settings.passphrase;
    }
    return config;
  }

  config.password = requireSecret(settings.password, "SFTP password");
  return config;
}

async function ensureSftpDirectory(client, remotePath) {
  try {
    const stats = await client.stat(remotePath);
    if (stats?.isDirectory === false) {
      throw new Error(`${remotePath} exists but is not a directory`);
    }
  } catch (error) {
    if (!isSftpMissingPathError(error)) {
      throw error;
    }
    await client.mkdir(remotePath, true);
  }
}

function isSftpMissingPathError(error) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("no such file") || message.includes("not found") || message.includes("does not exist");
}

async function closeSftpClient(client) {
  try {
    await client.end();
  } catch {
    // Closing a failed SFTP connection should not mask the original error.
  }
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

function requireSecret(value, label) {
  const text = String(value || "");
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
    syncProvider: input.syncProvider === "sftp" ? "sftp" : "local",
    sftp: normalizeSftpSettings(input.sftp),
    taskProvider: input.taskProvider === "notion" ? "notion" : "local",
    notionToken,
    notionTasksDatabaseId,
    notionTaskSources,
    activeNotionTokenId,
    notionTokens
  };
}

function normalizeSftpSettings(input) {
  const record = isPlainObject(input) ? input : {};
  return {
    host: String(record.host || "").trim(),
    port: normalizeSftpPort(record.port),
    username: String(record.username || "").trim(),
    password: String(record.password || ""),
    privateKeyPath: String(record.privateKeyPath || "").trim(),
    passphrase: String(record.passphrase || ""),
    rootPath: normalizeRemoteAbsolutePath(record.rootPath, DEFAULT_SETTINGS.sftp.rootPath),
    notesPath: normalizeRemoteRelativePath(record.notesPath, DEFAULT_SETTINGS.sftp.notesPath)
  };
}

function normalizeSftpPort(value) {
  const port = Number(value || DEFAULT_SETTINGS.sftp.port);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_SETTINGS.sftp.port;
}

function normalizeRemoteAbsolutePath(value, fallback) {
  const text = String(value || fallback).trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const normalized = text.startsWith("/") ? text : `/${text}`;
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function normalizeRemoteRelativePath(value, fallback) {
  const text = String(value || fallback).trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const withoutEdges = text.replace(/^\/+/, "").replace(/\/+$/, "");
  return withoutEdges || fallback;
}

function joinRemotePath(rootPath, relativePath) {
  return `${normalizeRemoteAbsolutePath(rootPath, DEFAULT_SETTINGS.sftp.rootPath)}/${normalizeRemoteRelativePath(relativePath, DEFAULT_SETTINGS.sftp.notesPath)}`;
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  syncProvider: "local",
  sftp: {
    host: "",
    port: 22,
    username: "",
    password: "",
    privateKeyPath: "",
    passphrase: "",
    rootPath: "/denote",
    notesPath: "notes"
  },
  taskProvider: "local",
  notionToken: "",
  notionTasksDatabaseId: "",
  notionTaskSources: [],
  activeNotionTokenId: "",
  notionTokens: []
};
const notionTaskCache = new Map();
const notionDetailCache = new Map();

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
