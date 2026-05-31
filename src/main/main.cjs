const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = require("electron");

const CONTENT_TYPES = new Set([
  "technical_note",
  "project_note",
  "reference",
  "personal_note",
  "captured_qa",
  "other"
]);

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

ipcMain.handle("denote:generateDraft", (_event, sourceText) => {
  return generateDraft(String(sourceText ?? ""));
});

ipcMain.handle("denote:saveCard", async (_event, input) => {
  return saveCard(input);
});

ipcMain.handle("denote:listCards", async () => {
  const store = await readStore();
  return store.cards.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
});

ipcMain.handle("denote:ask", async (_event, question) => {
  const store = await readStore();
  return answerFromCards(String(question ?? ""), store.cards);
});

ipcMain.handle("denote:getSettings", async () => {
  return readSettings();
});

ipcMain.handle("denote:saveSettings", async (_event, input) => {
  return saveSettings(input);
});

ipcMain.handle("denote:seedSamples", async () => {
  const store = await readStore();
  const existingTitles = new Set(store.cards.map((card) => card.title));
  const added = [];

  for (const sample of SAMPLE_CARDS) {
    if (!existingTitles.has(sample.title)) {
      added.push(await saveCard(sample));
    }
  }

  return { added: added.length, cards: (await readStore()).cards };
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
    tags: deriveTags(source),
    content_type: "technical_note",
    source_text: source
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

async function readStore() {
  try {
    const raw = await fs.readFile(getCardsFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    return { cards: Array.isArray(parsed.cards) ? parsed.cards : [] };
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
    return normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { ...DEFAULT_SETTINGS };
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

function answerFromCards(question, cards) {
  const terms = tokenize(question).filter((term) => !STOP_WORDS.has(term));
  if (terms.length === 0) {
    return insufficientAnswer();
  }

  const ranked = cards
    .map((card) => ({ card, score: scoreCard(terms, card) }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.card.title.localeCompare(b.card.title));

  const best = ranked[0]?.card;
  if (!best) {
    return insufficientAnswer();
  }

  return {
    status: "answered",
    text: `${best.title}: ${best.summary}`,
    sources: [
      {
        card_id: best.id,
        title: best.title,
        excerpt: selectExcerpt(terms, best.source_text)
      }
    ]
  };
}

function insufficientAnswer() {
  return {
    status: "insufficient_evidence",
    text: "I do not have enough saved Denote knowledge to answer that yet.",
    sources: []
  };
}

function scoreCard(terms, card) {
  const haystack = `${card.title} ${card.summary} ${(card.tags || []).join(" ")} ${card.source_text}`.toLowerCase();
  return terms.reduce((score, term) => (haystack.includes(term) ? score + 1 : score), 0);
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

function tokenize(value) {
  return String(value).toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) || [];
}

function normalizeTags(tags) {
  return [...new Set(tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))];
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

function normalizeSettings(input) {
  return {
    baseUrl: String(input.baseUrl || DEFAULT_SETTINGS.baseUrl).trim().replace(/\/+$/, ""),
    apiKey: String(input.apiKey || "").trim(),
    chatModel: String(input.chatModel || DEFAULT_SETTINGS.chatModel).trim(),
    embeddingModel: String(input.embeddingModel || DEFAULT_SETTINGS.embeddingModel).trim()
  };
}

const DEFAULT_SETTINGS = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  chatModel: "gpt-4.1-mini",
  embeddingModel: "text-embedding-3-small"
};

const SAMPLE_CARDS = [
  {
    title: "Denote retrieval strategy",
    summary: "Denote should use hybrid retrieval so exact terms and semantic meaning both matter.",
    tags: ["denote", "rag", "retrieval"],
    content_type: "technical_note",
    source_text:
      "Denote retrieval should combine keyword search with vector search. Keyword search catches exact terms like SQLite, MCP, vendor codes, and model names. Vector search helps with semantic questions. Answers should cite source excerpts so users can trust where the answer came from."
  },
  {
    title: "Local-first storage boundary",
    summary: "SQLite should be the source of truth while vector indexes remain rebuildable.",
    tags: ["sqlite", "lancedb", "local-first"],
    content_type: "technical_note",
    source_text:
      "Denote is local-first in storage. SQLite should store cards, chunks, tags, projects, provider settings, and index jobs. LanceDB can store vectors, but it must be rebuildable from SQLite because derived indexes can drift or fail."
  },
  {
    title: "MCP and mobile are future adapters",
    summary: "MCP and mobile relay should wrap BrainEngine later, not distort the MVP.",
    tags: ["mcp", "mobile", "architecture"],
    content_type: "project_note",
    source_text:
      "Future MCP support should be an adapter around BrainEngine operations such as search, add, and ask. Mobile access should avoid public port forwarding and can use a relay pattern later. The MVP should validate desktop local knowledge first."
  }
];
