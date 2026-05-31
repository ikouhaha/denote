const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("denote", {
  version: "0.1.3",
  generateDraft(sourceText) {
    return ipcRenderer.invoke("denote:generateDraft", sourceText);
  },
  saveCard(card) {
    return ipcRenderer.invoke("denote:saveCard", card);
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
  saveSettings(settings) {
    return ipcRenderer.invoke("denote:saveSettings", settings);
  },
  seedSamples() {
    return ipcRenderer.invoke("denote:seedSamples");
  }
});
