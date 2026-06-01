import { useEffect, useState } from "react";
import { LocalWorkspace } from "./workspaces/LocalWorkspace.js";
import { SettingsWorkspace } from "./workspaces/SettingsWorkspace.js";
import { getViewTitle } from "./lib/providerViews.js";
import type { AppView, DenoteSettings, Diagnostics, UpdateState } from "./types.js";

type BusyState = {
  count: number;
  message: string;
};

export function App() {
  const [view, setViewState] = useState<AppView>("add");
  const [settings, setSettings] = useState<DenoteSettings | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [appVersion, setAppVersion] = useState("...");
  const [updateState, setUpdateState] = useState<UpdateState>({ status: "idle", message: "Ready to check for updates" });
  const [busy, setBusy] = useState<BusyState>({ count: 0, message: "Ready" });

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

  function setView(nextView: AppView) {
    setViewState(nextView);
  }

  async function refreshSettings() {
    const nextSettings = await window.denote.getSettings();
    setSettings(nextSettings);
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

  const views: AppView[] = ["add", "library", "calendar", "ask", "settings"];

  return (
    <main className="app-frame">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">D</span>
          <div>
            <h1>Denote</h1>
            <p>Local AI knowledge</p>
          </div>
        </div>

        <nav className="nav-tabs" aria-label="Primary" data-provider-views="local">
          {views.map((item) => (
            <button
              className={`nav-tab ${view === item ? "active" : ""}`}
              data-view={item}
              key={item}
              onClick={() => setView(item)}
              type="button"
            >
              {getViewTitle(item)}
            </button>
          ))}
        </nav>

        <div className="sidebar-note">
          <strong id="appVersionText">v{appVersion}</strong>
          <span id="updateStatusText">{formatUpdateStatus(updateState)}</span>
          <button id="updateActionButton" className="sidebar-update-button" onClick={() => void handleUpdateAction()} type="button">
            {updateButtonLabel(updateState)}
          </button>
          <span>Local cards provide context for Ask.</span>
        </div>
      </aside>

      <section className="main-surface">
        <header className="topbar">
          <div>
            <p className="eyebrow">Workspace</p>
            <h2 id="viewTitle">{getViewTitle(view)}</h2>
          </div>
          <div className={`status ${busy.count > 0 ? "busy" : ""}`} id="status" role="status" aria-busy={busy.count > 0} aria-live="polite">
            <span className="status-spinner" aria-hidden="true" />
            <span id="statusText">{busy.message}</span>
          </div>
        </header>

        {view !== "settings" ? <LocalWorkspace runAction={runAction} setStatus={setStatus} view={view} setView={setView} /> : null}
        {view === "settings" ? (
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

function formatUpdateStatus(updateState: UpdateState): string {
  if (updateState.status === "available" && updateState.availableVersion) {
    return `v${updateState.availableVersion} available`;
  }
  return updateState.message || "Check GitHub Releases for updates";
}

function updateButtonLabel(updateState: UpdateState): string {
  if (updateState.status === "available") {
    return "Open release";
  }
  if (updateState.status === "downloaded") {
    return "Restart";
  }
  if (["checking", "downloading"].includes(updateState.status)) {
    return "Working";
  }
  return "Check updates";
}
