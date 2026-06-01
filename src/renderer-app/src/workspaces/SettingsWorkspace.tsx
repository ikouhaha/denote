import { FormEvent, useEffect, useState } from "react";
import { formatNotionTokenOptionLabel, getActiveNotionToken, normalizeNotionTaskSources, normalizeNotionTokens } from "../lib/settings.js";
import type { DenoteSettings, Diagnostics, NotionTaskSource, NotionTokenProfile, SftpSettings } from "../types.js";

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
  const [discoveredSources, setDiscoveredSources] = useState<NotionTaskSource[]>([]);
  const [newTokenName, setNewTokenName] = useState("");
  const [newTokenSecret, setNewTokenSecret] = useState("");

  useEffect(() => {
    if (settings) {
      setForm(settings);
    }
  }, [settings]);

  if (!settings) {
    return null;
  }

  const tokens = normalizeNotionTokens(form);
  const activeToken = getActiveNotionToken(tokens, String(form.activeNotionTokenId || ""));
  const selectedSources = normalizeNotionTaskSources(activeToken?.taskSources || form.notionTaskSources, form.notionTasksDatabaseId);
  const sftp = normalizeSftpSettings(form.sftp);

  async function saveSettings(event?: FormEvent) {
    event?.preventDefault();
    await runAction("Saving settings", async () => {
      const normalized = normalizeFormForSave(form, activeToken, selectedSources);
      const saved = await window.denote.saveSettings(normalized);
      setSettings(saved);
      setForm(saved);
      setStatus("Settings saved");
    });
  }

  async function addNotionToken() {
    await runAction("Adding Notion token", async () => {
      const token = newTokenSecret.trim();
      if (!token) {
        throw new Error("Notion integration token is required");
      }
      const nextTokens = [...tokens];
      const id = `notion-token-${Date.now()}`;
      nextTokens.push({
        id,
        name: newTokenName.trim() || `Notion token ${nextTokens.length + 1}`,
        token,
        taskSources: []
      });
      const nextForm = {
        ...form,
        notionTokens: nextTokens,
        activeNotionTokenId: id,
        notionTaskSources: [],
        notionTasksDatabaseId: ""
      };
      const saved = await window.denote.saveSettings(nextForm);
      setSettings(saved);
      setForm(saved);
      setNewTokenName("");
      setNewTokenSecret("");
      setStatus("Notion token added");
    });
  }

  async function removeActiveNotionToken() {
    if (!activeToken) {
      setStatus("No Notion token selected");
      return;
    }
    if (!window.confirm(`Remove Notion token "${activeToken.name}"?`)) {
      return;
    }
    await runAction("Removing Notion token", async () => {
      const nextTokens = tokens.filter((token) => token.id !== activeToken.id);
      const saved = await window.denote.saveSettings({
        ...form,
        notionTokens: nextTokens,
        activeNotionTokenId: nextTokens[0]?.id || "",
        notionToken: nextTokens[0]?.token || "",
        notionTaskSources: nextTokens[0]?.taskSources || [],
        notionTasksDatabaseId: nextTokens[0]?.taskSources[0]?.id || ""
      });
      setSettings(saved);
      setForm(saved);
      setStatus("Notion token removed");
    });
  }

  async function discoverNotionDatabases() {
    await runAction("Finding Notion sources", async () => {
      const saved = await window.denote.saveSettings(normalizeFormForSave(form, activeToken, selectedSources));
      setSettings(saved);
      setForm(saved);
      const sources = await window.denote.discoverNotionDatabases({ notionToken: saved.notionToken });
      setDiscoveredSources(sources);
      setStatus(`Found ${sources.length} Notion sources`);
    });
  }

  async function testSftpConnection() {
    await runAction("Testing SFTP connection", async () => {
      const normalized = normalizeFormForSave({ ...form, sftp }, activeToken, selectedSources);
      const saved = await window.denote.saveSettings(normalized);
      setSettings(saved);
      setForm(saved);
      const result = await window.denote.testSftpConnection(saved.sftp);
      setStatus(`SFTP connected: ${result.notesPath}`);
    });
  }

  function switchActiveToken(tokenId: string) {
    const token = tokens.find((item) => item.id === tokenId);
    if (!token) {
      return;
    }
    setForm({
      ...form,
      activeNotionTokenId: token.id,
      notionToken: token.token,
      notionTaskSources: token.taskSources,
      notionTasksDatabaseId: token.taskSources[0]?.id || ""
    });
  }

  function updateSource(source: NotionTaskSource) {
    const nextSources = addOrEnableNotionTaskSource(selectedSources, source);
    updateActiveTokenSources(nextSources);
  }

  function toggleSource(sourceId: string, enabled: boolean) {
    updateActiveTokenSources(selectedSources.map((source) => (source.id === sourceId ? { ...source, enabled } : source)));
  }

  function updateActiveTokenSources(taskSources: NotionTaskSource[]) {
    const nextTokens = activeToken
      ? tokens.map((token) => (token.id === activeToken.id ? { ...token, taskSources } : token))
      : tokens;
    setForm({
      ...form,
      notionTokens: nextTokens,
      notionTaskSources: taskSources,
      notionTasksDatabaseId: taskSources[0]?.id || ""
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
        <div className="two-col">
          <label>
            Notion token profile
            <select id="notionTokenProfilePicker" onChange={(event) => switchActiveToken(event.target.value)} value={activeToken?.id || ""}>
              {tokens.map((token) => (
                <option key={token.id} value={token.id}>
                  {formatNotionTokenOptionLabel(token)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Notion token name
            <input
              id="notionTokenNameInput"
              onChange={(event) => {
                const value = event.target.value;
                const nextTokens = activeToken ? tokens.map((token) => (token.id === activeToken.id ? { ...token, name: value } : token)) : tokens;
                setForm({ ...form, notionTokens: nextTokens });
              }}
              placeholder="e.g. Work token, Client token"
              value={activeToken?.name || ""}
            />
          </label>
        </div>
        <label>
          Active Notion integration token
          <input
            id="notionTokenInput"
            onChange={(event) => {
              const value = event.target.value;
              const nextTokens = activeToken ? tokens.map((token) => (token.id === activeToken.id ? { ...token, token: value } : token)) : tokens;
              setForm({ ...form, notionToken: value, notionTokens: nextTokens });
            }}
            placeholder="Stored locally"
            type="password"
            value={activeToken?.token || form.notionToken || ""}
          />
        </label>
        <div className="two-col">
          <label>
            New token name
            <input id="notionNewTokenNameInput" onChange={(event) => setNewTokenName(event.target.value)} placeholder="Name for the next token you add" value={newTokenName} />
          </label>
          <label>
            New Notion integration token
            <input id="notionNewTokenInput" onChange={(event) => setNewTokenSecret(event.target.value)} placeholder="Paste token to add" type="password" value={newTokenSecret} />
          </label>
        </div>
        <div className="database-discovery">
          <button id="addNotionTokenButton" className="secondary-action" onClick={() => void addNotionToken()} type="button">
            Add token
          </button>
          <button id="removeNotionTokenButton" className="secondary-action danger-action" onClick={() => void removeActiveNotionToken()} type="button">
            Remove token
          </button>
          <span className="muted">Each token keeps its own task sources.</span>
        </div>
        <div className="two-col">
          <label>
            Notion Tasks source
            <input id="notionTasksDatabaseIdInput" onChange={(event) => updateSource({ id: event.target.value, name: event.target.value, enabled: true })} placeholder="Use Find Sources, or paste the source ID" value={form.notionTasksDatabaseId || ""} />
          </label>
        </div>
        <div className="database-discovery">
          <button id="discoverNotionDatabasesButton" className="secondary-action" onClick={() => void discoverNotionDatabases()} type="button">
            Find Sources
          </button>
          <label>
            Accessible Notion sources
            <select id="notionDatabasePicker" onChange={(event) => {
              const source = discoveredSources.find((item) => item.id === event.target.value);
              if (source) {
                updateSource(source);
              }
            }}>
              <option value="">Choose a Notion source</option>
              {discoveredSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name || source.id}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="selected-sources">
          <div className="field-group-title">Selected task sources</div>
          <div id="notionSelectedSources" className="source-toggle-list">
            {selectedSources.length === 0 ? <p className="muted">No Notion task sources selected.</p> : null}
            {selectedSources.map((source) => (
              <label className="source-toggle" key={source.id}>
                <input checked={source.enabled} onChange={(event) => toggleSource(source.id, event.target.checked)} type="checkbox" />
                <span>{source.name || source.id}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="disclosure">Local Ask only uses local cards. Notion task Ask is intentionally separate and deferred until a Notion context flow exists.</div>
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

function normalizeFormForSave(form: Partial<DenoteSettings>, activeToken: NotionTokenProfile | null, selectedSources: NotionTaskSource[]): Partial<DenoteSettings> {
  const tokens = normalizeNotionTokens(form).map((token) => (token.id === activeToken?.id ? { ...token, taskSources: selectedSources } : token));
  const selectedToken = activeToken ? tokens.find((token) => token.id === activeToken.id) : tokens[0];
  return {
    ...form,
    sftp: normalizeSftpSettings(form.sftp),
    notionTokens: tokens,
    activeNotionTokenId: selectedToken?.id || "",
    notionToken: selectedToken?.token || form.notionToken || "",
    notionTaskSources: selectedToken?.taskSources || selectedSources,
    notionTasksDatabaseId: selectedToken?.taskSources[0]?.id || selectedSources[0]?.id || ""
  };
}

function addOrEnableNotionTaskSource(sources: NotionTaskSource[], source: NotionTaskSource): NotionTaskSource[] {
  const id = String(source.id || "").trim();
  if (!id) {
    return sources;
  }
  const existing = sources.find((item) => item.id === id);
  if (existing) {
    return sources.map((item) => (item.id === id ? { ...item, name: source.name || item.name || id, enabled: true } : item));
  }
  return [...sources, { id, name: source.name || id, enabled: true, url: source.url || "" }];
}
