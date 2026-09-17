"use strict";

const { app, BrowserWindow, shell } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const applicationRoot = path.resolve(__dirname, "..");
const desktopPort = Number(process.env.ZOIDIUM_DESKTOP_PORT || 17823);

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

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

function requestedPath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://zoidium.invalid").pathname);
  } catch (_error) {
    return null;
  }
  if (pathname.includes("\u0000") || pathname.includes("\\")) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;
  return segments.join("/");
}

function safePath(relativePath) {
  const root = `${applicationRoot}${path.sep}`;
  const target = path.resolve(applicationRoot, relativePath || "index.html");
  if (target !== applicationRoot && !target.startsWith(root)) {
    throw new Error("Requested path escapes the application root");
  }
  return target;
}

function etagFor(stat) {
  return `\"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}\"`;
}

async function serveRequest(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  const relativePath = requestedPath(request.url);
  if (relativePath == null) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad Request");
    return;
  }

  let filePath = safePath(relativePath);
  let stat = await fs.promises.stat(filePath);
  if (stat.isDirectory()) {
    filePath = safePath(path.join(relativePath, "index.html"));
    stat = await fs.promises.stat(filePath);
  }
  if (!stat.isFile()) throw new Error("Requested path is not a file");

  const etag = etagFor(stat);
  const headers = {
    "Cache-Control": /^plugins\/[^/]+\/bundle\.json$/.test(relativePath)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
    "Content-Length": stat.size,
    "Content-Type": MIME_TYPES.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
    ETag: etag,
  };
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, { ETag: etag, "Cache-Control": headers["Cache-Control"] });
    response.end();
    return;
  }

  response.writeHead(200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  await pipeline(fs.createReadStream(filePath), response);
}

async function startServer() {
  const localServer = http.createServer(async (request, response) => {
    try {
      await serveRequest(request, response);
    } catch (error) {
      console.error("[Zoidium] local server request failed:", error);
      if (!response.headersSent) {
        const status = error?.code === "ENOENT" ? 404 : 500;
        response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      }
      response.end(error?.code === "ENOENT" ? "Not Found" : "Internal Server Error");
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
