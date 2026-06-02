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
    if (!cloudflare.licenseKey) {
      setStatus("Cloudflare license key is required");
      return;
    }
    await runAction("Saving settings", async () => {
      const saved = await window.denote.saveSettings({
        ...form,
        cloudflare,
        syncProvider: "cloudflare",
        taskProvider: "local"
      });
      setSettings(saved);
      setForm(saved);
      setStatus("Settings saved");
    });
  }

  async function testCloudflareSyncConnection() {
    if (!cloudflare.licenseKey) {
      setStatus("Cloudflare license key is required");
      return;
    }
    await runAction("Testing Cloudflare sync", async () => {
      const saved = await window.denote.saveSettings({ ...form, cloudflare, syncProvider: "cloudflare", taskProvider: "local" });
      setSettings(saved);
      setForm(saved);
      const result = await window.denote.testCloudflareSyncConnection(saved.cloudflare);
      setStatus(`Cloudflare connected: ${result.cardCount} cards`);
    });
  }

  async function syncCloudflareNow() {
    if (!cloudflare.licenseKey) {
      setStatus("Cloudflare license key is required");
      return;
    }
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

  const hasCloudLicense = Boolean(cloudflare.licenseKey);

  return (
    <section id="settingsView" className="active-view">
      <form id="settingsForm" className="panel settings-panel" onSubmit={(event) => void saveSettings(event)}>
        <div className="panel-head">
          <div>
            <h3>Cloud account</h3>
            <p>License key is required. Cloud sync carries cards and AI provider settings across your devices.</p>
          </div>
          <button type="submit">Save Settings</button>
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
            <button id="testCloudflareSyncButton" className="secondary-action" disabled={!hasCloudLicense} onClick={() => void testCloudflareSyncConnection()} type="button">
              Test Cloud
            </button>
            <button id="syncCloudflareNowButton" className="secondary-action" disabled={!hasCloudLicense} onClick={() => void syncCloudflareNow()} type="button">
              Sync Now
            </button>
          </div>
        </div>
        <input id="syncProviderInput" type="hidden" value="cloudflare" readOnly />
        <div className="disclosure">Cloud sync is handled by the app. Cards and saved provider settings sync together when a license key is present.</div>
        <div className="disclosure diagnostics">
          <strong>Diagnostics</strong>
          <span id="diagnosticsText">{diagnostics ? `Logs: ${diagnostics.logFilePath} | Data: ${diagnostics.userDataPath}` : "Loading diagnostic paths..."}</span>
        </div>
      </form>
    </section>
  );
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
    endpoint: "https://denote-sync-api.ikouhaha888.workers.dev",
    licenseKey: String(input?.licenseKey || "").trim(),
    autoSyncEnabled: input?.autoSyncEnabled !== false,
    lastSyncedAt: String(input?.lastSyncedAt || "").trim()
  };
}
