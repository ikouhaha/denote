import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultProviderSettings, SettingsStore } from "../src/settings/settingsStore.js";

let tempDir: string | undefined;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { force: true, recursive: true });
    tempDir = undefined;
  }
});

describe("SettingsStore", () => {
  it("returns provider defaults on first run", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "denote-settings-"));
    const store = new SettingsStore(tempDir);

    await expect(store.getSettings()).resolves.toEqual(defaultProviderSettings);
  });

  it("persists normalized provider settings", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "denote-settings-"));
    const store = new SettingsStore(tempDir);

    await store.saveSettings({
      baseUrl: "https://openrouter.ai/api/v1/",
      apiKey: " sk-test ",
      chatModel: "openai/gpt-4.1-mini",
      embeddingModel: "openai/text-embedding-3-small"
    });

    await expect(new SettingsStore(tempDir).getSettings()).resolves.toMatchObject({
      baseUrl: "https://openrouter.ai/api/v1",
      apiKey: "sk-test",
      chatModel: "openai/gpt-4.1-mini",
      embeddingModel: "openai/text-embedding-3-small"
    });
  });
});
