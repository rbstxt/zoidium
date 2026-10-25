"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pipeline } = require("node:stream/promises");

// CM3 imports the archive with its 32-bit tar worker. Stream the input instead
// of copying a potentially large archive into a main-process IPC buffer.
const MAX_PROJECT_BYTES = 0x7fffffff;
// The web deployment sends these headers for every response (see _headers);
// the desktop project route applies the same pair to each of its responses.
const projectSecurityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "frame-ancestors 'self'; object-src 'none'",
};
const PROJECT_ROUTE = "/_zoidium/desktop-project/";
const READY_CHANNEL = "zoidium:desktop-project-ready";
const FILE_CHANNEL = "zoidium:desktop-project-file";
const DONE_CHANNEL = "zoidium:desktop-project-done";

function projectPathsFromArgv(argv, { defaultApp = false, appPath = "", pathApi = path } = {}) {
  const paths = [];
  const valueFlags = new Set([
    "--user-data-dir", "--remote-debugging-port", "--js-flags", "--log-file", "--proxy-server",
  ]);
  let skipApplication = defaultApp;
  for (let index = 1; index < (Array.isArray(argv) ? argv.length : 0); index += 1) {
    const value = argv[index];
    if (typeof value !== "string") continue;
    if (value.startsWith("-")) {
      if (valueFlags.has(value)) index += 1;
      continue;
    }
    if (skipApplication) { skipApplication = false; continue; }
    if (appPath && pathApi.resolve(value) === pathApi.resolve(appPath)) continue;
    if (pathApi.isAbsolute(value) && pathApi.extname(value).toLowerCase() === ".pz") paths.push(value);
  }
  return paths;
}

function validateProjectPath(filename, { fsApi = fs, pathApi = path } = {}) {
  if (typeof filename !== "string" || !pathApi.isAbsolute(filename) ||
      pathApi.extname(filename).toLowerCase() !== ".pz") return null;
  try {
    const stat = fsApi.statSync(filename);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PROJECT_BYTES) return null;
    return { filename, name: pathApi.basename(filename) };
  } catch (_error) {
    return null;
  }
}

function createProjectFileController({ app, ipcMain, argv, defaultApp, appPath,
  getWindow, openWindow, isLocalUrl, onError = () => {} }) {
  const pending = [];
  let window = null;
  let rendererReady = false;
  let applicationReady = false;
  let openingWindow = null;
  let active = null;

  function focus() {
    const current = getWindow();
    if (!current || current.isDestroyed()) return;
    if (current.isMinimized()) current.restore();
    current.show?.();
    current.focus();
  }

  function flush() {
    if (!rendererReady || active || !window || window.isDestroyed() || !pending.length) return;
    active = { ...pending.shift(), id: randomUUID() };
    focus();
    window.webContents.send(FILE_CHANNEL, {
      id: active.id,
      name: active.name,
      url: PROJECT_ROUTE + active.id,
    });
  }

  function enqueue(filename) {
    const file = validateProjectPath(filename);
    if (!file || pending.length >= 32) return;
    pending.push(file);
    focus();
    if (applicationReady && !getWindow() && !openingWindow) {
      openingWindow = Promise.resolve().then(() => {
        if (!getWindow()) return openWindow();
      }).catch(onError).finally(() => {
        openingWindow = null;
      });
    }
    flush();
  }

  function enqueueArgv(args) {
    for (const filename of projectPathsFromArgv(args, { defaultApp, appPath })) enqueue(filename);
  }

  function trustedSender(event) {
    return window && !window.isDestroyed() && event.sender === window.webContents &&
      event.senderFrame === window.webContents.mainFrame &&
      isLocalUrl(event.senderFrame.url);
  }

  // Register before whenReady: macOS can send open-file during startup.
  app.on("open-file", (event, filename) => {
    event.preventDefault();
    enqueue(filename);
  });
  app.on("second-instance", (_event, args) => {
    enqueueArgv(args);
    focus();
  });
  ipcMain?.on(READY_CHANNEL, (event) => {
    if (!trustedSender(event)) return;
    rendererReady = true;
    flush();
  });
  ipcMain?.on(DONE_CHANNEL, (event, id) => {
    if (!trustedSender(event) || !active || id !== active.id) return;
    active = null;
    flush();
  });
  enqueueArgv(argv);

  function resetRenderer() {
    rendererReady = false;
    if (active) pending.unshift({ filename: active.filename, name: active.name });
    active = null;
  }

  return {
    applicationReady() { applicationReady = true; },
    attachWindow(current) {
      window = current;
      resetRenderer();
      current.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
        if (window === current && isMainFrame && !isInPlace) resetRenderer();
      });
      current.webContents.on("render-process-gone", () => {
        if (window === current) resetRenderer();
      });
      current.on("closed", () => {
        if (window !== current) return;
        resetRenderer();
        window = null;
      });
    },
    async serveRequest(request, response) {
      const requestPath = String(request.url || "").split("?")[0];
      if (!requestPath.startsWith(PROJECT_ROUTE)) return false;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", projectSecurityHeaders["X-Content-Type-Options"]);
      response.setHeader("Content-Security-Policy", projectSecurityHeaders["Content-Security-Policy"]);
      if (!["GET", "HEAD"].includes(request.method)) {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return true;
      }
      if (!active || requestPath !== PROJECT_ROUTE + active.id) {
        response.writeHead(404);
        response.end();
        return true;
      }
      let file;
      try {
        // Re-check after opening: the file may have changed since the OS event.
        // O_NONBLOCK also prevents a substituted FIFO from blocking startup.
        file = await fs.promises.open(active.filename, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const stat = await file.stat();
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PROJECT_BYTES) {
          response.writeHead(404);
          response.end();
          return true;
        }
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": stat.size,
          "X-Content-Type-Options": projectSecurityHeaders["X-Content-Type-Options"],
          "Content-Security-Policy": projectSecurityHeaders["Content-Security-Policy"],
        });
        if (request.method === "HEAD") response.end();
        else await pipeline(file.createReadStream({ autoClose: false }), response);
      } catch (error) {
        if (!response.headersSent) response.writeHead(404);
        if (!response.destroyed) response.end();
        if (error.code !== "ENOENT" && error.code !== "ERR_STREAM_PREMATURE_CLOSE") onError(error);
      } finally {
        await file?.close();
      }
      return true;
    },
  };
}

module.exports = {
  MAX_PROJECT_BYTES, PROJECT_ROUTE, READY_CHANNEL, FILE_CHANNEL, DONE_CHANNEL,
  projectPathsFromArgv, validateProjectPath, createProjectFileController,
};
