import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const interviewSource = `Thank you for applying this position. You are invited to an interview with me on 3/6 (Wednesday) 15:30.

If you can attend the interview, please fill-in attached form and return to me as confirmation of interview.

My office address is : 22/F, Yen Sheng Centre, 64 Hoi Yuen Road, Kwun Tong, Kowloon, Hong Kong

Kenneth Chan
Head of Technology Services, Data & Advance Solutions
Expert Systems Limited`;

function resolveSettingsPath() {
  const candidates = [
    process.env.DENOTE_SETTINGS_PATH,
    process.env.APPDATA ? join(process.env.APPDATA, "com.denote.desktop", "settings.json") : "",
    process.env.APPDATA ? join(process.env.APPDATA, "denote", "settings.json") : ""
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(`Denote settings.json was not found. Checked: ${candidates.join(", ")}`);
  }
  return found;
}

function parseAssistantJson(content) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end < start) {
    throw new Error(`LLM did not return a JSON object. Prefix: ${content.slice(0, 240)}`);
  }
  return JSON.parse(content.slice(start, end + 1));
}

function requireField(value, label) {
  if (!String(value || "").trim()) {
    throw new Error(`${label} is missing from LLM draft response`);
  }
}

const settingsPath = resolveSettingsPath();
const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
const baseUrl = String(settings.baseUrl || "").replace(/\/+$/, "");
const apiKey = String(settings.apiKey || "").trim();
const chatModel = String(settings.chatModel || "").trim();

if (!baseUrl || !chatModel || !apiKey) {
  throw new Error(`LLM settings are incomplete: baseUrl=${Boolean(baseUrl)}, chatModel=${Boolean(chatModel)}, apiKey=${Boolean(apiKey)}`);
}

const body = {
  model: chatModel,
  temperature: 0.2,
  messages: [
    {
      role: "system",
      content:
        "You convert messy notes into a Denote card. Return only JSON with fields: title, summary, project, card_kind, status, due_date, due_time, tags, content_type, source_text. card_kind must be one of knowledge, task, event, reminder. status must be open unless the source says it is done. due_date must be YYYY-MM-DD when the text contains a date or relative date; use the current date context from the user message to resolve words like tomorrow. due_time must be HH:MM 24-hour time or empty. content_type must be one of technical_note, project_note, reference, personal_note, captured_qa, other. tags must be an array of short lowercase strings. Preserve the original source_text exactly."
    },
    {
      role: "user",
      content: `Current date: 2026-06-02\n\nSource text:\n${interviewSource}`
    }
  ]
};

const endpoint = `${baseUrl}/chat/completions`;
const startedAt = Date.now();
const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`
  },
  body: JSON.stringify(body)
});
const responseText = await response.text();
const durationMs = Date.now() - startedAt;

if (!response.ok) {
  throw new Error(`LLM request failed: HTTP ${response.status}. Body prefix: ${responseText.slice(0, 360)}`);
}

const payload = JSON.parse(responseText);
const content = payload.choices?.[0]?.message?.content || "";
const draft = parseAssistantJson(content);
const rendererDraft = {
  title: draft.title,
  summary: draft.summary,
  project: draft.project || "",
  card_kind: draft.card_kind || "knowledge",
  status: draft.status || "open",
  due_date: draft.due_date || "",
  due_time: draft.due_time || "",
  tags: Array.isArray(draft.tags) ? draft.tags : [],
  content_type: draft.content_type || "technical_note",
  source_text: String(draft.source_text || interviewSource).trim()
};

requireField(rendererDraft.title, "title");
requireField(rendererDraft.summary, "summary");
requireField(rendererDraft.source_text, "source_text");

if (!rendererDraft.source_text.includes("You are invited to an interview")) {
  throw new Error("source_text does not preserve the pasted interview invitation");
}
if (rendererDraft.due_date !== "2026-06-03") {
  throw new Error(`due_date should be 2026-06-03, got ${JSON.stringify(rendererDraft.due_date)}`);
}
if (rendererDraft.due_time !== "15:30") {
  throw new Error(`due_time should be 15:30, got ${JSON.stringify(rendererDraft.due_time)}`);
}
if ("sourceText" in rendererDraft || "dueDate" in rendererDraft || "dueTime" in rendererDraft) {
  throw new Error("Renderer draft must use snake_case fields, not camelCase fields");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      settingsPath,
      endpoint,
      model: chatModel,
      durationMs,
      draft: {
        title: rendererDraft.title,
        card_kind: rendererDraft.card_kind,
        due_date: rendererDraft.due_date,
        due_time: rendererDraft.due_time,
        sourceTextPreserved: true
      }
    },
    null,
    2
  )
);
