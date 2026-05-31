const state = {
  cards: [],
  messages: [],
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
  chatThread: document.querySelector("#chatThread"),
  askForm: document.querySelector("#askForm"),
  questionInput: document.querySelector("#questionInput"),
  askButton: document.querySelector("#askButton"),
  settingsForm: document.querySelector("#settingsForm"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  chatModelInput: document.querySelector("#chatModelInput"),
  embeddingModelInput: document.querySelector("#embeddingModelInput")
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
  renderMessages();
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

  elements.askForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await askCurrentQuestion();
  });

  elements.settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runAction("Saving settings", async () => {
      await window.denote.saveSettings(readSettingsForm());
      setStatus("Settings saved");
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
    elements.cardList.innerHTML = `<p class="muted">No cards yet. Save a card from Add to build your own library.</p>`;
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

async function askCurrentQuestion() {
  const question = elements.questionInput.value.trim();
  if (!question) {
    setStatus("Question is required");
    return;
  }

  elements.questionInput.value = "";
  elements.askButton.disabled = true;
  state.messages.push({ role: "user", content: question, sources: [] });
  const assistantMessage = { role: "assistant", content: "", sources: [], streaming: true };
  state.messages.push(assistantMessage);
  renderMessages();

  await runAction("Searching saved knowledge", async () => {
    const priorMessages = state.messages.slice(0, -2);
    const answer = await window.denote.ask({ question, history: priorMessages });
    await streamAssistantMessage(assistantMessage, answer.text);
    assistantMessage.sources = answer.sources;
    assistantMessage.streaming = false;
    renderMessages();
    setStatus(answer.status === "answered" ? "Answered from local knowledge" : "Insufficient evidence");
  });

  assistantMessage.streaming = false;
  elements.askButton.disabled = false;
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
      <p class="message-content"></p>
      <div class="message-sources"></div>
    `;
    node.querySelector(".message-role").textContent = message.role === "user" ? "You" : "Denote";
    node.querySelector(".message-content").textContent = message.content || (message.streaming ? "Thinking..." : "");
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
