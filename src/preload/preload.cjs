const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("denote", {
  version: "0.1.0"
});
