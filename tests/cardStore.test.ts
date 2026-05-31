import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CardStore } from "../src/storage/cardStore.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("CardStore", () => {
  it("persists saved cards and reloads them from disk", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "denote-store-"));
    const store = new CardStore(tempDir);

    const saved = await store.saveCard({
      title: "Vendor database notes",
      summary: "How to preserve local vendor knowledge.",
      project: "Vendor DB",
      tags: ["vendor", "database"],
      content_type: "technical_note",
      source_text: "Vendor database notes should remain local and searchable."
    });

    const reloaded = new CardStore(tempDir);
    const cards = await reloaded.listCards();

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: saved.id,
      title: "Vendor database notes",
      project: "Vendor DB",
      tags: ["vendor", "database"]
    });
  });

  it("normalizes blank project names when saving", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "denote-store-"));
    const store = new CardStore(tempDir);

    const saved = await store.saveCard({
      title: "Project",
      summary: "Project names are optional.",
      project: "  ",
      tags: ["project"],
      content_type: "technical_note",
      source_text: "A card can be saved without a project."
    });

    expect(saved.project).toBe("");
  });

  it("normalizes tags before saving", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "denote-store-"));
    const store = new CardStore(tempDir);

    const saved = await store.saveCard({
      title: "Tags",
      summary: "Tags are normalized.",
      tags: [" RAG ", "rag", ""],
      content_type: "technical_note",
      source_text: "RAG tags should deduplicate."
    });

    expect(saved.tags).toEqual(["rag"]);
  });

  it("deletes a saved card from disk", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "denote-store-"));
    const store = new CardStore(tempDir);

    const saved = await store.saveCard({
      title: "Delete me",
      summary: "This card should be removed.",
      tags: ["delete"],
      content_type: "personal_note",
      source_text: "Temporary card."
    });

    await expect(store.deleteCard(saved.id)).resolves.toEqual({ deleted: true });
    await expect(new CardStore(tempDir).listCards()).resolves.toEqual([]);
  });

  it("reports when deleting a missing card", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "denote-store-"));
    const store = new CardStore(tempDir);

    await expect(store.deleteCard("missing")).resolves.toEqual({ deleted: false });
  });
});
