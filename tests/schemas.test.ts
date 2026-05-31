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
      project: " Denote ",
      source_text: "Hybrid retrieval uses vector and keyword search."
    });

    expect(parsed.title).toBe("Denote Retrieval Notes");
    expect(parsed.project).toBe("Denote");
    expect(parsed.card_kind).toBe("knowledge");
    expect(parsed.status).toBe("open");
    expect(parsed.due_date).toBe("");
    expect(parsed.tags).toEqual(["rag", "sqlite"]);
  });

  it("accepts demo schedule fields on cards", () => {
    const parsed = knowledgeCardDraftSchema.parse({
      title: "Ask QVAT vendor",
      summary: "Follow up about JE upload failure.",
      project: "QVAT",
      card_kind: "task",
      status: "open",
      due_date: "2026-06-01",
      due_time: "09:30",
      tags: ["qvat", "vendor"],
      content_type: "project_note",
      project_id: null,
      source_text: "明天 09:30 問 QVAT vendor 為什麼 JE upload fail"
    });

    expect(parsed).toMatchObject({
      card_kind: "task",
      status: "open",
      due_date: "2026-06-01",
      due_time: "09:30"
    });
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
