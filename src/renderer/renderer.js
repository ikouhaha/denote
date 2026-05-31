const state = {
  cards: [],
  selectedCardId: null,
  view: "add"
};

const elements = {
  status: document.querySelector("#status"),
  viewTitle: document.querySelector("#viewTitle"),
  navTabs: [...document.querySelectorAll(".nav-tab")],
  views: {
    add: document.querySelector("#addView"),
    library: document.querySelector("#libraryView"),
    ask: document.querySelector("#askView"),
    settings: document.querySelector("#settingsView")
  },
  sourceInput: document.querySelector("#sourceInput"),
  generateButton: document.querySelector("#generateButton"),
  cardForm: document.querySelector("#cardForm"),
  titleInput: document.querySelector("#titleInput"),
  summaryInput: document.querySelector("#summaryInput"),
  contentTypeInput: document.querySelector("#contentTypeInput"),
  tagsInput: document.querySelector("#tagsInput"),
  sourceReviewInput: document.querySelector("#sourceReviewInput"),
  cardCount: document.querySelector("#cardCount"),
  librarySearchInput: document.querySelector("#librarySearchInput"),
  cardList: document.querySelector("#cardList"),
  questionInput: document.querySelector("#questionInput"),
  askButton: document.querySelector("#askButton"),
  answerPanel: document.querySelector("#answerPanel"),
  settingsForm: document.querySelector("#settingsForm"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  chatModelInput: document.querySelector("#chatModelInput"),
  embeddingModelInput: document.querySelector("#embeddingModelInput"),
  seedSamplesButton: document.querySelector("#seedSamplesButton")
};

const viewTitles = {
  add: "Add knowledge",
  library: "Library",
  ask: "Ask",
  settings: "Settings"
};

window.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await Promise.all([refreshCards(), loadSettings()]);
});

function bindEvents() {
  for (const tab of elements.navTabs) {
    tab.addEventListener("click", () => setView(tab.dataset.view));
  }

  elements.generateButton.addEventListener("click", async () => {
    await runAction("Generating draft", async () => {
      const draft = await window.denote.generateDraft(elements.sourceInput.value);
      fillDraft(draft);
      setStatus("Draft ready");
    });
  });

  elements.cardForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction("Saving card", async () => {
      const saved = await window.denote.saveCard(readDraftForm());
      state.selectedCardId = saved.id;
      clearDraftForm();
      await refreshCards();
      setView("library");
      setStatus("Card saved");
    });
  });

  elements.librarySearchInput.addEventListener("input", renderCards);

  elements.askButton.addEventListener("click", async () => {
    await runAction("Asking", async () => {
      const answer = await window.denote.ask(elements.questionInput.value);
      renderAnswer(answer);
      setStatus(answer.status === "answered" ? "Answered from saved knowledge" : "Insufficient evidence");
    });
  });

  elements.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction("Saving settings", async () => {
      await window.denote.saveSettings(readSettingsForm());
      setStatus("Settings saved");
    });
  });

  elements.seedSamplesButton.addEventListener("click", async () => {
    await runAction("Seeding samples", async () => {
      const result = await window.denote.seedSamples();
      state.cards = result.cards;
      renderCards();
      setView("ask");
      elements.questionInput.value = "Why should LanceDB be rebuildable from SQLite?";
      setStatus(result.added > 0 ? `Added ${result.added} samples` : "Samples already loaded");
    });
  });
}

function setView(view) {
  state.view = view;
  elements.viewTitle.textContent = viewTitles[view];
  for (const [name, node] of Object.entries(elements.views)) {
    node.classList.toggle("active-view", name === view);
  }
  for (const tab of elements.navTabs) {
    tab.classList.toggle("active", tab.dataset.view === view);
  }
}

async function refreshCards() {
  state.cards = await window.denote.listCards();
  renderCards();
}

async function loadSettings() {
  const settings = await window.denote.getSettings();
  elements.baseUrlInput.value = settings.baseUrl;
  elements.apiKeyInput.value = settings.apiKey;
  elements.chatModelInput.value = settings.chatModel;
  elements.embeddingModelInput.value = settings.embeddingModel;
}

function fillDraft(draft) {
  elements.titleInput.value = draft.title;
  elements.summaryInput.value = draft.summary;
  elements.tagsInput.value = draft.tags.join(", ");
  elements.contentTypeInput.value = draft.content_type;
  elements.sourceReviewInput.value = draft.source_text;
}

function readDraftForm() {
  return {
    id: state.selectedCardId || undefined,
    title: elements.titleInput.value,
    summary: elements.summaryInput.value,
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
    embeddingModel: elements.embeddingModelInput.value
  };
}

function clearDraftForm() {
  state.selectedCardId = null;
  elements.sourceInput.value = "";
  elements.titleInput.value = "";
  elements.summaryInput.value = "";
  elements.tagsInput.value = "";
  elements.contentTypeInput.value = "technical_note";
  elements.sourceReviewInput.value = "";
}

function renderCards() {
  const query = elements.librarySearchInput.value.trim().toLowerCase();
  const cards = state.cards.filter((card) => {
    if (!query) {
      return true;
    }
    return `${card.title} ${card.summary} ${card.tags.join(" ")} ${card.source_text}`
      .toLowerCase()
      .includes(query);
  });

  elements.cardCount.textContent = `${state.cards.length} ${state.cards.length === 1 ? "card" : "cards"}`;
  elements.cardList.innerHTML = "";

  if (cards.length === 0) {
    elements.cardList.innerHTML = `<p class="muted">No cards yet. Seed samples to try Ask immediately.</p>`;
    return;
  }

  for (const card of cards) {
    const item = document.createElement("article");
    item.className = "knowledge-card";
    item.innerHTML = `
      <div class="card-title-row">
        <h3></h3>
        <button type="button">Edit</button>
      </div>
      <p class="summary"></p>
      <div class="tags"></div>
    `;
    item.querySelector("h3").textContent = card.title;
    item.querySelector(".summary").textContent = card.summary;
    item.querySelector(".tags").textContent = card.tags.map((tag) => `#${tag}`).join(" ");
    item.querySelector("button").addEventListener("click", () => {
      state.selectedCardId = card.id;
      fillDraft(card);
      setView("add");
      setStatus("Editing card");
    });
    elements.cardList.append(item);
  }
}

function renderAnswer(answer) {
  if (answer.status === "insufficient_evidence") {
    elements.answerPanel.innerHTML = `<p class="insufficient"></p>`;
    elements.answerPanel.querySelector("p").textContent = answer.text;
    return;
  }

  elements.answerPanel.innerHTML = `
    <p class="answer-text"></p>
    <h3>Sources</h3>
    <div class="source-list"></div>
  `;
  elements.answerPanel.querySelector(".answer-text").textContent = answer.text;
  const sourceList = elements.answerPanel.querySelector(".source-list");
  for (const source of answer.sources) {
    const sourceNode = document.createElement("blockquote");
    sourceNode.innerHTML = `<strong></strong><p></p>`;
    sourceNode.querySelector("strong").textContent = source.title;
    sourceNode.querySelector("p").textContent = source.excerpt;
    sourceList.append(sourceNode);
  }
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
