import { FormEvent, useEffect, useState } from "react";
import type { CloudflareSyncSettings, DenoteSettings, Diagnostics } from "../types.js";
import { formatSyncTimestamp } from "../lib/format.js";
import { getMessages } from "../lib/i18n.js";

type Props = {
  diagnostics: Diagnostics | null;
  language: DenoteSettings["language"];
  settings: DenoteSettings | null;
  setSettings(settings: DenoteSettings): void;
  refreshSettings(): Promise<DenoteSettings>;
  runAction(label: string, action: () => Promise<void>): Promise<void>;
  setStatus(message: string): void;
};

export function SettingsWorkspace({ diagnostics, language, settings, setSettings, refreshSettings, runAction, setStatus }: Props) {
  const [form, setForm] = useState<Partial<DenoteSettings>>({});
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const t = getMessages(language);

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
      setStatus(t.licenseRequired);
      return;
    }
    await runAction(t.saveSettings, async () => {
      const saved = await window.denote.saveSettings({
        ...form,
        cloudflare,
        syncProvider: "cloudflare",
        taskProvider: "local"
      });
      setSettings(saved);
      setForm(saved);
      setStatus(getMessages(saved.language).settingsSaved);
    });
  }

  async function testCloudflareSyncConnection() {
    if (!cloudflare.licenseKey) {
      setStatus(t.licenseRequired);
      return;
    }
    await runAction(t.testCloud, async () => {
      const saved = await window.denote.saveSettings({ ...form, cloudflare, syncProvider: "cloudflare", taskProvider: "local" });
      setSettings(saved);
      setForm(saved);
      const result = await window.denote.testCloudflareSyncConnection(saved.cloudflare);
      setStatus(getMessages(saved.language).cloudConnected(result.cardCount));
    });
  }

  async function syncCloudflareNow() {
    if (!cloudflare.licenseKey) {
      setStatus(t.licenseRequired);
      return;
    }
    await runAction(t.syncNow, async () => {
      const saved = await window.denote.saveSettings({ ...form, cloudflare, syncProvider: "cloudflare", taskProvider: "local" });
      setSettings(saved);
      setForm(saved);
      const result = await window.denote.syncCloudflareNow(saved.cloudflare);
      const refreshed = await refreshSettings();
      setForm(refreshed);
      setStatus(getMessages(refreshed.language).cloudSynced(result.cardCount));
    });
  }

  function updateCloudflareSyncSettings(patch: Partial<CloudflareSyncSettings>) {
    setForm({ ...form, cloudflare: normalizeCloudflareSyncSettings({ ...cloudflare, ...patch }) });
  }

  async function copySecret(label: string, value: string) {
    const text = value.trim();
    if (!text) {
      setStatus(t.secretEmpty(label));
      return;
    }

    try {
      await writeClipboardText(text);
      setStatus(t.secretCopied(label));
    } catch {
      setStatus(t.secretCopyFailed(label));
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
            <h3>{t.cloudAccount}</h3>
            <p>{t.cloudAccountHint}</p>
          </div>
          <button type="submit">{t.saveSettings}</button>
        </div>
        <div className="two-col">
          <label>
            {t.language}
            <select
              id="languageInput"
              onChange={(event) => setForm({ ...form, language: event.target.value as DenoteSettings["language"] })}
              value={form.language || settings.language}
            >
              <option value="en">{t.languageEnglish}</option>
              <option value="zh-Hant">{t.languageTraditionalChinese}</option>
            </select>
          </label>
          <label>
            {t.licenseKey}
            <SecretInput
              id="cloudflareLicenseKeyInput"
              isVisible={Boolean(visibleSecrets.cloudflareLicenseKey)}
              labels={{ hide: t.hideSecret, show: t.showSecret, copy: t.copySecret }}
              onChange={(value) => updateCloudflareSyncSettings({ licenseKey: value })}
              onCopy={() => void copySecret(t.licenseKey, cloudflare.licenseKey)}
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
            {t.autoSync}
          </label>
        </div>
        <div className="two-col">
          <label>
            {t.lastSync}
            <input id="cloudflareLastSyncedAtInput" readOnly value={formatSyncTimestamp(cloudflare.lastSyncedAt)} />
          </label>
          <div className="setting-action-row">
            <button id="testCloudflareSyncButton" className="secondary-action" disabled={!hasCloudLicense} onClick={() => void testCloudflareSyncConnection()} type="button">
              {t.testCloud}
            </button>
            <button id="syncCloudflareNowButton" className="secondary-action" disabled={!hasCloudLicense} onClick={() => void syncCloudflareNow()} type="button">
              {t.syncNow}
            </button>
          </div>
        </div>
        <input id="syncProviderInput" type="hidden" value="cloudflare" readOnly />
        <div className="disclosure">{t.cloudSyncDisclosure}</div>
        <div className="disclosure diagnostics">
          <strong>{t.diagnostics}</strong>
          <span id="diagnosticsText">{diagnostics ? `Logs: ${diagnostics.logFilePath} | Data: ${diagnostics.userDataPath}` : t.diagnosticsLoading}</span>
        </div>
      </form>
    </section>
  );
}

type SecretInputProps = {
  id: string;
  isVisible: boolean;
  labels: {
    hide: string;
    show: string;
    copy: string;
  };
  onChange(value: string): void;
  onCopy(): void;
  onToggle(): void;
  placeholder: string;
  value: string;
};

function SecretInput({ id, isVisible, labels, onChange, onCopy, onToggle, placeholder, value }: SecretInputProps) {
  return (
    <div className="secret-input-row">
      <input id={id} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} type={isVisible ? "text" : "password"} value={value} />
      <button aria-label={isVisible ? labels.hide : labels.show} className="secret-action-button secondary-action" onClick={onToggle} title={isVisible ? labels.hide : labels.show} type="button">
        {isVisible ? labels.hide : labels.show}
      </button>
      <button aria-label={labels.copy} className="secret-action-button secondary-action" onClick={onCopy} title={labels.copy} type="button">
        {labels.copy}
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
