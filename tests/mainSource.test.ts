import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync(resolve("src/main/main.cjs"), "utf8");

describe("Electron main source contracts", () => {
  it("does not auto-seed samples when listing or asking cards", () => {
    const listCardsHandler = mainSource.match(/ipcMain\.handle\("denote:listCards"[\s\S]*?\n}\);/)?.[0] ?? "";
    const askHandler = mainSource.match(/ipcMain\.handle\("denote:ask"[\s\S]*?\n}\);/)?.[0] ?? "";

    expect(listCardsHandler).not.toContain("ensureSampleCards()");
    expect(askHandler).not.toContain("ensureSampleCards()");
  });

  it("uses the configured LLM for card drafting and ask answers", () => {
    const generateDraftHandler = mainSource.match(/ipcMain\.handle\("denote:generateDraft"[\s\S]*?\n}\);/)?.[0] ?? "";
    const refineDraftHandler = mainSource.match(/ipcMain\.handle\("denote:refineDraft"[\s\S]*?\n}\);/)?.[0] ?? "";
    const askHandler = mainSource.match(/ipcMain\.handle\("denote:ask"[\s\S]*?\n}\);/)?.[0] ?? "";

    expect(generateDraftHandler).toContain("generateDraftWithLlm");
    expect(refineDraftHandler).toContain("refineDraftWithLlm");
    expect(askHandler).toContain("answerWithLlm");
  });

  it("supports demo schedule cards and soft delete", () => {
    expect(mainSource).toContain("CARD_KINDS");
    expect(mainSource).toContain("CARD_STATUSES");
    expect(mainSource).toContain("due_date");
    expect(mainSource).toContain("denote:updateCardStatus");
    expect(mainSource).toContain('card.status = "deleted"');
    expect(mainSource).toContain("isScheduleQuestion");
    expect(mainSource).toContain("visibleCards");
  });

  it("logs LLM diagnostics and exposes log paths", () => {
    expect(mainSource).toContain("getLogFilePath");
    expect(mainSource).toContain("denote:getDiagnostics");
    expect(mainSource).toContain("writeLog");
    expect(mainSource).toContain("LLM_TIMEOUT_MS");
    expect(mainSource).toContain("llm.request.timeout");
    expect(mainSource).toContain("llm.response.invalid_json");
    expect(mainSource).toContain("responseSnippet");
  });

  it("exposes app version from Electron metadata instead of hardcoding it in the UI", () => {
    expect(mainSource).toContain('ipcMain.handle("denote:getAppInfo"');
    expect(mainSource).toContain("app.getVersion()");
  });

  it("serves the Vite renderer through a privileged app protocol", () => {
    expect(mainSource).toContain("protocol.registerSchemesAsPrivileged");
    expect(mainSource).toContain("protocol.handle(RENDERER_PROTOCOL");
    expect(mainSource).toContain("pathToFileURL(filePath)");
    expect(mainSource).toContain("net.fetch");
    expect(mainSource).toContain("mainWindow.loadURL");
    expect(mainSource).not.toContain("mainWindow.loadFile");
  });

  it("configures manual GitHub auto-update IPC", () => {
    expect(mainSource).toContain('require("electron-updater")');
    expect(mainSource).toContain("autoUpdater.autoDownload = false");
    expect(mainSource).toContain('ipcMain.handle("denote:getUpdateState"');
    expect(mainSource).toContain('ipcMain.handle("denote:checkForUpdates"');
    expect(mainSource).toContain('ipcMain.handle("denote:downloadUpdate"');
    expect(mainSource).toContain('ipcMain.handle("denote:installUpdate"');
    expect(mainSource).toContain("autoUpdater.checkForUpdates()");
    expect(mainSource).toContain("autoUpdater.downloadUpdate()");
    expect(mainSource).toContain("autoUpdater.quitAndInstall()");
    expect(mainSource).toContain('"denote:updateStateChanged"');
  });

  it("does not return the old local insufficient evidence answer", () => {
    expect(mainSource).not.toContain("I do not have enough saved Denote knowledge to answer that yet.");
  });

  it("registers local-only IPC handlers", () => {
    expect(mainSource).toContain('ipcMain.handle("denote:listCards"');
    expect(mainSource).toContain('ipcMain.handle("denote:saveCard"');
    expect(mainSource).toContain('ipcMain.handle("denote:deleteCard"');
    expect(mainSource).toContain('ipcMain.handle("denote:updateCardStatus"');
    expect(mainSource.toLowerCase()).not.toContain("no" + "tion");
  });

  it("normalizes settings and keeps task provider local", () => {
    expect(mainSource).toContain("taskProvider");
    expect(mainSource).toContain("syncProvider");
    expect(mainSource).toContain("normalizeSftpSettings");
    expect(mainSource).toContain('taskProvider: "local"');
  });

  it("registers SFTP sync connection testing behind the main process", () => {
    expect(mainSource).toContain('ipcMain.handle("denote:testSftpConnection"');
    expect(mainSource).toContain('require("ssh2-sftp-client")');
    expect(mainSource).toContain("testSftpConnection");
    expect(mainSource).toContain("ensureSftpDirectory");
    expect(mainSource).toContain("normalizeRemoteAbsolutePath");
    expect(mainSource).toContain("normalizeRemoteRelativePath");
    expect(mainSource).toContain("sftp.connection.success");
    expect(mainSource).toContain("sftp.connection.failed");
  });

  it("registers Cloudflare sync behind the main process", () => {
    expect(mainSource).toContain('ipcMain.handle("denote:testCloudflareSyncConnection"');
    expect(mainSource).toContain('ipcMain.handle("denote:syncCloudflareNow"');
    expect(mainSource).toContain("queueCloudflareAutoSync");
    expect(mainSource).toContain("syncCloudflareCards");
    expect(mainSource).toContain("mergeCardStores");
    expect(mainSource).toContain("CLOUDFLARE_SYNC_OBJECT_KEY");
    expect(mainSource).toContain("denote-sync-api.ikouhaha888.workers.dev");
    expect(mainSource).toContain('"x-license-key"');
    expect(mainSource).toContain("cloudflare.sync.success");
    expect(mainSource).toContain("cloudflare.sync.auto.failed");
    expect(mainSource).toContain('"denote:cardsChanged"');
    expect(mainSource).toContain("emitCardsChanged");
  });

  it("queues Cloudflare auto sync after local card mutations", () => {
    const saveCardFunction = mainSource.match(/async function saveCard[\s\S]*?\n}/)?.[0] ?? "";
    const deleteCardFunction = mainSource.match(/async function deleteCard[\s\S]*?\n}/)?.[0] ?? "";
    const updateCardStatusFunction = mainSource.match(/async function updateCardStatus[\s\S]*?\n}/)?.[0] ?? "";

    expect(saveCardFunction).toContain('queueCloudflareAutoSync("card.save")');
    expect(deleteCardFunction).toContain('queueCloudflareAutoSync("card.delete")');
    expect(updateCardStatusFunction).toContain('queueCloudflareAutoSync("card.status")');
  });

  it("opens external links through main process instead of navigating the renderer", () => {
    expect(mainSource).toContain("shell.openExternal");
    expect(mainSource).toContain('ipcMain.handle("denote:openExternal"');
  });
});
