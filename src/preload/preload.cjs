const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("denote", {
  version: "0.1.3",
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
