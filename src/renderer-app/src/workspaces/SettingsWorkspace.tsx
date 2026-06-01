import { FormEvent, useEffect, useState } from "react";
import type { DenoteSettings, Diagnostics, SftpSettings } from "../types.js";

type Props = {
  diagnostics: Diagnostics | null;
  settings: DenoteSettings | null;
  setSettings(settings: DenoteSettings): void;
  refreshSettings(): Promise<DenoteSettings>;
  runAction(label: string, action: () => Promise<void>): Promise<void>;
  setStatus(message: string): void;
};

export function SettingsWorkspace({ diagnostics, settings, setSettings, runAction, setStatus }: Props) {
  const [form, setForm] = useState<Partial<DenoteSettings>>({});

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  if (!settings) {
    return null;
  }

  const sftp = normalizeSftpSettings(form.sftp);

  async function saveSettings(event?: FormEvent) {
    event?.preventDefault();
    await runAction("Saving settings", async () => {
      const saved = await window.denote.saveSettings({
        ...form,
        sftp,
        taskProvider: "local"
      });
      setSettings(saved);
      setForm(saved);
      setStatus("Settings saved");
    });
  }

  async function testSftpConnection() {
    await runAction("Testing SFTP connection", async () => {
      const saved = await window.denote.saveSettings({ ...form, sftp, taskProvider: "local" });
      setSettings(saved);
      setForm(saved);
      const result = await window.denote.testSftpConnection(saved.sftp);
      setStatus(`SFTP connected: ${result.notesPath}`);
    });
  }

  function updateSftpSettings(patch: Partial<SftpSettings>) {
    setForm({ ...form, sftp: normalizeSftpSettings({ ...sftp, ...patch }) });
  }

  return (
    <section id="settingsView" className="active-view">
      <form id="settingsForm" className="panel settings-panel" onSubmit={(event) => void saveSettings(event)}>
        <div className="panel-head">
          <div>
            <h3>AI Provider Settings</h3>
            <p>Secrets stay in local settings and provider calls stay behind Electron preload.</p>
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
            <input id="apiKeyInput" onChange={(event) => setForm({ ...form, apiKey: event.target.value })} placeholder="Stored locally for now" type="password" value={form.apiKey || ""} />
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
            <select id="syncProviderInput" onChange={(event) => setForm({ ...form, syncProvider: event.target.value === "sftp" ? "sftp" : "local" })} value={form.syncProvider || "local"}>
              <option value="local">Local only</option>
              <option value="sftp">Built-in cloud over SFTP</option>
            </select>
          </label>
          <label>
            SFTP host
            <input id="sftpHostInput" onChange={(event) => updateSftpSettings({ host: event.target.value })} placeholder="storage.example.com" value={sftp.host} />
          </label>
        </div>
        <div className="two-col">
          <label>
            SFTP port
            <input id="sftpPortInput" min="1" max="65535" onChange={(event) => updateSftpSettings({ port: Number(event.target.value) })} type="number" value={String(sftp.port)} />
          </label>
          <label>
            SFTP username
            <input id="sftpUsernameInput" onChange={(event) => updateSftpSettings({ username: event.target.value })} placeholder="denote-sync" value={sftp.username} />
          </label>
        </div>
        <div className="two-col">
          <label>
            SFTP password
            <input id="sftpPasswordInput" onChange={(event) => updateSftpSettings({ password: event.target.value })} placeholder="Stored locally" type="password" value={sftp.password} />
          </label>
          <label>
            Private key path
            <input id="sftpPrivateKeyPathInput" onChange={(event) => updateSftpSettings({ privateKeyPath: event.target.value })} placeholder="Optional local key path" value={sftp.privateKeyPath} />
          </label>
        </div>
        <div className="two-col">
          <label>
            Private key passphrase
            <input id="sftpPassphraseInput" onChange={(event) => updateSftpSettings({ passphrase: event.target.value })} placeholder="Optional" type="password" value={sftp.passphrase} />
          </label>
          <label>
            Storage root path
            <input id="sftpRootPathInput" onChange={(event) => updateSftpSettings({ rootPath: event.target.value })} placeholder="/denote" value={sftp.rootPath} />
          </label>
        </div>
        <div className="two-col">
          <label>
            Notes path
            <input id="sftpNotesPathInput" onChange={(event) => updateSftpSettings({ notesPath: event.target.value })} placeholder="notes" value={sftp.notesPath} />
          </label>
          <div className="setting-action-row">
            <button id="testSftpConnectionButton" className="secondary-action" onClick={() => void testSftpConnection()} type="button">
              Test SFTP
            </button>
          </div>
        </div>
        <div className="disclosure">SFTP is the built-in sync backend for the first version. The app writes inside the configured root path and keeps note files under the notes path.</div>
        <div className="disclosure diagnostics">
          <strong>Diagnostics</strong>
          <span id="diagnosticsText">{diagnostics ? `Logs: ${diagnostics.logFilePath} | Data: ${diagnostics.userDataPath}` : "Loading diagnostic paths..."}</span>
        </div>
      </form>
    </section>
  );
}

function normalizeSftpSettings(input: Partial<SftpSettings> | undefined): SftpSettings {
  return {
    host: String(input?.host || "").trim(),
    port: normalizeSftpPort(input?.port),
    username: String(input?.username || "").trim(),
    password: String(input?.password || ""),
    privateKeyPath: String(input?.privateKeyPath || "").trim(),
    passphrase: String(input?.passphrase || ""),
    rootPath: normalizeRemoteAbsolutePath(input?.rootPath, "/denote"),
    notesPath: normalizeRemoteRelativePath(input?.notesPath, "notes")
  };
}

function normalizeSftpPort(value: unknown): number {
  const port = Number(value || 22);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22;
}

function normalizeRemoteAbsolutePath(value: unknown, fallback: string): string {
  const text = String(value || fallback).trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const normalized = text.startsWith("/") ? text : `/${text}`;
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

function normalizeRemoteRelativePath(value: unknown, fallback: string): string {
  const text = String(value || fallback).trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  const withoutEdges = text.replace(/^\/+/, "").replace(/\/+$/, "");
  return withoutEdges || fallback;
}
