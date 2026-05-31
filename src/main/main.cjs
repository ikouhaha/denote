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
const CARD_KINDS = new Set(["knowledge", "task", "event", "reminder"]);
const CARD_STATUSES = new Set(["open", "done", "archived", "deleted"]);
const SCHEDULE_KINDS = new Set(["task", "event", "reminder"]);

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
  const parsed = parseJsonObject(text);

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
  const parsed = parseJsonObject(text);
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
  const response = await fetch(`${settings.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model: settings.chatModel,
      messages,
      temperature: 0.2
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${truncate(errorText, 240)}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM response did not contain message content");
  }
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
