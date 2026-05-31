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
  onUpdateStateChanged(callback) {
    const listener = (_event, updateState) => callback(updateState);
    ipcRenderer.on("denote:updateStateChanged", listener);
    return () => ipcRenderer.removeListener("denote:updateStateChanged", listener);
  },
  setTaskProvider(provider) {
    return ipcRenderer.invoke("denote:setTaskProvider", provider);
  },
  getTaskProviderMetadata() {
    return ipcRenderer.invoke("denote:getTaskProviderMetadata");
  },
  discoverNotionDatabases() {
    return ipcRenderer.invoke("denote:discoverNotionDatabases");
  },
  listTasks() {
    return ipcRenderer.invoke("denote:listTasks");
  },
  createTask(task) {
    return ipcRenderer.invoke("denote:createTask", task);
  },
  updateTaskStatus(payload) {
    return ipcRenderer.invoke("denote:updateTaskStatus", payload);
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
  seedSamples() {
    return ipcRenderer.invoke("denote:seedSamples");
  }
});
