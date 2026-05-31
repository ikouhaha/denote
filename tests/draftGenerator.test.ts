import { describe, expect, it } from "vitest";
import { generateLocalDraft } from "../src/cards/draftGenerator.js";

describe("local card draft generation", () => {
  it("creates an editable Knowledge Card draft from pasted text", () => {
    const draft = generateLocalDraft(`Hybrid retrieval design

Denote should combine keyword search with source citations. The first slice stores cards locally and answers from saved text.`);

    expect(draft.title).toBe("Hybrid retrieval design");
    expect(draft.summary).toBe("Denote should combine keyword search with source citations.");
    expect(draft.content_type).toBe("technical_note");
    expect(draft.tags).toContain("denote");
    expect(draft.tags).toContain("keyword");
    expect(draft.source_text).toContain("answers from saved text");
  });

  it("rejects empty source text", () => {
    expect(() => generateLocalDraft("   \n\n")).toThrow("Source text is required");
  });
});
