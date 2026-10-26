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

contextBridge.exposeInMainWorld("ZoidiumDesktopCommunity", {
  safeMode: process.argv.includes("--zoidium-community-safe-mode"),
  load: () => ipcRenderer.invoke("zoidium:community-store", { operation: "load" }),
  commit: (revision, next) => ipcRenderer.invoke("zoidium:community-store", { operation: "commit", revision, next }),
});
window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin || event.data?.type !== "zoidium:community-connect") return;
  ipcRenderer.postMessage("zoidium:community-connect", event.data.config, event.ports);
});
