export type ParagraphChunk = {
  chunk_index: number;
  source_start_char: number;
  source_end_char: number;
  source_excerpt: string;
  retrieval_text: string;
  summary: string;
  keywords: string[];
  chunk_strategy: "paragraph_fallback";
};

export function chunkParagraphs(sourceText: string): ParagraphChunk[] {
  const chunks: ParagraphChunk[] = [];
  const paragraphPattern = /[^\S\r\n]*(\S(?:.*?\S)?)\s*(?:\r?\n\s*\r?\n|$)/gs;

  for (const match of sourceText.matchAll(paragraphPattern)) {
    const paragraph = match[1];
    if (!paragraph) {
      continue;
    }

    const sourceStart = (match.index ?? 0) + match[0].indexOf(paragraph);
    const sourceEnd = sourceStart + paragraph.length;

    chunks.push({
      chunk_index: chunks.length,
      source_start_char: sourceStart,
      source_end_char: sourceEnd,
      source_excerpt: paragraph,
      retrieval_text: paragraph,
      summary: "",
      keywords: [],
      chunk_strategy: "paragraph_fallback"
    });
  }

  return chunks;
}
