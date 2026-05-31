import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ProviderSettings = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  taskProvider: "local" | "notion";
  notionToken: string;
  notionTasksDatabaseId: string;
  notionTaskSources: NotionTaskSourceSetting[];
  activeNotionTokenId: string;
  notionTokens: NotionTokenSetting[];
};

export type NotionTaskSourceSetting = {
  id: string;
  name: string;
  enabled: boolean;
};

export type NotionTokenSetting = {
  id: string;
  name: string;
  token: string;
  taskSources: NotionTaskSourceSetting[];
};

export const defaultProviderSettings: ProviderSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  chatModel: "gpt-4.1-mini",
  embeddingModel: "text-embedding-3-small",
  taskProvider: "local",
  notionToken: "",
  notionTasksDatabaseId: "",
  notionTaskSources: [],
  activeNotionTokenId: "",
  notionTokens: []
};

export type SettingsStoreOptions = {
  codexConfigPath?: string;
};

export class SettingsStore {
  private readonly filePath: string;
  private readonly codexConfigPath: string;

  constructor(private readonly dataDir: string, options: SettingsStoreOptions = {}) {
    this.filePath = join(dataDir, "settings.json");
    this.codexConfigPath = options.codexConfigPath ?? join(homedir(), ".codex", "config.toml");
  }

  async getSettings(): Promise<ProviderSettings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return this.applySafeCodexDefaults(normalizeSettings(JSON.parse(raw)));
    } catch (error) {
      if (isNotFoundError(error)) {
        return this.getDefaultSettings();
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

  private async getDefaultSettings(): Promise<ProviderSettings> {
    const codexDefaults = await readCodexProviderDefaults(this.codexConfigPath);
    return normalizeSettings({
      ...defaultProviderSettings,
      ...codexDefaults,
      apiKey: ""
    });
  }

  private async applySafeCodexDefaults(settings: ProviderSettings): Promise<ProviderSettings> {
    if (
      settings.apiKey ||
      settings.baseUrl !== defaultProviderSettings.baseUrl ||
      settings.chatModel !== defaultProviderSettings.chatModel
    ) {
      return settings;
    }

    const codexDefaults = await readCodexProviderDefaults(this.codexConfigPath);
    if (!codexDefaults.baseUrl && !codexDefaults.chatModel) {
      return settings;
    }

    return normalizeSettings({
      ...settings,
      ...codexDefaults,
      apiKey: ""
    });
  }
}

function normalizeSettings(input: Partial<ProviderSettings>): ProviderSettings {
  const legacyInput = input as Partial<ProviderSettings> & {
    activeNotionWorkspaceId?: string;
    notionWorkspaces?: unknown;
  };
  const notionTasksDatabaseId = String(input.notionTasksDatabaseId || "").trim();
  const notionTaskSources = normalizeNotionTaskSources(input.notionTaskSources, notionTasksDatabaseId);
  const notionToken = String(input.notionToken || "").trim();
  const notionTokens = normalizeNotionTokens(input.notionTokens ?? legacyInput.notionWorkspaces, notionToken, notionTaskSources);
  const requestedTokenId = String(input.activeNotionTokenId || legacyInput.activeNotionWorkspaceId || "").trim();
  const activeNotionTokenId = notionTokens.some((tokenProfile) => tokenProfile.id === requestedTokenId)
    ? requestedTokenId
    : notionTokens[0]?.id || "";
  return {
    baseUrl: normalizeUrl(input.baseUrl || defaultProviderSettings.baseUrl),
    apiKey: String(input.apiKey || "").trim(),
    chatModel: String(input.chatModel || defaultProviderSettings.chatModel).trim(),
    embeddingModel: String(input.embeddingModel || defaultProviderSettings.embeddingModel).trim(),
    taskProvider: input.taskProvider === "notion" ? "notion" : "local",
    notionToken,
    notionTasksDatabaseId,
    notionTaskSources,
    activeNotionTokenId,
    notionTokens
  };
}

function normalizeNotionTokens(
  input: unknown,
  legacyToken = "",
  legacyTaskSources: NotionTaskSourceSetting[] = []
): NotionTokenSetting[] {
  const tokenProfiles = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const normalized: NotionTokenSetting[] = [];

  for (const tokenProfile of tokenProfiles) {
    if (!tokenProfile || typeof tokenProfile !== "object") {
      continue;
    }
    const record = tokenProfile as Partial<NotionTokenSetting>;
    const id = String(record.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    normalized.push({
      id,
      name: String(record.name || "").trim() || id,
      token: String(record.token || "").trim(),
      taskSources: normalizeNotionTaskSources(record.taskSources)
    });
  }

  if (normalized.length === 0 && legacyToken) {
    normalized.push({
      id: "notion-token-1",
      name: "Notion token 1",
      token: legacyToken,
      taskSources: legacyTaskSources
    });
  }

  return normalized;
}

function normalizeNotionTaskSources(input: unknown, legacySourceId = ""): NotionTaskSourceSetting[] {
  const sources = Array.isArray(input) ? input : [];
  const seen = new Set<string>();
  const normalized: NotionTaskSourceSetting[] = [];

  for (const source of sources) {
    if (!source || typeof source !== "object") {
      continue;
    }
    const record = source as Partial<NotionTaskSourceSetting>;
    const id = String(record.id || "").trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name = String(record.name || "").trim() || id;
    normalized.push({
      id,
      name,
      enabled: record.enabled !== false
    });
  }

  const legacyId = String(legacySourceId || "").trim();
  if (legacyId && normalized.length === 0 && !seen.has(legacyId)) {
    normalized.unshift({ id: legacyId, name: legacyId, enabled: true });
  }

  return normalized;
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

async function readCodexProviderDefaults(configPath: string): Promise<Partial<ProviderSettings>> {
  try {
    const raw = await readFile(configPath, "utf8");
    const provider = readTomlString(raw, "model_provider");
    const model = readTomlString(raw, "model");
    const baseUrl = provider ? readTomlSectionString(raw, `model_providers.${provider}`, "base_url") : undefined;

    return {
      ...(baseUrl ? { baseUrl } : {}),
      ...(model ? { chatModel: model } : {})
    };
  } catch (error) {
    if (isNotFoundError(error)) {
      return {};
    }
    throw error;
  }
}

function readTomlString(raw: string, key: string): string | undefined {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = raw.match(new RegExp(`^${escapedKey}\\s*=\\s*"([^"]+)"`, "m"));
  return match?.[1];
}

function readTomlSectionString(raw: string, section: string, key: string): string | undefined {
  const lines = raw.split(/\r?\n/);
  let inSection = false;

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (sectionMatch) {
      inSection = sectionMatch[1] === section;
      continue;
    }
    if (inSection) {
      const value = line.match(new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"`));
      if (value) {
        return value[1];
      }
    }
  }

  return undefined;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === "ENOENT"
  );
}
