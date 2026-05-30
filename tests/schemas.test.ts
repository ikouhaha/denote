import { describe, expect, it } from "vitest";
import { knowledgeCardDraftSchema, normalizeTags } from "../src/cards/schemas.js";

describe("Knowledge Card schemas", () => {
  it("accepts the editable fields from the PRD and normalizes tags", () => {
    const parsed = knowledgeCardDraftSchema.parse({
      title: "  Denote Retrieval Notes  ",
      summary: "How hybrid retrieval should work.",
      tags: [" RAG ", "rag", "SQLite", "sqlite", "  "],
      content_type: "technical_note",
      project_id: null,
      source_text: "Hybrid retrieval uses vector and keyword search."
    });

    expect(parsed.title).toBe("Denote Retrieval Notes");
    expect(parsed.tags).toEqual(["rag", "sqlite"]);
  });

  it("rejects unknown content types", () => {
    expect(() =>
      knowledgeCardDraftSchema.parse({
        title: "Bad card",
        summary: "Invalid type",
        tags: [],
        content_type: "random_note",
        project_id: null,
        source_text: "source"
      })
    ).toThrow();
  });

  it("normalizes tags consistently outside schema parsing", () => {
    expect(normalizeTags([" MCP ", "mcp", "LanceDB", ""])).toEqual(["mcp", "lancedb"]);
  });
});
