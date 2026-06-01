import { homedir } from "node:os";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type ProviderSettings = {
  baseUrl: string;
  apiKey: string;
  chatModel: string;
  embeddingModel: string;
  syncProvider: "local" | "cloudflare";
  cloudflare: CloudflareSyncSettings;
  taskProvider: "local";
};

export type CloudflareSyncSettings = {
  endpoint: string;
  licenseKey: string;
  autoSyncEnabled: boolean;
  lastSyncedAt: string;
};

export const defaultProviderSettings: ProviderSettings = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  chatModel: "gpt-4.1-mini",
  embeddingModel: "text-embedding-3-small",
  syncProvider: "local",
  cloudflare: {
    endpoint: "https://denote-sync-api.ikouhaha888.workers.dev",
    licenseKey: "",
    autoSyncEnabled: true,
    lastSyncedAt: ""
  },
  taskProvider: "local"
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
  return {
    baseUrl: normalizeUrl(input.baseUrl || defaultProviderSettings.baseUrl),
    apiKey: String(input.apiKey || "").trim(),
    chatModel: String(input.chatModel || defaultProviderSettings.chatModel).trim(),
    embeddingModel: String(input.embeddingModel || defaultProviderSettings.embeddingModel).trim(),
    syncProvider: normalizeSyncProvider(input.syncProvider),
    cloudflare: normalizeCloudflareSyncSettings(input.cloudflare),
    taskProvider: "local"
  };
}

function normalizeSyncProvider(value: unknown): ProviderSettings["syncProvider"] {
  return value === "cloudflare" ? value : "local";
}

function normalizeCloudflareSyncSettings(input: unknown): CloudflareSyncSettings {
  const record = input && typeof input === "object" ? (input as Partial<CloudflareSyncSettings>) : {};
  return {
    endpoint: normalizeHttpUrl(record.endpoint, defaultProviderSettings.cloudflare.endpoint),
    licenseKey: String(record.licenseKey || "").trim(),
    autoSyncEnabled: record.autoSyncEnabled !== false,
    lastSyncedAt: String(record.lastSyncedAt || "").trim()
  };
}

function normalizeHttpUrl(value: unknown, fallback: string): string {
  const text = normalizeUrl(String(value || fallback));
  return /^https?:\/\//i.test(text) ? text : fallback;
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
