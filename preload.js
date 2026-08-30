const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('zoidiumDesktop', {
  getWelcomeTourCompleted: () => ipcRenderer.invoke('zoidium:welcome-tour:get-completed'),
  setWelcomeTourCompleted: () => ipcRenderer.invoke('zoidium:welcome-tour:set-completed')
});
