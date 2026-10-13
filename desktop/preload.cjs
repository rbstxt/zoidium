"use strict";

// Sandboxed preloads only have Electron's restricted require. Keep these
// channels fixed and never expose ipcRenderer, filesystem paths or Node APIs.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ZoidiumDesktopProjects", {
  onFile(callback) {
    if (typeof callback !== "function") return;
    ipcRenderer.on("zoidium:desktop-project-file", (_event, file) => callback(file));
  },
  ready() { ipcRenderer.send("zoidium:desktop-project-ready"); },
  complete(id) {
    if (typeof id === "string") ipcRenderer.send("zoidium:desktop-project-done", id);
  },
});
