const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("denote", {
  generateDraft(sourceText) {
    return ipcRenderer.invoke("denote:generateDraft", sourceText);
  },
  refineDraft(payload) {
    return ipcRenderer.invoke("denote:refineDraft", payload);
  },
  saveCard(card) {
    return ipcRenderer.invoke("denote:saveCard", card);
  },
  deleteCard(id) {
    return ipcRenderer.invoke("denote:deleteCard", id);
  },
  updateCardStatus(payload) {
    return ipcRenderer.invoke("denote:updateCardStatus", payload);
  },
  getAppInfo() {
    return ipcRenderer.invoke("denote:getAppInfo");
  },
  getUpdateState() {
    return ipcRenderer.invoke("denote:getUpdateState");
  },
  checkForUpdates() {
    return ipcRenderer.invoke("denote:checkForUpdates");
  },
  downloadUpdate() {
    return ipcRenderer.invoke("denote:downloadUpdate");
  },
  installUpdate() {
    return ipcRenderer.invoke("denote:installUpdate");
  },
  openExternal(url) {
    return ipcRenderer.invoke("denote:openExternal", url);
  },
  onUpdateStateChanged(callback) {
    const listener = (_event, updateState) => callback(updateState);
    ipcRenderer.on("denote:updateStateChanged", listener);
    return () => ipcRenderer.removeListener("denote:updateStateChanged", listener);
  },
  listCards() {
    return ipcRenderer.invoke("denote:listCards");
  },
  ask(payload) {
    return ipcRenderer.invoke("denote:ask", payload);
  },
  getSettings() {
    return ipcRenderer.invoke("denote:getSettings");
  },
  getDiagnostics() {
    return ipcRenderer.invoke("denote:getDiagnostics");
  },
  saveSettings(settings) {
    return ipcRenderer.invoke("denote:saveSettings", settings);
  },
  testSftpConnection(settings) {
    return ipcRenderer.invoke("denote:testSftpConnection", settings);
  },
  seedSamples() {
    return ipcRenderer.invoke("denote:seedSamples");
  }
});
