import { z } from "zod";

export const contentTypeSchema = z.enum([
  "technical_note",
  "project_note",
  "reference",
  "personal_note",
  "captured_qa",
  "other"
]);

export type ContentType = z.infer<typeof contentTypeSchema>;

export function normalizeTags(tags: readonly string[]): string[] {
  const normalized = new Set<string>();

  for (const tag of tags) {
    const clean = tag.trim().toLowerCase();
    if (clean.length > 0) {
      normalized.add(clean);
    }
  }

  return [...normalized];
}

const trimmedNonEmptyString = z.string().trim().min(1);

export const knowledgeCardDraftSchema = z.object({
  title: trimmedNonEmptyString,
  summary: trimmedNonEmptyString,
  project: z.string().trim().default(""),
  tags: z.array(z.string()).transform(normalizeTags),
  content_type: contentTypeSchema,
  project_id: z.string().uuid().nullable(),
  source_text: trimmedNonEmptyString
});

export type KnowledgeCardDraft = z.infer<typeof knowledgeCardDraftSchema>;
