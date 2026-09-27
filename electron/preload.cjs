const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("moraCredentials", {
  load: () => ipcRenderer.invoke("mora:credentials:load"),
  save: (credentials) => ipcRenderer.invoke("mora:credentials:save", credentials),
  clear: () => ipcRenderer.invoke("mora:credentials:clear"),
});
