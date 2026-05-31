const fs = require("node:fs/promises");
const crypto = require("node:crypto");
const os = require("node:os");
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
  await ensureSampleCards();
  const store = await readStore();
  return store.cards.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
});

ipcMain.handle("denote:ask", async (_event, question) => {
  await ensureSampleCards();
  const store = await readStore();
  return answerFromCards(normalizeQuestionInput(question), store.cards);
});

ipcMain.handle("denote:getSettings", async () => {
  return readSettings();
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
  embeddingModel: "text-embedding-3-small"
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
