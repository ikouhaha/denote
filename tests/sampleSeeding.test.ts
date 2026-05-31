import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { sampleCards } from "../src/samples/sampleCards.js";
import { ensureSampleCards } from "../src/samples/sampleSeeder.js";
import { CardStore } from "../src/storage/cardStore.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("sample seeding", () => {
  it("adds built-in samples once on first run", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "denote-samples-"));
    const store = new CardStore(tempDir);

    const first = await ensureSampleCards(store);
    const second = await ensureSampleCards(store);
    const cards = await store.listCards();

    expect(first.added).toBe(sampleCards.length);
    expect(second.added).toBe(0);
    expect(cards).toHaveLength(sampleCards.length);
    expect(cards.map((card) => card.title)).toContain("QVAT support case: wholesale invoice mismatch");
  });
});
