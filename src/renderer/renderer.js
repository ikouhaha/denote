const state = {
  cards: [],
  selectedCardId: null
};

const elements = {
  status: document.querySelector("#status"),
  sourceInput: document.querySelector("#sourceInput"),
  generateButton: document.querySelector("#generateButton"),
  cardForm: document.querySelector("#cardForm"),
  titleInput: document.querySelector("#titleInput"),
  summaryInput: document.querySelector("#summaryInput"),
  contentTypeInput: document.querySelector("#contentTypeInput"),
  tagsInput: document.querySelector("#tagsInput"),
  sourceReviewInput: document.querySelector("#sourceReviewInput"),
  saveButton: document.querySelector("#saveButton"),
  cardCount: document.querySelector("#cardCount"),
  librarySearchInput: document.querySelector("#librarySearchInput"),
  cardList: document.querySelector("#cardList"),
  questionInput: document.querySelector("#questionInput"),
  askButton: document.querySelector("#askButton"),
  answerPanel: document.querySelector("#answerPanel")
};

window.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await refreshCards();
});

function bindEvents() {
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
      setStatus("Card saved");
    });
  });

  elements.librarySearchInput.addEventListener("input", () => {
    renderCards();
  });

  elements.askButton.addEventListener("click", async () => {
    await runAction("Asking", async () => {
      const answer = await window.denote.ask(elements.questionInput.value);
      renderAnswer(answer);
      setStatus(answer.status === "answered" ? "Answered from saved knowledge" : "Insufficient evidence");
    });
  });
}

async function refreshCards() {
  state.cards = await window.denote.listCards();
  renderCards();
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
    elements.cardList.innerHTML = `<p class="muted">No cards yet.</p>`;
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
