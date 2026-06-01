import { useEffect, useMemo, useState } from "react";
import { LocalWorkspace } from "./workspaces/LocalWorkspace.js";
import { NotionWorkspace } from "./workspaces/NotionWorkspace.js";
import { SettingsWorkspace } from "./workspaces/SettingsWorkspace.js";
import { coerceViewForProvider, getDefaultViewForProvider, getViewTitle, providerViews } from "./lib/providerViews.js";
import type { AppView, DenoteSettings, Diagnostics, NotionTokenProfile, TaskProvider, UpdateState } from "./types.js";

type BusyState = {
  count: number;
  message: string;
};

const providerLabels: Record<TaskProvider, string> = {
  local: "Local",
  notion: "Notion"
};

export function App() {
  const [taskProvider, setTaskProviderState] = useState<TaskProvider>("local");
  const [view, setViewState] = useState<AppView>("add");
  const [settings, setSettings] = useState<DenoteSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [appVersion, setAppVersion] = useState("...");
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle", message: "Ready to check for updates" });
  const [busy, setBusy] = useState<BusyState>({ count: 0, message: "Ready" });

  const activeToken = useMemo(() => getActiveToken(settings), [settings]);
  const visibleViews = providerViews[taskProvider];
  const currentView = coerceViewForProvider(taskProvider, view);

  useEffect(() => {
    void runAction("Loading workspace", async () => {
      const [appInfo, loadedSettings, loadedDiagnostics, loadedUpdateState] = await Promise.all([
        window.denote.getAppInfo(),
        window.denote.getSettings(),
        window.denote.getDiagnostics(),
        window.denote.getUpdateState()
      ]);
      setAppVersion(appInfo.version);
      setSettings(loadedSettings);
      setTaskProviderState(loadedSettings.taskProvider || "local");
      setViewState(coerceViewForProvider(loadedSettings.taskProvider || "local", currentView));
      setDiagnostics(loadedDiagnostics);
      setUpdateState(loadedUpdateState);
      setStatus("Ready");
    });

    const unsubscribe = window.denote.onUpdateStateChanged?.((nextState) => {
      setUpdateState(nextState);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  async function runAction(label: string, action: () => Promise<void>) {
    beginBusy(label);
    try {
      await action();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      endBusy();
    }
  }

  function beginBusy(message: string) {
    setBusy((current) => ({ count: current.count + 1, message }));
  }

function endBusy() {
    setBusy((current) => ({ ...current, count: Math.max(0, current.count - 1) }));
  }

  function setStatus(message: string) {
    setBusy((current) => ({ ...current, message }));
  }

  async function switchProvider(provider: TaskProvider) {
    if (provider === taskProvider) {
      return;
    }
    await runAction(`Switching to ${providerLabels[provider]}`, async () => {
      const nextProvider = await window.denote.setTaskProvider(provider);
      setTaskProviderState(nextProvider);
      setViewState(getDefaultViewForProvider(nextProvider));
      const nextSettings = await window.denote.getSettings();
      setSettings(nextSettings);
      setStatus(`${providerLabels[nextProvider]} mode ready`);
    });
  }

  function setView(nextView: AppView) {
    setViewState(coerceViewForProvider(taskProvider, nextView));
  }

  async function refreshSettings() {
    const nextSettings = await window.denote.getSettings();
    setSettings(nextSettings);
    setTaskProviderState(nextSettings.taskProvider || "local");
    setViewState((current) => coerceViewForProvider(nextSettings.taskProvider || "local", current));
    return nextSettings;
  }

  async function handleUpdateAction() {
    await runAction("Checking updates", async () => {
      const status = updateState.status || "idle";
      const nextState =
        status === "available"
          ? await window.denote.downloadUpdate()
          : status === "downloaded"
            ? await window.denote.installUpdate()
            : await window.denote.checkForUpdates();
      setUpdateState(nextState);
    });
  }

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">D</span>
          <div>
            <h1>Denote</h1>
            <p>{taskProvider === "notion" ? "Notion task workspace" : "Local AI knowledge"}</p>
          </div>
        </div>

        <nav className="nav-tabs" aria-label="Primary" data-provider-views={taskProvider}>
          {visibleViews.map((item) => (
            <button
              className={`nav-tab ${currentView === item ? "active" : ""}`}
              data-view={item}
              key={item}
              onClick={() => setView(item)}
              type="button"
            >
              {getViewTitle(item)}
            </button>
          ))}
        </nav>

        <div id="providerModeSwitch" className="provider-mode-switch" aria-label="Task provider">
          {(["local", "notion"] as const).map((provider) => (
            <button
              className={`provider-mode ${taskProvider === provider ? "active" : ""}`}
              data-provider={provider}
              key={provider}
              onClick={() => void switchProvider(provider)}
              type="button"
            >
              {providerLabels[provider]}
            </button>
          ))}
        </div>

        {taskProvider === "notion" ? (
          <label id="notionTokenProfileSwitcher" className="token-profile-switcher">
            <span>Notion token</span>
            <select
              id="notionTokenProfilePicker"
              onChange={(event) => {
                const tokenId = event.target.value;
                const token = settings?.notionTokens.find((item) => item.id === tokenId);
                if (!settings || !token) {
                  return;
                }
                void runAction("Switching Notion token", async () => {
                  await window.denote.saveSettings({
                    ...settings,
                    activeNotionTokenId: token.id,
                    notionToken: token.token,
                    notionTaskSources: token.taskSources,
                    notionTasksDatabaseId: token.taskSources[0]?.id || ""
                  });
                  await refreshSettings();
                  setStatus(`Switched to ${token.name}`);
                });
              }}
              value={activeToken?.id || ""}
            >
              {(settings?.notionTokens || []).map((token) => (
                <option key={token.id} value={token.id}>
                  {token.name} ({token.id.slice(-4)})
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="sidebar-note">
          <strong id="appVersionText">v{appVersion}</strong>
          <span id="updateStatusText">{formatUpdateStatus(updateState)}</span>
          <button id="updateActionButton" className="sidebar-update-button" onClick={() => void handleUpdateAction()} type="button">
            {updateButtonLabel(updateState)}
          </button>
          <span>{taskProvider === "notion" ? "Tasks stay in Notion. Local cards stay local." : "Local cards provide context for Ask."}</span>
        </div>
      </aside>

      <section className="main-surface">
        <header className="topbar">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2 id="viewTitle">
              {getViewTitle(currentView)}
              {taskProvider === "notion" && activeToken ? ` - ${activeToken.name}` : ""}
            </h2>
          </div>
          <div className={`status ${busy.count > 0 ? "busy" : ""}`} id="status" role="status" aria-busy={busy.count > 0} aria-live="polite">
            <span className="status-spinner" aria-hidden="true" />
            <span id="statusText">{busy.message}</span>
          </div>
        </header>

        {taskProvider === "local" && currentView !== "settings" ? (
          <LocalWorkspace runAction={runAction} setStatus={setStatus} view={currentView} setView={setView} />
        ) : null}
        {taskProvider === "notion" && currentView !== "settings" ? (
          <NotionWorkspace
            runAction={runAction}
            setStatus={setStatus}
            settings={settings}
            setSettings={setSettings}
            view={currentView}
            setView={setView}
            refreshSettings={refreshSettings}
          />
        ) : null}
        {currentView === "settings" ? (
          <SettingsWorkspace
            diagnostics={diagnostics}
            refreshSettings={refreshSettings}
            runAction={runAction}
            settings={settings}
            setSettings={setSettings}
            setStatus={setStatus}
          />
        ) : null}
      </section>
    </main>
  );
}

function getActiveToken(settings: DenoteSettings | null): NotionTokenProfile | null {
  if (!settings) {
    return null;
  }
  return settings.notionTokens.find((token) => token.id === settings.activeNotionTokenId) || settings.notionTokens[0] || null;
}

function formatUpdateStatus(updateState: UpdateState): string {
  if (updateState.status === "available" && updateState.availableVersion) {
    return `v${updateState.availableVersion} available`;
  }
  return updateState.message || "Ready to check for updates";
}

function updateButtonLabel(updateState: UpdateState): string {
  if (updateState.status === "available") {
    return "Download";
  }
  if (updateState.status === "downloaded") {
    return "Restart";
  }
  if (["checking", "downloading"].includes(updateState.status)) {
    return "Working";
  }
  return "Check updates";
}
