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

  it("supports demo schedule cards and soft delete", () => {
    expect(mainSource).toContain("CARD_KINDS");
    expect(mainSource).toContain("CARD_STATUSES");
    expect(mainSource).toContain("due_date");
    expect(mainSource).toContain("denote:updateCardStatus");
    expect(mainSource).toContain('card.status = "deleted"');
    expect(mainSource).toContain("isScheduleQuestion");
    expect(mainSource).toContain("visibleCards");
  });

  it("logs LLM diagnostics and exposes log paths", () => {
    expect(mainSource).toContain("getLogFilePath");
    expect(mainSource).toContain("denote:getDiagnostics");
    expect(mainSource).toContain("writeLog");
    expect(mainSource).toContain("LLM_TIMEOUT_MS");
    expect(mainSource).toContain("llm.request.timeout");
    expect(mainSource).toContain("llm.response.invalid_json");
    expect(mainSource).toContain("responseSnippet");
  });

  it("does not return the old local insufficient evidence answer", () => {
    expect(mainSource).not.toContain("I do not have enough saved Denote knowledge to answer that yet.");
  });
});