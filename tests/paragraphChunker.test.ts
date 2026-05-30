import { describe, expect, it } from "vitest";
import { chunkParagraphs } from "../src/chunking/paragraphChunker.js";

describe("paragraph fallback chunking", () => {
  it("creates source-traceable chunks with stable character spans", () => {
    const source = "First paragraph about Denote.\n\nSecond paragraph about LanceDB.\n\nThird paragraph about SQLite.";

    const chunks = chunkParagraphs(source);

    expect(chunks).toHaveLength(3);
    expect(chunks[1]).toMatchObject({
      chunk_index: 1,
      source_start_char: source.indexOf("Second"),
      source_end_char: source.indexOf("Second") + "Second paragraph about LanceDB.".length,
      source_excerpt: "Second paragraph about LanceDB.",
      retrieval_text: "Second paragraph about LanceDB.",
      chunk_strategy: "paragraph_fallback"
    });
  });

  it("drops whitespace-only paragraphs without losing spans for real paragraphs", () => {
    const source = "\n\n  Alpha note.  \n\n   \n\nBeta note.";

    const chunks = chunkParagraphs(source);

    expect(chunks.map((chunk) => chunk.source_excerpt)).toEqual(["Alpha note.", "Beta note."]);
    expect(chunks[0]?.source_start_char).toBe(source.indexOf("Alpha"));
    expect(chunks[1]?.source_start_char).toBe(source.indexOf("Beta"));
  });
});
