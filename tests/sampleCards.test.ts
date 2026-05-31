import { describe, expect, it } from "vitest";
import { sampleCards } from "../src/samples/sampleCards.js";

describe("sample cards", () => {
  it("provide enough realistic content to test Ask immediately", () => {
    expect(sampleCards).toHaveLength(3);
    expect(sampleCards.map((card) => card.title)).toContain("Denote retrieval strategy");
    expect(sampleCards.flatMap((card) => card.tags)).toEqual(
      expect.arrayContaining(["rag", "sqlite", "lancedb", "mcp"])
    );
  });
});
