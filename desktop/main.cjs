"use strict";

const { app, BrowserWindow, shell } = require("electron");
const http = require("node:http");
const path = require("node:path");
const compression = require("compression");
const handler = require("serve-handler");

const applicationRoot = path.resolve(__dirname, "..");
const compressResponse = compression();
const desktopPort = Number(process.env.ZOIDIUM_DESKTOP_PORT || 17823);

if (!Number.isInteger(desktopPort) || desktopPort < 1024 || desktopPort > 65535) {
  throw new Error("ZOIDIUM_DESKTOP_PORT must be an integer between 1024 and 65535");
}

let server = null;
let serverOrigin = null;
let mainWindow = null;
let closingPromise = null;
let quitting = false;

function listen(localServer, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      localServer.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      localServer.off("error", onError);
      resolve(localServer.address().port);
    };
    localServer.once("error", onError);
    localServer.once("listening", onListening);
    localServer.listen(port, "127.0.0.1");
  });
}

async function startServer() {
  const localServer = http.createServer(async (request, response) => {
    try {
      await new Promise((resolve, reject) => {
        compressResponse(request, response, (error) => (error ? reject(error) : resolve()));
      });
      await handler(request, response, {
        public: applicationRoot,
        etag: true,
        directoryListing: false,
        headers: [
          {
            source: "/plugins/*/bundle.json",
            headers: [
              {
                key: "Cache-Control",
                value: "public, max-age=31536000, immutable",
              },
            ],
          },
        ],
      });
    } catch (error) {
      console.error("[Zoidium] local server request failed:", error);
      if (!response.headersSent) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      response.end("Internal Server Error");
    }
  });

  const port = await listen(localServer, desktopPort);
  server = localServer;
  serverOrigin = `http://127.0.0.1:${port}`;
  console.log(`[Zoidium] desktop server running at ${serverOrigin}`);
  return port;
}

function isLocalUrl(value) {
  if (value === "about:blank") return true;
  try {
    return new URL(value).origin === serverOrigin;
  } catch (_error) {
    return false;
  }
}

function openExternal(value) {
  shell.openExternal(value).catch((error) => {
    console.error("[Zoidium] failed to open external URL:", error);
  });
}

async function createWindow() {
  const port = server ? Number(new URL(serverOrigin).port) : await startServer();
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#111318",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocalUrl(url)) return { action: "allow" };
    openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isLocalUrl(url)) return;
    event.preventDefault();
    openExternal(url);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    if (quitting || details?.reason === "clean-exit") return;
    console.error("[Zoidium] renderer process ended:", details);
  });

  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  await window.loadURL(`http://127.0.0.1:${port}/`);
}

function closeServer() {
  if (!server || !server.listening) return Promise.resolve();
  const localServer = server;
  server = null;
  serverOrigin = null;
  return new Promise((resolve) => localServer.close(resolve));
}

function closeApplicationServer() {
  if (closingPromise) return closingPromise;
  closingPromise = closeServer().finally(() => {
    closingPromise = null;
  });
  return closingPromise;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => createWindow()).catch((error) => {
    console.error("[Zoidium] failed to start desktop application:", error);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => console.error("[Zoidium] failed to reopen:", error));
    }
  });

  app.on("before-quit", (event) => {
    if (quitting || !server) return;
    event.preventDefault();
    quitting = true;
    closeApplicationServer()
      .catch((error) => console.error("[Zoidium] failed to close local server:", error))
      .finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
