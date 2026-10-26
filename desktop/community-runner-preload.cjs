"use strict";
const { ipcRenderer } = require("electron");
ipcRenderer.once("zoidium:community-runner-port", event => {
  if (event.ports.length === 1) window.postMessage("zoidium-community-port", location.origin, event.ports);
});
