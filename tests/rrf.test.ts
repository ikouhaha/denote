import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "../src/retrieval/rrf.js";

describe("reciprocal rank fusion", () => {
  it("combines vector and keyword rankings deterministically", () => {
    const fused = reciprocalRankFusion({
      rankings: [
        { source: "vector", ids: ["chunk-a", "chunk-b", "chunk-c"] },
        { source: "keyword", ids: ["chunk-b", "chunk-d", "chunk-a"] }
      ],
      k: 60
    });

    expect(fused.map((hit) => hit.id)).toEqual(["chunk-b", "chunk-a", "chunk-d", "chunk-c"]);
    expect(fused[0]?.sources).toEqual(["vector", "keyword"]);
  });

  it("uses first-seen order as the final tie breaker", () => {
    const fused = reciprocalRankFusion({
      rankings: [
        { source: "vector", ids: ["a", "b"] },
        { source: "keyword", ids: ["c", "d"] }
      ],
      k: 60
    });

    expect(fused.map((hit) => hit.id)).toEqual(["a", "c", "b", "d"]);
  });
});
