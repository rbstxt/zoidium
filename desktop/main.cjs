"use strict";

const { app, BrowserWindow, Menu, crashReporter, dialog, shell, screen } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");

const applicationRoot = path.resolve(__dirname, "..");
const desktopPort = Number(process.env.ZOIDIUM_DESKTOP_PORT || 17823);

// Keep the renderer on Chromium's legacy font path on macOS while the bundled
// Electron runtime and the host OS are validated against Fontations changes.
if (process.platform === "darwin") {
  app.commandLine.appendSwitch("disable-features", "FontationsFontBackend");
}

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

process.on("uncaughtException", (error) => {
  logMain("fatal", "uncaught main-process exception", errorDetails(error));
  setImmediate(() => app.quit());
});
process.on("unhandledRejection", (reason) => {
  logMain("error", "unhandled main-process rejection", errorDetails(reason));
});
process.on("exit", (code) => {
  logMain("info", "main process exiting", { code });
});

let server = null;
let serverOrigin = null;
let mainWindow = null;
let mainRecovery = null;
let closingPromise = null;
let quitting = false;
let quitRequested = false;
let mainLogPath = null;
let mainLogDirectory = null;
let pendingMainLogLines = [];
const MAIN_LOG_MAX_BYTES = 5 * 1024 * 1024;

function errorDetails(error) {
  if (!error || typeof error !== "object") return { message: String(error) };
  return {
    name: error.name || "Error",
    message: error.message || String(error),
    ...(error.code != null ? { code: error.code } : {}),
    ...(error.stack ? { stack: error.stack } : {}),
  };
}

function appendMainLogLine(line) {
  if (!mainLogPath) {
    pendingMainLogLines.push(line);
    if (pendingMainLogLines.length > 200) pendingMainLogLines.shift();
    return;
  }
  try {
    let currentBytes = 0;
    try {
      currentBytes = fs.statSync(mainLogPath).size;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (currentBytes + Buffer.byteLength(line, "utf8") > MAIN_LOG_MAX_BYTES) {
      const rotatedPath = `${mainLogPath}.1`;
      fs.rmSync(rotatedPath, { force: true });
      fs.renameSync(mainLogPath, rotatedPath);
    }
    fs.appendFileSync(mainLogPath, line, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    try {
      process.stderr.write(`[Zoidium] could not write the main log: ${error.stack || error}\n`);
    } catch (_writeError) {
      // There is nowhere else to report a logging failure.
    }
  }
}

function logMain(level, message, details) {
  const entry = {
    at: new Date().toISOString(),
    level,
    message: String(message),
    ...(details === undefined ? {} : { details }),
  };
  let line;
  try {
    line = `${JSON.stringify(entry)}\n`;
  } catch (error) {
    line = `${JSON.stringify({
      at: entry.at,
      level: "error",
      message: "Could not serialize a main-process log entry",
      details: errorDetails(error),
    })}\n`;
  }
  appendMainLogLine(line);
}

function initializeMainLog() {
  try {
    mainLogDirectory = app.getPath("logs");
    fs.mkdirSync(mainLogDirectory, { recursive: true, mode: 0o700 });
    mainLogPath = path.join(mainLogDirectory, "zoidium-main.log");
    const pending = pendingMainLogLines;
    pendingMainLogLines = [];
    if (pending.length > 0) appendMainLogLine(pending.join(""));
    logMain("info", "main process started", {
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      logPath: mainLogPath,
    });
  } catch (error) {
    process.stderr.write(`[Zoidium] could not initialize the main log: ${error.stack || error}\n`);
  }
}

function initializeCrashReporter() {
  try {
    crashReporter.start({
      productName: "Zoidium",
      uploadToServer: false,
      compress: false,
      globalExtra: { log_mode: "local-only" },
    });
    logMain("info", "native crash reporter started", {
      crashDumpsPath: app.getPath("crashDumps"),
      uploadToServer: false,
    });
  } catch (error) {
    logMain("error", "failed to start native crash reporter", errorDetails(error));
  }
}

function openLogFolder() {
  if (!mainLogDirectory) {
    logMain("warn", "debug log folder requested before the main log was ready");
    return;
  }
  shell.openPath(mainLogDirectory).then((errorMessage) => {
    if (errorMessage) logMain("error", "failed to open the debug log folder", { errorMessage });
  });
}

function downloadRendererDebugLog() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    logMain("warn", "renderer debug log requested without a window");
    return;
  }
  mainWindow.webContents
    .executeJavaScript(
      "(async function () {" +
      "if (!window.ZOIDIUM_DEBUG_LOG || typeof window.ZOIDIUM_DEBUG_LOG.download !== 'function') " +
      "throw new Error('Renderer debug log is not available');" +
      "return window.ZOIDIUM_DEBUG_LOG.download();" +
      "})()",
      true,
    )
    .then((result) => logMain("info", "renderer debug log requested from application menu", result))
    .catch((error) => logMain("error", "renderer debug log request failed", errorDetails(error)));
}

function installApplicationMenu() {
  const template = [
    process.platform === "darwin"
      ? { role: "appMenu" }
      : { label: "File", submenu: [{ role: "quit" }] },
    {
      label: "Debug",
      submenu: [
        { label: "Download debug log", click: downloadRendererDebugLog },
        { label: "Open debug log folder", click: openLogFolder },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
  ];
  if (process.platform === "darwin") template.push({ role: "windowMenu" });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

initializeMainLog();
initializeCrashReporter();

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

function parseByteRange(value, size) {
  if (!value || !value.startsWith("bytes=")) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
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
    "Last-Modified": stat.mtime.toUTCString(),
    "Accept-Ranges": "bytes",
  };
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, { ETag: etag, "Cache-Control": headers["Cache-Control"] });
    response.end();
    return;
  }

  const ifRange = request.headers["if-range"];
  const ifRangeDate = ifRange ? Date.parse(ifRange) : NaN;
  const rangeAllowed = !ifRange || ifRange === etag ||
    (Number.isFinite(ifRangeDate) && Math.floor(stat.mtimeMs / 1000) <= Math.floor(ifRangeDate / 1000));
  const range = request.method === "GET" && rangeAllowed
    ? parseByteRange(request.headers.range, stat.size)
    : null;
  if (range === false) {
    response.writeHead(416, { ...headers, "Content-Length": 0, "Content-Range": `bytes */${stat.size}` });
    response.end();
    return;
  }
  if (range) {
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${stat.size}`;
    headers["Content-Length"] = range.end - range.start + 1;
  }
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  await pipeline(fs.createReadStream(filePath, range || undefined), response);
}

async function startServer() {
  const localServer = http.createServer(async (request, response) => {
    try {
      await serveRequest(request, response);
    } catch (error) {
      if (response.destroyed || error?.code === "ERR_STREAM_PREMATURE_CLOSE") return;
      logMain("error", "local server request failed", errorDetails(error));
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
  logMain("info", "desktop server running", { origin: serverOrigin });
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
    logMain("error", "failed to open external URL", {
      url: value,
      ...errorDetails(error),
    });
  });
}

// Chromium reports a page whose beforeunload handler tries to cancel the close
// (the editor does this while the project has unsaved changes). Electron cancels
// the close silently unless this event is prevented, which looked like a window
// that could not be closed. Ask the user instead. Electron only honors
// preventDefault when it is called synchronously, so the dialog is synchronous.
// The window stays open unless the user picks "Leave".
const UNLOAD_CHOICE_LEAVE = 0;
const UNLOAD_CHOICE_STAY = 1;

function confirmLeaveWindow(window, event) {
  let choice = UNLOAD_CHOICE_STAY;
  try {
    choice = dialog.showMessageBoxSync(window, {
      type: "question",
      title: "Unsaved changes",
      message: "Leave this project with unsaved changes?",
      detail:
        "Changes made since the last save will be lost if you leave now. " +
        "Choose Stay to keep working and save the project first.",
      buttons: ["Leave", "Stay"],
      defaultId: UNLOAD_CHOICE_STAY,
      cancelId: UNLOAD_CHOICE_STAY,
      noLink: true,
    });
  } catch (error) {
    // Do not trap the user in a window whose prompt cannot be shown.
    logMain("error", "could not show the unsaved-changes dialog; closing", errorDetails(error));
    choice = UNLOAD_CHOICE_LEAVE;
  }
  if (choice === UNLOAD_CHOICE_LEAVE) {
    event.preventDefault();
    logMain("info", "window closed after the user chose to leave with unsaved changes");
  } else {
    quitRequested = false;
    logMain("info", "window close cancelled; the user chose to stay");
  }
}

function installRendererRecovery(window) {
  let prompt = null;
  let generation = 0;
  let expectedTermination = false;
  let unresponsiveReported = false;
  let heartbeat = null;
  let heartbeatTimer = null;
  function cancelHeartbeat() {
    if (heartbeat) clearTimeout(heartbeat.timeout);
    heartbeat = null;
  }
  async function recover(crashed) {
    if (quitting || window.isDestroyed() || prompt) return;
    const currentGeneration = generation;
    const closing = quitRequested;
    try {
      prompt = dialog.showMessageBox(window, {
        type: "warning",
        title: crashed ? "Editor stopped" : "Editor is not responding",
        message: crashed ? "The editor process stopped unexpectedly." : "The editor is taking too long to respond.",
        detail: closing
          ? "Closing discards unsaved changes. Choose Wait to keep the window open, or Close to quit the editor."
          : "Reloading discards unsaved changes. Choose Wait to keep the window open, or Reload to restart the editor.",
        buttons: [closing ? "Close" : "Reload", "Wait"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      });
      const { response } = await prompt;
      if (response !== 0) {
        if (quitRequested) quitRequested = false;
        return;
      }
      if (quitting || window.isDestroyed()) return;
      if (generation !== currentGeneration) {
        if (quitRequested) app.quit();
        return;
      }
      if (quitRequested) {
        window.destroy();
        return;
      }
      // A hung renderer cannot process reload or beforeunload. Stop it first,
      // after the user has explicitly accepted losing unsaved changes.
      if (!crashed) {
        expectedTermination = true;
        window.webContents.forcefullyCrashRenderer();
        // Reload only after Chromium confirms termination. Reloading while
        // the hung process is still exiting can leave an empty window.
        return;
      }
      window.webContents.reload();
    } catch (error) {
      expectedTermination = false;
      logMain("error", "could not recover the renderer", errorDetails(error));
    } finally {
      prompt = null;
    }
  }
  window.webContents.on("render-process-gone", (_event, details) => {
    if (expectedTermination) {
      expectedTermination = false;
      logMain("info", "renderer stopped for the requested reload");
      if (!quitting && !window.isDestroyed()) {
        try {
          if (quitRequested) window.destroy();
          else window.webContents.reload();
        } catch (error) {
          logMain("error", "could not reload after stopping the renderer", errorDetails(error));
        }
      }
      return;
    }
    if (quitting || details?.reason === "clean-exit") return;
    logMain("fatal", "renderer process ended", details);
    recover(true);
  });
  function onUnresponsive() {
    if (unresponsiveReported) return;
    unresponsiveReported = true;
    logMain("error", "renderer became unresponsive");
    recover(false);
  }
  function onResponsive() {
    unresponsiveReported = false;
    generation += 1;
    logMain("info", "renderer became responsive");
  }
  window.on("unresponsive", onUnresponsive);
  window.webContents.on("unresponsive", onUnresponsive);
  window.on("responsive", onResponsive);
  window.webContents.on("responsive", onResponsive);
  window.webContents.on("did-start-loading", () => {
    generation += 1;
    unresponsiveReported = false;
    cancelHeartbeat();
  });
  window.webContents.on("did-finish-load", () => {
    expectedTermination = false;
    if (heartbeatTimer) return;
    // Native unresponsive events depend on OS interaction and may never fire
    // for a busy JavaScript loop. Keep at most one small liveness request in
    // flight, and ask the user when it cannot respond within five seconds.
    heartbeatTimer = setInterval(() => {
      if (heartbeat || quitting || window.isDestroyed() || window.webContents.isLoading()) return;
      const token = { timeout: null };
      heartbeat = token;
      token.timeout = setTimeout(() => {
        if (heartbeat === token) onUnresponsive();
      }, 5000);
      window.webContents.executeJavaScript("true").then(() => {
        if (heartbeat !== token) return;
        cancelHeartbeat();
        if (unresponsiveReported) onResponsive();
      }, () => {
        if (heartbeat === token) cancelHeartbeat();
      });
    }, 10000);
    heartbeatTimer.unref?.();
  });
  window.on("closed", () => {
    generation += 1;
    cancelHeartbeat();
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  });
  return {
    isUnresponsive: () => unresponsiveReported,
    requestQuit: () => recover(false),
  };
}

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(app.getPath("userData"), "window-state.json"), "utf8"));
    const bounds = state.bounds;
    if (!bounds || ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger)) return null;
    if (bounds.width < 960 || bounds.height < 640 || bounds.width > 16384 || bounds.height > 16384) return null;
    const visible = screen?.getAllDisplays().some(({ workArea }) =>
      bounds.x < workArea.x + workArea.width - 80 && bounds.x + bounds.width > workArea.x + 80 &&
      bounds.y >= workArea.y && bounds.y < workArea.y + workArea.height - 32);
    // Retain size, but let the OS center a window from a disconnected display.
    return { bounds: visible ? bounds : { width: bounds.width, height: bounds.height }, maximized: state.maximized === true };
  } catch (_error) {
    return null;
  }
}

function saveWindowState(window) {
  try {
    const state = { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
    const filename = path.join(app.getPath("userData"), "window-state.json");
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, JSON.stringify(state), { mode: 0o600 });
  } catch (error) {
    logMain("warn", "could not save window state", errorDetails(error));
  }
}

function createRendererConsoleLogger() {
  const recent = new Map();
  return (_event, level, message, line, sourceId) => {
    const names = ["debug", "info", "warn", "error", "error"];
    message = String(message ?? "").slice(0, 8192);
    sourceId = String(sourceId ?? "").slice(0, 2048);
    const key = [level, message, line, sourceId].join("\n");
    const previous = recent.get(key);
    const now = Date.now();
    if (previous && now - previous.time < 10000) {
      previous.repetitions += 1;
      return;
    }
    if (recent.size >= 100) recent.delete(recent.keys().next().value);
    recent.set(key, { time: now, repetitions: 0 });
    logMain(names[level] || "info", "renderer console message", {
      message,
      line,
      sourceId,
      ...(previous?.repetitions ? { suppressedRepetitions: previous.repetitions } : {}),
    });
  };
}

async function createWindow() {
  const port = server ? Number(new URL(serverOrigin).port) : await startServer();
  const state = readWindowState();
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    ...state?.bounds,
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
  if (state?.maximized) window.maximize();
  window.on("close", () => saveWindowState(window));

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
  window.webContents.on("console-message", createRendererConsoleLogger());
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logMain("error", "renderer failed to load", {
      errorCode,
      errorDescription,
      validatedURL,
      isMainFrame,
    });
  });
  mainRecovery = installRendererRecovery(window);
  window.webContents.on("did-finish-load", () => {
    logMain("info", "renderer finished loading", { url: window.webContents.getURL() });
  });

  mainWindow = window;
  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
      mainRecovery = null;
    }
    // Electron can cancel its quit while processing beforeunload even when
    // will-prevent-unload subsequently allows the window to close. Resume
    // the explicit quit after that close, including on macOS.
    if (quitRequested) setImmediate(() => {
      if (quitRequested && BrowserWindow.getAllWindows().length === 0) app.quit();
    });
  });
  await window.loadURL(`http://127.0.0.1:${port}/`);
}

function closeHttpServer(localServer, timeoutMs = 2000) {
  return new Promise((resolve) => {
    let timer;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve();
    };
    timer = setTimeout(() => {
      localServer.closeAllConnections?.();
      finish();
    }, timeoutMs);
    localServer.close(finish);
    localServer.closeIdleConnections?.();
  });
}

function closeServer() {
  // Clear the references even when the server never started listening. The
  // will-quit handler relies on this so that it cannot re-run indefinitely.
  const localServer = server;
  server = null;
  serverOrigin = null;
  if (!localServer || !localServer.listening) return Promise.resolve();
  return closeHttpServer(localServer);
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
  app.on("child-process-gone", (_event, details) => {
    logMain("fatal", "child process ended", {
      type: details?.type,
      name: details?.name,
      reason: details?.reason,
      exitCode: details?.exitCode,
      serviceName: details?.serviceName,
    });
  });

  // Every window, including child windows opened by the page, gets the
  // unsaved-changes prompt. Attaching it here avoids a silent cancel in any of them.
  app.on("browser-window-created", (_event, createdWindow) => {
    createdWindow.webContents.on("will-prevent-unload", (event) => {
      confirmLeaveWindow(createdWindow, event);
    });
  });

  app.on("second-instance", () => {
    logMain("info", "second instance requested focus");
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    installApplicationMenu();
    return createWindow();
  }).catch((error) => {
    logMain("fatal", "failed to start desktop application", errorDetails(error));
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => logMain("error", "failed to reopen", errorDetails(error)));
    }
  });

  app.on("before-quit", (event) => {
    quitRequested = true;
    if (quitting || BrowserWindow.getAllWindows().length === 0) return;
    // Cancel Electron's pending quit before asking windows to close. A hung
    // beforeunload otherwise leaves Electron in a quit that subsequent calls
    // cannot restart after the user chooses Wait in the recovery dialog.
    event.preventDefault();
    if (mainRecovery?.isUnresponsive()) mainRecovery.requestQuit();
    else for (const window of BrowserWindow.getAllWindows()) {
      if (!quitRequested) break;
      window.close();
    }
  });

  // Shut the local server down only once the quit is certain. Windows are
  // closed (and may prompt for unsaved changes) before will-quit runs, and a
  // "Stay" choice cancels the quit; if the server had been closed earlier, the
  // window would be left without its resources. closeHttpServer always resolves within its timeout,
  // so this cannot keep the application from quitting.
  app.on("will-quit", (event) => {
    if (!server) return;
    event.preventDefault();
    quitting = true;
    closeApplicationServer()
      .catch((error) => logMain("error", "failed to close local server", errorDetails(error)))
      .finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    if (quitRequested || process.platform !== "darwin") app.quit();
  });
}
