import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
    const store = new SettingsStore(tempDir, { codexConfigPath: join(tempDir, "missing-config.toml") });

    await expect(store.getSettings()).resolves.toEqual(defaultProviderSettings);
  });

  it("prefills non-secret Codex provider settings when available", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "denote-settings-"));
    const codexDir = join(tempDir, "codex");
    mkdirSync(codexDir);
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'model_provider = "tabcode"',
        'model = "gpt-5.5"',
        "",
        "[model_providers.tabcode]",
        'base_url = "https://www.micuapi.ai/v1"',
        'env_key = "TABCODE_API_KEY"'
      ].join("\n"),
      "utf8"
    );
    const store = new SettingsStore(tempDir, { codexConfigPath: join(codexDir, "config.toml") });

    await expect(store.getSettings()).resolves.toEqual({
      baseUrl: "https://www.micuapi.ai/v1",
      apiKey: "",
      chatModel: "gpt-5.5",
      embeddingModel: defaultProviderSettings.embeddingModel
    });
  });

  it("upgrades old blank default settings with safe Codex provider values", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "denote-settings-"));
    const codexDir = join(tempDir, "codex");
    mkdirSync(codexDir);
    writeFileSync(
      join(codexDir, "config.toml"),
      [
        'model_provider = "tabcode"',
        'model = "gpt-5.5"',
        "",
        "[model_providers.tabcode]",
        'base_url = "https://www.micuapi.ai/v1"'
      ].join("\n"),
      "utf8"
    );
    writeFileSync(join(tempDir, "settings.json"), JSON.stringify(defaultProviderSettings), "utf8");

    const store = new SettingsStore(tempDir, { codexConfigPath: join(codexDir, "config.toml") });

    await expect(store.getSettings()).resolves.toMatchObject({
      baseUrl: "https://www.micuapi.ai/v1",
      apiKey: "",
      chatModel: "gpt-5.5"
    });
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
