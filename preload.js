const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("zoidiumDesktop", {
  getWelcomeTourCompleted: () => ipcRenderer.invoke("zoidium:welcome-tour:get-completed"),
  setWelcomeTourCompleted: () => ipcRenderer.invoke("zoidium:welcome-tour:set-completed"),
  getCrashDiagnostics: () => ipcRenderer.invoke("zoidium:debug-log:get-crashes"),
  getDebugJournal: () => ipcRenderer.invoke("zoidium:debug-log:get-journal"),
  persistDebugSession: (session) => {
    ipcRenderer.send("zoidium:debug-log:persist-session", session);
  },
  persistDebugSessionSync: (session) =>
    ipcRenderer.sendSync("zoidium:debug-log:persist-session-sync", session),
});
