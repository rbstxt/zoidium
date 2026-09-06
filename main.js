const { app, BrowserWindow, ipcMain } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");
const compression = require("compression");
const handler = require("serve-handler");
const { resolveDirectoryIndexUrl } = require("./tools/directory-index");
const {
  preparePackagedStage,
  prepareRuntimeStage,
} = require("./tools/runtime-resources");

let server = null;
let runtimeStage = null;
let closingPromise = null;
let quitting = false;

const compressResponse = promisify(compression());
const welcomeTourStateFile = () => path.join(app.getPath("userData"), "welcome-tour.json");

ipcMain.handle("zoidium:welcome-tour:get-completed", async () => {
  try {
    const content = await fs.promises.readFile(welcomeTourStateFile(), "utf8");
    return JSON.parse(content).completed === true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("[Zoidium] failed to read welcome tour state:", error);
    }
    return false;
  }
});

ipcMain.handle("zoidium:welcome-tour:set-completed", async () => {
  try {
    await fs.promises.mkdir(app.getPath("userData"), { recursive: true });
    await fs.promises.writeFile(
      welcomeTourStateFile(),
      JSON.stringify({ completed: true }) + "\n",
      "utf8"
    );
    return true;
  } catch (error) {
    console.error("[Zoidium] failed to save welcome tour state:", error);
    return false;
  }
});

function listen(localServer) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      localServer.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      localServer.removeListener("error", onError);
      resolve(localServer.address().port);
    };
    localServer.once("error", onError);
    localServer.once("listening", onListening);
    localServer.listen(0, "127.0.0.1");
  });
}

async function createServer() {
  const stage = app.isPackaged
    ? await preparePackagedStage()
    : await prepareRuntimeStage();
  runtimeStage = stage;

  const localServer = http.createServer(async (request, response) => {
    try {
      await compressResponse(request, response);
      const directoryIndexUrl = await resolveDirectoryIndexUrl(request.url, stage.root);
      if (directoryIndexUrl) request.url = directoryIndexUrl;
      await handler(request, response, {
        public: stage.root,
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
        response.writeHead(500, { "Content-Type": "text/plain" });
      }
      response.end("Internal Server Error");
    }
  });

  server = localServer;
  try {
    const port = await listen(localServer);
    console.log(`Zoidium server running at http://127.0.0.1:${port}`);
    return port;
  } catch (error) {
    server = null;
    await stage.cleanup().catch(() => {});
    runtimeStage = null;
    throw error;
  }
}

function closeServer(localServer) {
  if (!localServer || !localServer.listening) return Promise.resolve();
  return new Promise((resolve) => localServer.close(resolve));
}

async function closeRuntimeServer() {
  if (closingPromise) return closingPromise;

  const localServer = server;
  const stage = runtimeStage;
  server = null;
  runtimeStage = null;

  closingPromise = (async () => {
    await closeServer(localServer);
    if (stage) await stage.cleanup();
  })();

  try {
    await closingPromise;
  } finally {
    closingPromise = null;
  }
}

async function createWindow() {
  const port = await createServer();
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  try {
    await win.loadURL(`http://127.0.0.1:${port}`);
  } catch (error) {
    await closeRuntimeServer();
    throw error;
  }
}

app.whenReady().then(() => {
  createWindow().catch((error) => {
    console.error("[Zoidium] failed to start:", error);
    app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow().catch((error) => console.error("[Zoidium] failed to reopen:", error));
    }
  });
});

app.on("before-quit", (event) => {
  if (quitting || (!server && !runtimeStage)) return;
  event.preventDefault();
  quitting = true;
  closeRuntimeServer()
    .catch((error) => console.error("[Zoidium] failed to clean runtime stage:", error))
    .finally(() => app.quit());
});

app.on("window-all-closed", () => {
  closeRuntimeServer().catch((error) => {
    console.error("[Zoidium] failed to clean runtime stage:", error);
  });
  if (process.platform !== "darwin") app.quit();
});
