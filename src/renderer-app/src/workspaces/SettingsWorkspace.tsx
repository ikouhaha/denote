import { FormEvent, useEffect, useState } from "react";
import type { CloudflareSyncSettings, DenoteSettings, Diagnostics } from "../types.js";
import { formatSyncTimestamp } from "../lib/format.js";

type Props = {
  diagnostics: Diagnostics | null;
  settings: DenoteSettings | null;
  setSettings(settings: DenoteSettings): void;
  refreshSettings(): Promise<DenoteSettings>;
  runAction(label: string, action: () => Promise<void>): Promise<void>;
  setStatus(message: string): void;
};

export function SettingsWorkspace({ diagnostics, settings, setSettings, refreshSettings, runAction, setStatus }: Props) {
  const [form, setForm] = useState<Partial<DenoteSettings>>({});
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  if (!settings) {
    return null;
  }

  const cloudflare = normalizeCloudflareSyncSettings(form.cloudflare);

  async function saveSettings(event?: FormEvent) {
    event?.preventDefault();
    await runAction("Saving settings", async () => {
      const saved = await window.denote.saveSettings({
        ...form,
        cloudflare,
        taskProvider: "local"
      });
      setSettings(saved);
      setForm(saved);
      setStatus("Settings saved");
    });
  }

  async function testCloudflareSyncConnection() {
    await runAction("Testing Cloudflare sync", async () => {
      const saved = await window.denote.saveSettings({ ...form, cloudflare, syncProvider: "cloudflare", taskProvider: "local" });
      setSettings(saved);
      setForm(saved);
      const result = await window.denote.testCloudflareSyncConnection(saved.cloudflare);
      setStatus(`Cloudflare connected: ${result.cardCount} cards`);
    });
  }

  async function syncCloudflareNow() {
    await runAction("Syncing Cloudflare", async () => {
      const saved = await window.denote.saveSettings({ ...form, cloudflare, syncProvider: "cloudflare", taskProvider: "local" });
      setSettings(saved);
      setForm(saved);
      const result = await window.denote.syncCloudflareNow(saved.cloudflare);
      const refreshed = await refreshSettings();
      setForm(refreshed);
      setStatus(`Cloudflare synced: ${result.cardCount} cards`);
    });
  }

  function updateCloudflareSyncSettings(patch: Partial<CloudflareSyncSettings>) {
    setForm({ ...form, cloudflare: normalizeCloudflareSyncSettings({ ...cloudflare, ...patch }) });
  }

  async function copySecret(label: string, value: string) {
    const text = value.trim();
    if (!text) {
      setStatus(`${label} is empty`);
      return;
    }

    try {
      await writeClipboardText(text);
      setStatus(`${label} copied`);
    } catch {
      setStatus(`Could not copy ${label.toLowerCase()}`);
    }
  }

  function toggleSecretVisibility(key: string) {
    setVisibleSecrets((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <section id="settingsView" className="active-view">
      <form id="settingsForm" className="panel settings-panel" onSubmit={(event) => void saveSettings(event)}>
        <div className="panel-head">
          <div>
            <h3>AI Provider Settings</h3>
            <p>Secrets stay in local settings and provider calls stay behind the Tauri command boundary.</p>
          </div>
          <button type="submit">Save Settings</button>
        </div>
        <div className="two-col">
          <label>
            Base URL
            <input id="baseUrlInput" onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" value={form.baseUrl || ""} />
          </label>
          <label>
            API key
            <SecretInput
              id="apiKeyInput"
              isVisible={Boolean(visibleSecrets.apiKey)}
              onChange={(value) => setForm({ ...form, apiKey: value })}
              onCopy={() => void copySecret("API key", form.apiKey || "")}
              onToggle={() => toggleSecretVisibility("apiKey")}
              placeholder="Stored locally for now"
              value={form.apiKey || ""}
            />
          </label>
        </div>
        <div className="two-col">
          <label>
            Chat model
            <input id="chatModelInput" onChange={(event) => setForm({ ...form, chatModel: event.target.value })} placeholder="gpt-4.1-mini" value={form.chatModel || ""} />
          </label>
          <label>
            Embedding model
            <input id="embeddingModelInput" onChange={(event) => setForm({ ...form, embeddingModel: event.target.value })} placeholder="text-embedding-3-small" value={form.embeddingModel || ""} />
          </label>
        </div>
        <div className="field-group-title">Sync storage</div>
        <div className="two-col">
          <label>
            Sync provider
            <select
              id="syncProviderInput"
              onChange={(event) => setForm({ ...form, syncProvider: normalizeSyncProvider(event.target.value) })}
              value={form.syncProvider || "local"}
            >
              <option value="local">Local only</option>
              <option value="cloudflare">Built-in cloud</option>
            </select>
          </label>
          <label>
            Cloudflare endpoint
            <input id="cloudflareEndpointInput" onChange={(event) => updateCloudflareSyncSettings({ endpoint: event.target.value })} placeholder="https://denote-sync-api.example.workers.dev" value={cloudflare.endpoint} />
          </label>
        </div>
        <div className="two-col">
          <label>
            License key
            <SecretInput
              id="cloudflareLicenseKeyInput"
              isVisible={Boolean(visibleSecrets.cloudflareLicenseKey)}
              onChange={(value) => updateCloudflareSyncSettings({ licenseKey: value })}
              onCopy={() => void copySecret("License key", cloudflare.licenseKey)}
              onToggle={() => toggleSecretVisibility("cloudflareLicenseKey")}
              placeholder="dn_live_..."
              value={cloudflare.licenseKey}
            />
          </label>
          <label className="checkbox-field">
            <input
              id="cloudflareAutoSyncInput"
              checked={cloudflare.autoSyncEnabled}
              onChange={(event) => updateCloudflareSyncSettings({ autoSyncEnabled: event.target.checked })}
              type="checkbox"
            />
            Auto sync
          </label>
        </div>
        <div className="two-col">
          <label>
            Last sync
            <input id="cloudflareLastSyncedAtInput" readOnly value={formatSyncTimestamp(cloudflare.lastSyncedAt)} />
          </label>
          <div className="setting-action-row">
            <button id="testCloudflareSyncButton" className="secondary-action" onClick={() => void testCloudflareSyncConnection()} type="button">
              Test Cloud
            </button>
            <button id="syncCloudflareNowButton" className="secondary-action" onClick={() => void syncCloudflareNow()} type="button">
              Sync Now
            </button>
          </div>
        </div>
        <div className="disclosure">Built-in cloud sync uses the private Cloudflare Worker endpoint. Local card editing continues even when sync fails.</div>
        <div className="disclosure diagnostics">
          <strong>Diagnostics</strong>
          <span id="diagnosticsText">{diagnostics ? `Logs: ${diagnostics.logFilePath} | Data: ${diagnostics.userDataPath}` : "Loading diagnostic paths..."}</span>
        </div>
      </form>
    </section>
  );
}

function normalizeSyncProvider(value: string): DenoteSettings["syncProvider"] {
  return value === "cloudflare" ? value : "local";
}

type SecretInputProps = {
  id: string;
  isVisible: boolean;
  onChange(value: string): void;
  onCopy(): void;
  onToggle(): void;
  placeholder: string;
  value: string;
};

function SecretInput({ id, isVisible, onChange, onCopy, onToggle, placeholder, value }: SecretInputProps) {
  return (
    <div className="secret-input-row">
      <input id={id} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={isVisible ? "text" : "password"} value={value} />
      <button aria-label={isVisible ? "Hide secret" : "Show secret"} className="secret-action-button secondary-action" onClick={onToggle} title={isVisible ? "Hide secret" : "Show secret"} type="button">
        {isVisible ? "Hide" : "Show"}
      </button>
      <button aria-label="Copy secret" className="secret-action-button secondary-action" onClick={onCopy} title="Copy secret" type="button">
        Copy
      </button>
    </div>
  );
}

async function writeClipboardText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();

  if (!copied) {
    throw new Error("Clipboard copy failed");
  }
}

function normalizeCloudflareSyncSettings(input: Partial<CloudflareSyncSettings> | undefined): CloudflareSyncSettings {
  return {
    endpoint: normalizeHttpUrl(input?.endpoint, "https://denote-sync-api.ikouhaha888.workers.dev"),
    licenseKey: String(input?.licenseKey || "").trim(),
    autoSyncEnabled: input?.autoSyncEnabled !== false,
    lastSyncedAt: String(input?.lastSyncedAt || "").trim()
  };
}

function normalizeHttpUrl(value: unknown, fallback: string): string {
  const text = String(value || fallback).trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(text) ? text : fallback;
}
