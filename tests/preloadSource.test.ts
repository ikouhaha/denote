import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(resolve("src/preload/preload.cjs"), "utf8");

describe("Preload source contracts", () => {
  it("exposes draft refinement to the renderer", () => {
    expect(preloadSource).toContain("refineDraft(payload)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:refineDraft", payload)');
  });

  it("exposes card status updates to the renderer", () => {
    expect(preloadSource).toContain("updateCardStatus(payload)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:updateCardStatus", payload)');
  });

  it("exposes diagnostics paths to the renderer", () => {
    expect(preloadSource).toContain("getDiagnostics()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:getDiagnostics")');
  });

  it("exposes app info through IPC instead of a hardcoded preload version", () => {
    expect(preloadSource).toContain("getAppInfo()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:getAppInfo")');
    expect(preloadSource).not.toContain('version: "');
  });

  it("exposes manual update APIs to the renderer", () => {
    expect(preloadSource).toContain("getUpdateState()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:getUpdateState")');
    expect(preloadSource).toContain("checkForUpdates()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:checkForUpdates")');
    expect(preloadSource).toContain("downloadUpdate()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:downloadUpdate")');
    expect(preloadSource).toContain("installUpdate()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:installUpdate")');
    expect(preloadSource).toContain("onUpdateStateChanged(callback)");
    expect(preloadSource).toContain('ipcRenderer.on("denote:updateStateChanged"');
  });

  it("exposes task provider APIs without direct provider credentials", () => {
    expect(preloadSource).toContain("setTaskProvider(provider)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:setTaskProvider", provider)');
    expect(preloadSource).toContain("getTaskProviderMetadata()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:getTaskProviderMetadata")');
    expect(preloadSource).toContain("discoverNotionDatabases()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:discoverNotionDatabases")');
    expect(preloadSource).toContain("listTasks()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:listTasks")');
    expect(preloadSource).toContain("createTask(task)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:createTask", task)');
    expect(preloadSource).toContain("updateTaskStatus(payload)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:updateTaskStatus", payload)');
  });
});
