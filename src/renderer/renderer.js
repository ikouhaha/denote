const state = {
  cards: [],
  messages: [],
  selectedCardId: null,
  view: "add",
  taskProvider: "local",
  taskProviderMetadata: null,
  notionTaskSources: [],
  discoveredNotionSources: [],
  notionIntegrationError: "",
  updateState: null
};

const elements = {
  status: document.querySelector("#status"),
  viewTitle: document.querySelector("#viewTitle"),
  appVersionText: document.querySelector("#appVersionText"),
  updateStatusText: document.querySelector("#updateStatusText"),
  updateActionButton: document.querySelector("#updateActionButton"),
  providerModeButtons: [...document.querySelectorAll(".provider-mode")],
  navTabs: [...document.querySelectorAll(".nav-tab")],
  views: {
    add: document.querySelector("#addView"),
    library: document.querySelector("#libraryView"),
    calendar: document.querySelector("#calendarView"),
    ask: document.querySelector("#askView"),
    settings: document.querySelector("#settingsView")
  },
  sourceInput: document.querySelector("#sourceInput"),
  generateButton: document.querySelector("#generateButton"),
  cardForm: document.querySelector("#cardForm"),
  refineDraftButton: document.querySelector("#refineDraftButton"),
  draftQuestionInput: document.querySelector("#draftQuestionInput"),
  titleInput: document.querySelector("#titleInput"),
  summaryInput: document.querySelector("#summaryInput"),
  projectInput: document.querySelector("#projectInput"),
  cardKindInput: document.querySelector("#cardKindInput"),
  statusInput: document.querySelector("#statusInput"),
  notionTaskFields: document.querySelector("#notionTaskFields"),
  notionTaskSourceInput: document.querySelector("#notionTaskSourceInput"),
  notionStatusInput: document.querySelector("#notionStatusInput"),
  notionPriorityInput: document.querySelector("#notionPriorityInput"),
  notionTaskTypeInput: document.querySelector("#notionTaskTypeInput"),
  notionAssignInput: document.querySelector("#notionAssignInput"),
  notionProjectInput: document.querySelector("#notionProjectInput"),
  notionTaskReceiveDateInput: document.querySelector("#notionTaskReceiveDateInput"),
  notionSprintInput: document.querySelector("#notionSprintInput"),
  dueDateInput: document.querySelector("#dueDateInput"),
  dueTimeInput: document.querySelector("#dueTimeInput"),
  contentTypeInput: document.querySelector("#contentTypeInput"),
  tagsInput: document.querySelector("#tagsInput"),
  sourceReviewInput: document.querySelector("#sourceReviewInput"),
  cardCount: document.querySelector("#cardCount"),
  libraryFilterInput: document.querySelector("#libraryFilterInput"),
  librarySearchInput: document.querySelector("#librarySearchInput"),
  cardList: document.querySelector("#cardList"),
  calendarCount: document.querySelector("#calendarCount"),
  calendarBoard: document.querySelector("#calendarBoard"),
  chatThread: document.querySelector("#chatThread"),
  askForm: document.querySelector("#askForm"),
  questionInput: document.querySelector("#questionInput"),
  askButton: document.querySelector("#askButton"),
  settingsForm: document.querySelector("#settingsForm"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  chatModelInput: document.querySelector("#chatModelInput"),
  embeddingModelInput: document.querySelector("#embeddingModelInput"),
  notionTokenInput: document.querySelector("#notionTokenInput"),
  notionTasksDatabaseIdInput: document.querySelector("#notionTasksDatabaseIdInput"),
  discoverNotionDatabasesButton: document.querySelector("#discoverNotionDatabasesButton"),
  notionDatabasePicker: document.querySelector("#notionDatabasePicker"),
  notionSelectedSources: document.querySelector("#notionSelectedSources"),
  diagnosticsText: document.querySelector("#diagnosticsText")
};

const viewTitles = {
  add: "Add knowledge",
  library: "Library",
  calendar: "Calendar",
  ask: "Ask",
  settings: "Settings"
};

window.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadAppInfo();
  await loadUpdateState();
  await loadSettings();
  await Promise.all([refreshCards(), loadDiagnostics()]);
  renderMessages();
});

function bindEvents() {
  for (const button of elements.providerModeButtons) {
    button.addEventListener("click", async () => {
      await setTaskProvider(button.dataset.provider);
    });
  }

  for (const tab of elements.navTabs) {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  }

  elements.generateButton.addEventListener("click", async () => {
    await runAction("Generating card with LLM", async () => {
      const draft = await window.denote.generateDraft(elements.sourceInput.value);
      fillDraft(draft);
      setStatus("Draft ready");
    });
  });

  elements.refineDraftButton.addEventListener("click", async () => {
    await refineCurrentDraft();
  });

  elements.cardForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction("Saving card", async () => {
      const saved =
        state.taskProvider === "notion"
          ? await window.denote.createTask(readNotionTaskForm())
          : await window.denote.saveCard(readDraftForm());
      state.selectedCardId = saved.id;
      clearDraftForm();
      await refreshCards();
      setView("library");
      setStatus(state.taskProvider === "notion" ? "Task saved to Notion" : "Card saved");
    });
  });

  elements.librarySearchInput.addEventListener("input", renderCards);
  elements.libraryFilterInput.addEventListener("change", renderCards);

  elements.askForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await askCurrentQuestion();
  });

  elements.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction("Saving settings", async () => {
      await window.denote.saveSettings(readSettingsForm());
      state.notionIntegrationError = "";
      await loadTaskProviderMetadata();
      await refreshCards();
      setStatus("Settings saved");
    });
  });

  elements.discoverNotionDatabasesButton.addEventListener("click", async () => {
    await discoverNotionDatabases();
  });

  elements.notionDatabasePicker.addEventListener("change", () => {
    if (elements.notionDatabasePicker.value) {
      elements.notionTasksDatabaseIdInput.value = elements.notionDatabasePicker.value;
      addOrEnableNotionTaskSource({
        id: elements.notionDatabasePicker.value,
        name: elements.notionDatabasePicker.selectedOptions[0]?.textContent || elements.notionDatabasePicker.value,
        enabled: true
      });
      renderSelectedNotionSources();
      renderNotionMetadataOptions();
    }
  });

  elements.updateActionButton.addEventListener("click", async () => {
    await handleUpdateAction();
  });

  if (typeof window.denote.onUpdateStateChanged === "function") {
    window.denote.onUpdateStateChanged((updateState) => {
      state.updateState = updateState;
      renderUpdateState();
    });
  }
}

async function loadAppInfo() {
  const appInfo = await window.denote.getAppInfo();
  elements.appVersionText.textContent = `v${appInfo.version}`;
}

async function loadUpdateState() {
  state.updateState = await window.denote.getUpdateState();
  renderUpdateState();
}

async function handleUpdateAction() {
  const status = state.updateState?.status || "idle";
  if (status === "available") {
    state.updateState = await window.denote.downloadUpdate();
  } else if (status === "downloaded") {
    state.updateState = await window.denote.installUpdate();
  } else {
    state.updateState = await window.denote.checkForUpdates();
  }
  renderUpdateState();
}

function renderUpdateState() {
  const updateState = state.updateState || {};
  const status = updateState.status || "idle";
  const availableVersion = updateState.availableVersion ? `v${updateState.availableVersion}` : "";
  const progress = Number.isFinite(updateState.progress) ? updateState.progress : null;

  elements.updateActionButton.hidden = false;
  elements.updateActionButton.disabled = ["checking", "downloading"].includes(status);

  if (status === "available") {
    elements.updateStatusText.textContent = `${availableVersion} available`;
    elements.updateActionButton.textContent = "Download";
  } else if (status === "downloading") {
    elements.updateStatusText.textContent = progress === null ? "Downloading update" : `Downloading ${progress}%`;
    elements.updateActionButton.textContent = "Downloading";
  } else if (status === "downloaded") {
    elements.updateStatusText.textContent = "Update ready";
    elements.updateActionButton.textContent = "Restart";
  } else if (status === "not-available") {
    elements.updateStatusText.textContent = "Up to date";
    elements.updateActionButton.textContent = "Check updates";
  } else if (status === "checking") {
    elements.updateStatusText.textContent = "Checking for updates";
    elements.updateActionButton.textContent = "Checking";
  } else if (status === "error") {
    elements.updateStatusText.textContent = updateState.message || "Update check failed";
    elements.updateActionButton.textContent = "Retry";
  } else {
    elements.updateStatusText.textContent = updateState.message || "Ready to check for updates";
    elements.updateActionButton.textContent = "Check updates";
  }
}

function setView(view) {
  state.view = view;
  for (const [name, node] of Object.entries(elements.views)) {
    node.classList.toggle("active-view", name === view);
  }
  for (const tab of elements.navTabs) {
    tab.classList.toggle("active", tab.dataset.view === view);
  }
  renderProviderMode();
}

async function refreshCards() {
  if (state.taskProvider === "notion" && state.notionIntegrationError) {
    state.cards = [];
  } else {
    state.cards = state.taskProvider === "notion" ? await window.denote.listTasks() : await window.denote.listCards();
  }
  renderCards();
  renderCalendar();
}

async function loadSettings() {
  const settings = await window.denote.getSettings();
  state.taskProvider = settings.taskProvider || "local";
  elements.baseUrlInput.value = settings.baseUrl;
  elements.apiKeyInput.value = settings.apiKey;
  elements.chatModelInput.value = settings.chatModel;
  elements.embeddingModelInput.value = settings.embeddingModel;
  elements.notionTokenInput.value = settings.notionToken || "";
  elements.notionTasksDatabaseIdInput.value = settings.notionTasksDatabaseId || "";
  state.notionTaskSources = normalizeNotionTaskSources(settings.notionTaskSources, settings.notionTasksDatabaseId);
  renderSelectedNotionSources();
  renderProviderMode();
  await loadTaskProviderMetadata();
}

async function loadDiagnostics() {
  const diagnostics = await window.denote.getDiagnostics();
  elements.diagnosticsText.textContent = `Logs: ${diagnostics.logFilePath} | Data: ${diagnostics.userDataPath}`;
}

function fillDraft(draft) {
  elements.titleInput.value = draft.title;
  elements.summaryInput.value = draft.summary;
  elements.projectInput.value = draft.project || "";
  elements.cardKindInput.value = draft.card_kind || "knowledge";
  elements.statusInput.value = draft.status || "open";
  elements.dueDateInput.value = draft.due_date || "";
  elements.dueTimeInput.value = draft.due_time || "";
  elements.tagsInput.value = draft.tags.join(", ");
  elements.contentTypeInput.value = draft.content_type;
  elements.sourceReviewInput.value = draft.source_text;
  elements.notionStatusInput.value = draft.notionStatus || draft.status || "";
  elements.notionPriorityInput.value = draft.priority || "";
  elements.notionTaskTypeInput.value = draft.taskType || "";
  elements.notionProjectInput.value = draft.projectIds?.[0] || "";
  elements.notionSprintInput.value = draft.sprintIds?.[0] || "";
  elements.notionTaskReceiveDateInput.value = draft.taskReceiveDate || "";
  elements.notionTaskSourceInput.value = draft.sourceId || getEnabledNotionTaskSources()[0]?.id || "";
}

function readDraftForm() {
  return {
    id: state.selectedCardId || undefined,
    title: elements.titleInput.value,
    summary: elements.summaryInput.value,
    project: elements.projectInput.value,
    card_kind: elements.cardKindInput.value,
    status: elements.statusInput.value,
    due_date: elements.dueDateInput.value,
    due_time: elements.dueTimeInput.value,
    tags: elements.tagsInput.value,
    content_type: elements.contentTypeInput.value,
    source_text: elements.sourceReviewInput.value
  };
}

function readSettingsForm() {
  return {
    baseUrl: elements.baseUrlInput.value,
    apiKey: elements.apiKeyInput.value,
    chatModel: elements.chatModelInput.value,
    embeddingModel: elements.embeddingModelInput.value,
    taskProvider: state.taskProvider,
    notionToken: elements.notionTokenInput.value,
    notionTasksDatabaseId: elements.notionTasksDatabaseIdInput.value,
    notionTaskSources: state.notionTaskSources
  };
}

function readNotionTaskForm() {
  return {
    id: state.selectedCardId || undefined,
    title: elements.titleInput.value,
    description: elements.sourceReviewInput.value,
    status: elements.notionStatusInput.value,
    priority: elements.notionPriorityInput.value,
    taskType: elements.notionTaskTypeInput.value,
    sourceId: elements.notionTaskSourceInput.value,
    assigneeIds: [...elements.notionAssignInput.selectedOptions].map((option) => option.value).filter(Boolean),
    dueDate: elements.dueDateInput.value,
    taskReceiveDate: elements.notionTaskReceiveDateInput.value,
    projectId: elements.notionProjectInput.value,
    sprintId: elements.notionSprintInput.value
  };
}

function clearDraftForm() {
  state.selectedCardId = null;
  elements.sourceInput.value = "";
  elements.draftQuestionInput.value = "";
  elements.titleInput.value = "";
  elements.summaryInput.value = "";
  elements.projectInput.value = "";
  elements.cardKindInput.value = "knowledge";
  elements.statusInput.value = "open";
  elements.dueDateInput.value = "";
  elements.dueTimeInput.value = "";
  elements.tagsInput.value = "";
  elements.contentTypeInput.value = "technical_note";
  elements.sourceReviewInput.value = "";
  elements.notionTaskReceiveDateInput.value = "";
}

async function setTaskProvider(provider) {
  if (!["local", "notion"].includes(provider)) {
    return;
  }
  state.taskProvider = await window.denote.setTaskProvider(provider);
  state.notionIntegrationError = "";
  renderProviderMode();
  await loadTaskProviderMetadata();
  await refreshCards();
}

function renderProviderMode() {
  for (const button of elements.providerModeButtons) {
    button.classList.toggle("active", button.dataset.provider === state.taskProvider);
  }
  elements.notionTaskFields.hidden = state.taskProvider !== "notion";
  elements.viewTitle.textContent = state.taskProvider === "notion" ? `${viewTitles[state.view]} - Notion` : viewTitles[state.view];
  renderProviderSetupState();
}

async function loadTaskProviderMetadata() {
  if (state.taskProvider !== "notion") {
    state.taskProviderMetadata = null;
    state.notionIntegrationError = "";
    return;
  }
  try {
    state.taskProviderMetadata = await window.denote.getTaskProviderMetadata();
    state.notionIntegrationError = "";
  } catch (error) {
    state.taskProviderMetadata = null;
    state.notionIntegrationError = error instanceof Error ? error.message : String(error);
  }
  renderNotionMetadataOptions();
  renderProviderSetupState();
}

function renderNotionMetadataOptions() {
  const metadata = state.taskProviderMetadata || {};
  fillSelect(elements.notionStatusInput, metadata.statusOptions || [], { includeEmpty: false });
  fillSelect(elements.notionPriorityInput, metadata.priorityOptions || [], { includeEmpty: false });
  fillSelect(elements.notionTaskTypeInput, metadata.taskTypeOptions || [], { includeEmpty: false });
  fillEntitySelect(elements.notionTaskSourceInput, getEnabledNotionTaskSources(), { includeEmpty: false });
  fillEntitySelect(elements.notionAssignInput, metadata.users || [], { includeEmpty: false });
  fillEntitySelect(elements.notionProjectInput, metadata.projects || [], { includeEmpty: true, emptyLabel: "No project" });
  fillEntitySelect(elements.notionSprintInput, metadata.sprints || [], { includeEmpty: true, emptyLabel: "No sprint" });
}

function renderSelectedNotionSources() {
  elements.notionSelectedSources.replaceChildren();
  if (state.notionTaskSources.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No Notion task sources selected.";
    elements.notionSelectedSources.append(empty);
    return;
  }
  for (const source of state.notionTaskSources) {
    const label = document.createElement("label");
    label.className = "source-toggle";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = source.enabled;
    checkbox.addEventListener("change", () => {
      toggleNotionTaskSource(source.id, checkbox.checked);
      renderSelectedNotionSources();
      renderNotionMetadataOptions();
    });
    const text = document.createElement("span");
    text.textContent = source.name || source.id;
    label.append(checkbox, text);
    elements.notionSelectedSources.append(label);
  }
}

function renderProviderSetupState() {
  const blocked = state.taskProvider === "notion" && Boolean(state.notionIntegrationError);
  elements.generateButton.disabled = blocked;
  const saveButton = document.querySelector("#saveButton");
  if (saveButton) {
    saveButton.disabled = blocked;
  }
}

async function discoverNotionDatabases() {
  await runAction("Finding Notion sources", async () => {
    await window.denote.saveSettings(readSettingsForm());
    const sources = await window.denote.discoverNotionDatabases({
      notionToken: elements.notionTokenInput.value
    });
    state.discoveredNotionSources = sources;
    fillEntitySelect(elements.notionDatabasePicker, sources, { includeEmpty: true, emptyLabel: "Choose a Notion source" });
    setStatus(`Found ${sources.length} Notion sources`);
  });
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

function getEnabledNotionTaskSources() {
  return state.notionTaskSources.filter((source) => source.enabled);
}

function addOrEnableNotionTaskSource(source) {
  const id = String(source?.id || "").trim();
  if (!id) {
    return;
  }
  const existing = state.notionTaskSources.find((item) => item.id === id);
  if (existing) {
    existing.name = String(source.name || existing.name || id).trim();
    existing.enabled = true;
    return;
  }
  state.notionTaskSources.push({
    id,
    name: String(source.name || "").trim() || id,
    enabled: true
  });
}

function toggleNotionTaskSource(id, enabled) {
  const source = state.notionTaskSources.find((item) => item.id === id);
  if (source) {
    source.enabled = enabled;
  }
}

function fillSelect(select, values, options = {}) {
  select.replaceChildren();
  if (options.includeEmpty) {
    select.append(new Option(options.emptyLabel || "", ""));
  }
  for (const value of values) {
    select.append(new Option(value, value));
  }
}

function fillEntitySelect(select, entities, options = {}) {
  select.replaceChildren();
  if (options.includeEmpty) {
    select.append(new Option(options.emptyLabel || "", ""));
  }
  for (const entity of entities) {
    select.append(new Option(entity.name || entity.title || entity.id, entity.id));
  }
}

function renderCards() {
  const query = elements.librarySearchInput.value.trim().toLowerCase();
  const filter = elements.libraryFilterInput.value;
  const cards = state.cards.filter((card) => {
    if (!matchesLibraryFilter(card, filter)) {
      return false;
    }
    if (!query) {
      return true;
    }
    return `${card.title} ${card.summary || ""} ${card.project || ""} ${card.taskType || ""} ${card.card_kind || ""} ${card.status || ""} ${card.due_date || card.dueDate || ""} ${card.due_time || ""} ${(card.tags || []).join(" ")} ${card.source_text || ""}`
      .toLowerCase()
      .includes(query);
  });

  elements.cardCount.textContent = `${cards.length} of ${state.cards.length} cards`;
  elements.cardList.innerHTML = "";

  if (cards.length === 0) {
    const emptyText =
      state.taskProvider === "notion"
        ? state.notionIntegrationError
          ? `Notion is not connected: ${state.notionIntegrationError}`
          : "No Notion tasks returned for the selected database."
        : "No cards yet. Save a card from Add to build your own library.";
    elements.cardList.innerHTML = `<p class="muted"></p>`;
    elements.cardList.querySelector(".muted").textContent = emptyText;
    return;
  }

  for (const card of cards) {
    const item = document.createElement("article");
    item.className = "knowledge-card";
    item.innerHTML = `
      <div class="card-title-row">
        <h3></h3>
        <div class="card-actions">
          <button class="edit-card" type="button">Edit</button>
          <button class="done-card" type="button">Done</button>
          <button class="restore-card" type="button">Restore</button>
          <button class="delete-card danger-button" type="button">Delete</button>
        </div>
      </div>
      <div class="project-pill"></div>
      <div class="card-meta"></div>
      <p class="summary"></p>
      <div class="tags"></div>
    `;
    item.querySelector("h3").textContent = card.title;
    const projectLabel = card.project || (card.projectIds?.length ? `Project: ${card.projectIds.join(", ")}` : "");
    item.querySelector(".project-pill").textContent = projectLabel || "No project";
    item.querySelector(".project-pill").classList.toggle("empty-project", !projectLabel);
    item.querySelector(".card-meta").textContent = formatCardMeta(card);
    item.querySelector(".summary").textContent = card.summary || card.description || card.url || "";
    item.querySelector(".tags").textContent = (card.tags || []).map((tag) => `#${tag}`).join(" ");
    item.querySelector(".done-card").hidden = card.status === "done" || card.status === "deleted";
    item.querySelector(".restore-card").hidden = card.status !== "deleted";
    item.querySelector(".edit-card").addEventListener("click", () => {
      state.selectedCardId = card.id;
      fillDraft(card);
      setView("add");
      setStatus("Editing card");
    });
    item.querySelector(".done-card").addEventListener("click", async () => {
      await updateCardStatus(card, "done");
    });
    item.querySelector(".restore-card").addEventListener("click", async () => {
      await updateCardStatus(card, "open");
    });
    item.querySelector(".delete-card").addEventListener("click", async () => {
      await deleteCard(card);
    });
    elements.cardList.append(item);
  }
}

function renderCalendar() {
  const scheduledCards = state.cards
    .filter((card) => state.taskProvider === "notion" || ["task", "event", "reminder"].includes(card.card_kind || "knowledge"))
    .filter((card) => card.status !== "deleted")
    .sort(compareCalendarCards);
  elements.calendarCount.textContent = `${scheduledCards.length} scheduled ${scheduledCards.length === 1 ? "card" : "cards"}`;
  elements.calendarBoard.innerHTML = "";

  if (scheduledCards.length === 0) {
    elements.calendarBoard.innerHTML = `<p class="muted">No scheduled cards yet. Add a task, event, or reminder from Add.</p>`;
    return;
  }

  const groups = [
    { key: "today", title: "Today", cards: [] },
    { key: "tomorrow", title: "Tomorrow", cards: [] },
    { key: "upcoming", title: "Upcoming", cards: [] },
    { key: "noDate", title: "No date", cards: [] }
  ];
  const groupMap = Object.fromEntries(groups.map((group) => [group.key, group]));

  for (const card of scheduledCards) {
    groupMap[getCalendarGroup(card)].cards.push(card);
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "calendar-group";
    section.innerHTML = `
      <div class="calendar-group-head">
        <h3></h3>
        <span></span>
      </div>
      <div class="calendar-items"></div>
    `;
    section.querySelector("h3").textContent = group.title;
    section.querySelector("span").textContent = `${group.cards.length}`;
    const items = section.querySelector(".calendar-items");
    if (group.cards.length === 0) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "No cards";
      items.append(empty);
    } else {
      for (const card of group.cards) {
        items.append(createCalendarCard(card));
      }
    }
    elements.calendarBoard.append(section);
  }
}

function createCalendarCard(card) {
  const item = document.createElement("article");
  item.className = "calendar-card";
  item.innerHTML = `
    <div>
      <div class="calendar-date"></div>
      <h4></h4>
      <p></p>
      <div class="card-meta"></div>
    </div>
    <div class="card-actions">
      <button class="edit-card" type="button">Edit</button>
      <button class="done-card" type="button">Done</button>
      <button class="restore-card" type="button">Restore</button>
      <button class="delete-card danger-button" type="button">Delete</button>
    </div>
  `;
  item.querySelector(".calendar-date").textContent = formatDueLabel(card);
  item.querySelector("h4").textContent = card.title;
  item.querySelector("p").textContent = card.summary;
  item.querySelector(".card-meta").textContent = formatCardMeta(card);
  item.querySelector(".done-card").hidden = card.status === "done" || card.status === "deleted";
  item.querySelector(".restore-card").hidden = card.status !== "deleted";
  item.querySelector(".edit-card").addEventListener("click", () => {
    state.selectedCardId = card.id;
    fillDraft(card);
    setView("add");
    setStatus("Editing card");
  });
  item.querySelector(".done-card").addEventListener("click", async () => {
    await updateCardStatus(card, "done");
  });
  item.querySelector(".restore-card").addEventListener("click", async () => {
    await updateCardStatus(card, "open");
  });
  item.querySelector(".delete-card").addEventListener("click", async () => {
    await deleteCard(card);
  });
  return item;
}

function getCalendarGroup(card) {
  const dueDate = card.due_date || card.dueDate;
  if (!dueDate) {
    return "noDate";
  }
  const today = getLocalDateString(0);
  if (dueDate === today) {
    return "today";
  }
  if (dueDate === getLocalDateString(1)) {
    return "tomorrow";
  }
  return "upcoming";
}

function getLocalDateString(offsetDays) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function compareCalendarCards(a, b) {
  const aDue = [a.due_date || a.dueDate || "9999-12-31", a.due_time || "23:59"].join(" ");
  const bDue = [b.due_date || b.dueDate || "9999-12-31", b.due_time || "23:59"].join(" ");
  return aDue.localeCompare(bDue) || b.updated_at.localeCompare(a.updated_at);
}

function formatDueLabel(card) {
  const due = [card.due_date || card.dueDate, card.due_time].filter(Boolean).join(" ");
  return due || "No date";
}

function matchesLibraryFilter(card, filter) {
  const status = card.status || "open";
  const kind = card.taskType || card.card_kind || "knowledge";
  if (filter === "all") {
    return true;
  }
  if (filter === "active") {
    return status !== "deleted" && status !== "done";
  }
  if (filter === "knowledge") {
    return kind === "knowledge" && status !== "deleted";
  }
  if (filter === "schedule") {
    return ["task", "event", "reminder"].includes(kind) && status !== "deleted";
  }
  if (filter === "done") {
    return status === "done";
  }
  if (filter === "trash") {
    return status === "deleted";
  }
  return true;
}

function formatCardMeta(card) {
  const kind = card.card_kind || "knowledge";
  const status = card.status || "open";
  const due = [card.due_date || card.dueDate, card.due_time].filter(Boolean).join(" ");
  return [kind, status, due].filter(Boolean).join(" · ");
}

async function updateCardStatus(card, status) {
  await runAction("Updating card", async () => {
    const result =
      state.taskProvider === "notion"
        ? await window.denote.updateTaskStatus({ id: card.id, status })
        : await window.denote.updateCardStatus({ id: card.id, status });
    if (!result.updated) {
      setStatus("Card already removed");
      return;
    }
    await refreshCards();
    setStatus(status === "done" ? "Card marked done" : "Card restored");
  });
}

async function refineCurrentDraft() {
  const instruction = elements.draftQuestionInput.value.trim();
  if (!instruction) {
    setStatus("Tell AI what to change in the draft");
    return;
  }

  elements.refineDraftButton.disabled = true;
  await runAction("Updating draft with LLM", async () => {
    const draft = await window.denote.refineDraft({
      sourceText: elements.sourceInput.value || elements.sourceReviewInput.value,
      currentDraft: readDraftForm(),
      instruction
    });
    fillDraft(draft);
    elements.draftQuestionInput.value = "";
    setStatus("Draft updated");
  });
  elements.refineDraftButton.disabled = false;
  elements.draftQuestionInput.focus();
}

async function deleteCard(card) {
  const confirmed = window.confirm(`Move "${card.title}" to Trash?`);
  if (!confirmed) {
    return;
  }

  await runAction("Deleting card", async () => {
    const result = await window.denote.deleteCard(card.id);
    if (!result.deleted) {
      setStatus("Card already removed");
      return;
    }
    if (state.selectedCardId === card.id) {
      clearDraftForm();
    }
    await refreshCards();
    setStatus("Card moved to Trash");
  });
}

async function askCurrentQuestion() {
  const question = elements.questionInput.value.trim();
  if (!question) {
    setStatus("Question is required");
    return;
  }

  elements.questionInput.value = "";
  let requestCompleted = false;
  elements.askButton.disabled = true;
  state.messages.push({ role: "user", content: question, sources: [] });
  const assistantMessage = { role: "assistant", content: "", sources: [], streaming: true };
  state.messages.push(assistantMessage);
  renderMessages();

  await runAction("Asking LLM", async () => {
    const priorMessages = state.messages.slice(0, -2);
    try {
      const answer = await window.denote.ask({ question, history: priorMessages });
      await streamAssistantMessage(assistantMessage, answer.text);
      assistantMessage.sources = answer.sources;
      requestCompleted = true;
      setStatus("Answered by LLM");
    } catch (error) {
      assistantMessage.content = error instanceof Error ? error.message : String(error);
      assistantMessage.sources = [];
      requestCompleted = true;
      setStatus("LLM request failed");
    } finally {
      assistantMessage.streaming = false;
      renderMessages();
    }
  });

  assistantMessage.streaming = false;
  elements.askButton.disabled = false;
  if (!requestCompleted && !assistantMessage.content) {
    assistantMessage.content = "LLM request ended without a response. Check Settings diagnostics log.";
    renderMessages();
    setStatus("LLM request ended");
  }
  elements.questionInput.focus();
}

async function streamAssistantMessage(message, text) {
  const chunks = [];
  for (let index = 0; index < text.length; index += 8) {
    chunks.push(text.slice(index, index + 8));
  }
  for (const chunk of chunks) {
    message.content += chunk;
    renderMessages();
    await delay(18);
  }
}

function renderMessages() {
  elements.chatThread.innerHTML = "";
  if (state.messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "chat-empty";
    empty.innerHTML = `
      <strong>No conversation yet.</strong>
      <span>Ask after you save cards to your local library.</span>
    `;
    elements.chatThread.append(empty);
    return;
  }

  for (const message of state.messages) {
    const node = document.createElement("article");
    node.className = `chat-message ${message.role}`;
    node.innerHTML = `
      <div class="message-role"></div>
      <div class="message-content"></div>
      <div class="message-sources"></div>
    `;
    node.querySelector(".message-role").textContent = message.role === "user" ? "You" : "Denote";
    renderMessageContent(node.querySelector(".message-content"), message);
    const sources = node.querySelector(".message-sources");
    if (message.sources?.length) {
      for (const source of message.sources) {
        const sourceNode = document.createElement("blockquote");
        sourceNode.innerHTML = `<strong></strong><p></p>`;
        sourceNode.querySelector("strong").textContent = source.title;
        sourceNode.querySelector("p").textContent = source.excerpt;
        sources.append(sourceNode);
      }
    }
    elements.chatThread.append(node);
  }
  elements.chatThread.scrollTop = elements.chatThread.scrollHeight;
}

function renderMessageContent(container, message) {
  const content = message.content || (message.streaming ? "Thinking..." : "");
  if (message.role !== "assistant" || !message.content) {
    container.textContent = content;
    return;
  }

  container.classList.add("markdown-content");
  renderMarkdownInto(container, content);
}

function renderMarkdownInto(container, markdown) {
  container.replaceChildren();
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fenceMatch = line.match(/^```(\w+)?\s*$/);
    if (fenceMatch) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !lines[index].match(/^```\s*$/)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      appendCodeBlock(container, codeLines.join("\n"), fenceMatch[1]);
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const headingLevel = Math.min(headingMatch[1].length + 1, 4);
      const heading = document.createElement(`h${headingLevel}`);
      appendInlineMarkdown(heading, headingMatch[2].trim());
      container.append(heading);
      index += 1;
      continue;
    }

    if (line.match(/^>\s?/)) {
      const quote = document.createElement("blockquote");
      const paragraph = document.createElement("p");
      const quoteLines = [];
      while (index < lines.length && lines[index].match(/^>\s?/)) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      appendInlineMarkdown(paragraph, quoteLines.join("\n").trim());
      quote.append(paragraph);
      container.append(quote);
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableRows = [lines[index], lines[index + 1]];
      index += 2;
      while (index < lines.length && isTableRow(lines[index])) {
        tableRows.push(lines[index]);
        index += 1;
      }
      appendTable(container, tableRows);
      continue;
    }

    const unorderedMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (unorderedMatch) {
      const list = document.createElement("ul");
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s*[-*]\s+(.+)$/);
        if (!itemMatch) {
          break;
        }
        const item = document.createElement("li");
        appendInlineMarkdown(item, itemMatch[1].trim());
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }

    const orderedMatch = line.match(/^\s*\d+\.\s+(.+)$/);
    if (orderedMatch) {
      const list = document.createElement("ol");
      while (index < lines.length) {
        const itemMatch = lines[index].match(/^\s*\d+\.\s+(.+)$/);
        if (!itemMatch) {
          break;
        }
        const item = document.createElement("li");
        appendInlineMarkdown(item, itemMatch[1].trim());
        list.append(item);
        index += 1;
      }
      container.append(list);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && !isMarkdownBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphLines.join(" "));
    container.append(paragraph);
  }
}

function isMarkdownBlockStart(line) {
  return (
    /^```/.test(line) ||
    /^(#{1,3})\s+/.test(line) ||
    /^>\s?/.test(line) ||
    isTableRow(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  );
}

function isTableStart(lines, index) {
  return isTableRow(lines[index]) && Boolean(lines[index + 1]?.match(/^\s*\|?[\s:-]+\|[\s|:-]+\|?\s*$/));
}

function isTableRow(line) {
  return /^\s*\|.+\|\s*$/.test(line);
}

function appendTable(container, rows) {
  const table = document.createElement("table");
  const head = document.createElement("thead");
  const body = document.createElement("tbody");
  const headerCells = splitTableRow(rows[0]);

  const headerRow = document.createElement("tr");
  for (const cell of headerCells) {
    const header = document.createElement("th");
    appendInlineMarkdown(header, cell);
    headerRow.append(header);
  }
  head.append(headerRow);

  for (const row of rows.slice(2)) {
    const rowNode = document.createElement("tr");
    for (const cell of splitTableRow(row)) {
      const cellNode = document.createElement("td");
      appendInlineMarkdown(cellNode, cell);
      rowNode.append(cellNode);
    }
    body.append(rowNode);
  }

  table.append(head, body);
  container.append(table);
}

function splitTableRow(row) {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function appendCodeBlock(container, code, language) {
  const pre = document.createElement("pre");
  const codeNode = document.createElement("code");
  if (language) {
    codeNode.dataset.language = language;
  }
  codeNode.textContent = code;
  pre.append(codeNode);
  container.append(pre);
}

function appendInlineMarkdown(parent, text) {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match = pattern.exec(text);

  while (match) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const token = match[0];
    if (token.startsWith("**")) {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      parent.append(strong);
    } else {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      parent.append(code);
    }

    lastIndex = pattern.lastIndex;
    match = pattern.exec(text);
  }

  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function runAction(label, action) {
  try {
    setStatus(label);
    await action();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function setStatus(message) {
  elements.status.textContent = message;
}
