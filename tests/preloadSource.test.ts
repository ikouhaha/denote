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

  it("exposes local card and ask APIs only", () => {
    expect(preloadSource).toContain("listCards()");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:listCards")');
    expect(preloadSource).toContain("saveCard(card)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:saveCard", card)');
    expect(preloadSource).toContain("deleteCard(id)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:deleteCard", id)');
    expect(preloadSource).toContain("ask(payload)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:ask", payload)');
    expect(preloadSource.toLowerCase()).not.toContain("no" + "tion");
  });

  it("exposes external link opening without giving renderer shell access", () => {
    expect(preloadSource).toContain("openExternal(url)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:openExternal", url)');
    expect(preloadSource).not.toContain('require("electron").shell');
  });

  it("exposes SFTP connection testing without giving renderer direct network access", () => {
    expect(preloadSource).toContain("testSftpConnection(settings)");
    expect(preloadSource).toContain('ipcRenderer.invoke("denote:testSftpConnection", settings)');
    expect(preloadSource).not.toContain('require("ssh2-sftp-client")');
  });
});
