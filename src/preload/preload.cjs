const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("denote", {
  version: "0.1.2",
  generateDraft(sourceText) {
    return ipcRenderer.invoke("denote:generateDraft", sourceText);
  },
  saveCard(card) {
    return ipcRenderer.invoke("denote:saveCard", card);
  },
  listCards() {
    return ipcRenderer.invoke("denote:listCards");
  },
  ask(question) {
    return ipcRenderer.invoke("denote:ask", question);
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
