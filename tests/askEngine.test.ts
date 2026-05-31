import { describe, expect, it } from "vitest";
import { answerFromCards } from "../src/ask/askEngine.js";

describe("keyword ask engine", () => {
  const cards = [
    {
      id: "card-1",
      title: "Hybrid retrieval",
      summary: "RRF combines vector and keyword search.",
      tags: ["rag", "retrieval"],
      content_type: "technical_note" as const,
      source_text: "Hybrid retrieval should combine keyword search and vector search. Citations must use source excerpts.",
      created_at: "2026-05-31T00:00:00.000Z",
      updated_at: "2026-05-31T00:00:00.000Z"
    },
    {
      id: "card-2",
      title: "Desktop shell",
      summary: "Electron packages Denote.",
      tags: ["electron"],
      content_type: "technical_note" as const,
      source_text: "Electron packages the app as a Windows installer.",
      created_at: "2026-05-31T00:00:00.000Z",
      updated_at: "2026-05-31T00:00:00.000Z"
    }
  ];

  it("answers with citations from matching saved cards", () => {
    const answer = answerFromCards("How should citations work in retrieval?", cards);

    expect(answer.status).toBe("answered");
    expect(answer.text).toContain("Hybrid retrieval");
    expect(answer.sources).toEqual([
      {
        card_id: "card-1",
        title: "Hybrid retrieval",
        excerpt: "Hybrid retrieval should combine keyword search and vector search. Citations must use source excerpts."
      }
    ]);
  });

  it("returns insufficient evidence when no card matches", () => {
    const answer = answerFromCards("How do I cook pasta?", cards);

    expect(answer.status).toBe("insufficient_evidence");
    expect(answer.sources).toEqual([]);
  });
});
