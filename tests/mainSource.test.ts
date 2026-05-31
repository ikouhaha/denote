import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(resolve("src/main/main.cjs"), "utf8");

describe("Electron main source contracts", () => {
  it("does not auto-seed samples when listing or asking cards", () => {
    const listCardsHandler = mainSource.match(/ipcMain\.handle\("denote:listCards"[\s\S]*?\n}\);/)?.[0] ?? "";
    const askHandler = mainSource.match(/ipcMain\.handle\("denote:ask"[\s\S]*?\n}\);/)?.[0] ?? "";

    expect(listCardsHandler).not.toContain("ensureSampleCards()");
    expect(askHandler).not.toContain("ensureSampleCards()");
  });

  it("uses the configured LLM for card drafting and ask answers", () => {
    const generateDraftHandler = mainSource.match(/ipcMain\.handle\("denote:generateDraft"[\s\S]*?\n}\);/)?.[0] ?? "";
    const refineDraftHandler = mainSource.match(/ipcMain\.handle\("denote:refineDraft"[\s\S]*?\n}\);/)?.[0] ?? "";
    const askHandler = mainSource.match(/ipcMain\.handle\("denote:ask"[\s\S]*?\n}\);/)?.[0] ?? "";

    expect(generateDraftHandler).toContain("generateDraftWithLlm");
    expect(refineDraftHandler).toContain("refineDraftWithLlm");
    expect(askHandler).toContain("answerWithLlm");
  });

  it("does not return the old local insufficient evidence answer", () => {
    expect(mainSource).not.toContain("I do not have enough saved Denote knowledge to answer that yet.");
  });
});
