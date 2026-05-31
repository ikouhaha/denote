import { type KnowledgeCardDraft, knowledgeCardDraftSchema } from "./schemas.js";

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "can",
  "from",
  "into",
  "should",
  "that",
  "the",
  "this",
  "with",
  "while",
  "will"
]);

export function generateLocalDraft(sourceText: string): KnowledgeCardDraft {
  const normalizedSource = sourceText.trim();
  if (!normalizedSource) {
    throw new Error("Source text is required");
  }

  const lines = normalizedSource
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const title = deriveTitle(lines, normalizedSource);
  const summary = deriveSummary(lines, normalizedSource, title);
  const project = deriveProject(lines);
  const tags = deriveTags(normalizedSource);

  return knowledgeCardDraftSchema.parse({
    title,
    summary,
    project,
    tags,
    content_type: "technical_note",
    project_id: null,
    source_text: normalizedSource
  });
}

function deriveProject(lines: string[]): string {
  const firstLine = lines[0] ?? "";
  const label = firstLine.match(/^([A-Z][A-Z0-9_-]{1,30})\s*[:：]/)?.[1];
  return label ?? "";
}

function deriveTitle(lines: string[], sourceText: string): string {
  const firstLine = lines[0] ?? sourceText;
  const sentence = firstLine.match(/^[^.!?。！？]+/)?.[0] ?? firstLine;
  return truncate(sentence.trim(), 80);
}

function deriveSummary(lines: string[], sourceText: string, title: string): string {
  const body = lines.length > 1 ? lines.slice(1).join(" ") : sourceText;
  const firstSentence = body.match(/[^.!?。！？]+[.!?。！？]?/)?.[0]?.trim();
  const summary = firstSentence && firstSentence !== title ? firstSentence : sourceText;
  return truncate(summary, 180);
}

function deriveTags(sourceText: string): string[] {
  const counts = new Map<string, number>();
  const words = sourceText.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];

  for (const word of words) {
    if (STOP_WORDS.has(word)) {
      continue;
    }
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([word]) => word);
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1).trim()}...`;
}
