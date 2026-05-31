import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ProviderSettings = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
};

export const defaultProviderSettings: ProviderSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  chatModel: "gpt-4.1-mini",
  embeddingModel: "text-embedding-3-small"
};

export class SettingsStore {
  private readonly filePath: string;

  constructor(private readonly dataDir: string) {
    this.filePath = join(dataDir, "settings.json");
  }

  async getSettings(): Promise<ProviderSettings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return normalizeSettings(JSON.parse(raw));
    } catch (error) {
      if (isNotFoundError(error)) {
        return { ...defaultProviderSettings };
      }
      throw error;
    }
  }

  async saveSettings(input: Partial<ProviderSettings>): Promise<ProviderSettings> {
    const settings = normalizeSettings(input);
    await mkdir(this.dataDir, { recursive: true });
    await writeFile(this.filePath, JSON.stringify(settings, null, 2), "utf8");
    return settings;
  }
}

function normalizeSettings(input: Partial<ProviderSettings>): ProviderSettings {
  return {
    baseUrl: normalizeUrl(input.baseUrl || defaultProviderSettings.baseUrl),
    apiKey: String(input.apiKey || "").trim(),
    chatModel: String(input.chatModel || defaultProviderSettings.chatModel).trim(),
    embeddingModel: String(input.embeddingModel || defaultProviderSettings.embeddingModel).trim()
  };
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}
