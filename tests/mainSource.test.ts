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
});
