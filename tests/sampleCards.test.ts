import { describe, expect, it } from "vitest";
import { sampleCards } from "../src/samples/sampleCards.js";

describe("sample cards", () => {
  it("provide enough realistic content to test Ask immediately", () => {
    expect(sampleCards.length).toBeGreaterThanOrEqual(4);
    expect(sampleCards.map((card) => card.title)).toContain("QVAT support case: wholesale invoice mismatch");
    expect(sampleCards.flatMap((card) => card.tags)).toEqual(
      expect.arrayContaining(["qvat", "support-case", "invoice", "je"])
    );
  });

  it("keeps built-in QVAT samples free of obvious credentials", () => {
    const combined = sampleCards.map((card) => card.source_text).join("\n").toLowerCase();

    expect(combined).not.toContain("password");
    expect(combined).not.toContain("login:");
    expect(combined).not.toContain("qvat_uat_user");
  });
});
