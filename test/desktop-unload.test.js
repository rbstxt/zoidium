"use strict";

const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const MAIN_PATH = path.join(__dirname, "../desktop/main.cjs");
const source = fs.readFileSync(MAIN_PATH, "utf8");

// Ports below 1024 are rejected by main.cjs. Pick a high one per run so
// parallel test processes are unlikely to collide.
function pickPort() {
  return 40000 + Math.floor(Math.random() * 20000);
}

function waitFor(predicate, timeoutMs = 4000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (predicate()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error("timed out"));
      setTimeout(check, 10);
    };
    check();
  });
}

// Loads desktop/main.cjs against a fake electron module. The process-level
// listeners that main.cjs installs are removed again afterwards so they do not
// leak into other tests.
function loadMainProcess({ dialogChoice = 1, dialogThrows = false, whenReady = true } = {}) {
  const logDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-unload-"));
  const processEvents = ["uncaughtException", "unhandledRejection", "exit"];
  const before = processEvents.map((name) => process.listeners(name));
  const previousPort = process.env.ZOIDIUM_DESKTOP_PORT;
  const port = pickPort();
  process.env.ZOIDIUM_DESKTOP_PORT = String(port);

  const app = new EventEmitter();
  Object.assign(app, {
    commandLine: { appendSwitch() {} },
    quitCalls: 0,
    quit() {
      app.quitCalls += 1;
    },
    getPath() {
      return logDirectory;
    },
    requestSingleInstanceLock() {
      return true;
    },
    whenReady() {
      return whenReady ? Promise.resolve() : new Promise(() => {});
    },
  });

  const windows = [];
  class FakeWebContents extends EventEmitter {
    setWindowOpenHandler() {}
    getURL() {
      return "";
    }
    executeJavaScript() {
      return Promise.resolve();
    }
  }
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new FakeWebContents();
      windows.push(this);
      app.emit("browser-window-created", {}, this);
    }
    loadURL() {
      return Promise.resolve();
    }
    isDestroyed() {
      return false;
    }
    isMinimized() {
      return false;
    }
    restore() {}
    focus() {}
  }

  const dialogCalls = [];
  const electron = {
    app,
    BrowserWindow: FakeWindow,
    Menu: { setApplicationMenu() {}, buildFromTemplate() { return {}; } },
    crashReporter: { start() {} },
    dialog: {
      showMessageBoxSync(parent, options) {
        dialogCalls.push({ parent, options });
        if (dialogThrows) throw new Error("dialog unavailable");
        return dialogChoice;
      },
    },
    shell: {
      openPath() { return Promise.resolve(""); },
      openExternal() { return Promise.resolve(); },
    },
  };
  const requireFake = (id) => {
    if (id === "electron") return electron;
    return require(id);
  };
  const moduleObject = { exports: {} };
  try {
    new Function("require", "module", "exports", "__dirname", "__filename", source)(
      requireFake,
      moduleObject,
      moduleObject.exports,
      path.dirname(MAIN_PATH),
      MAIN_PATH,
    );
  } finally {
    if (previousPort === undefined) delete process.env.ZOIDIUM_DESKTOP_PORT;
    else process.env.ZOIDIUM_DESKTOP_PORT = previousPort;
    processEvents.forEach((name, index) => {
      for (const listener of process.listeners(name)) {
        if (!before[index].includes(listener)) process.removeListener(name, listener);
      }
    });
  }

  return {
    app,
    windows,
    dialogCalls,
    port,
    cleanup() {
      fs.rmSync(logDirectory, { recursive: true, force: true });
    },
  };
}

async function waitUntilServing(port) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if ((await requestStatus(port)) === 200) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function createEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function requestStatus(port) {
  return new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: "/" }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", () => resolve(null));
  });
}

test("closing a window with unsaved changes asks the user and allows Leave", async () => {
  const main = loadMainProcess({ dialogChoice: 0 });
  try {
    await waitFor(() => main.windows.length === 1);
    const event = createEvent();
    main.windows[0].webContents.emit("will-prevent-unload", event);

    assert.equal(main.dialogCalls.length, 1);
    assert.equal(main.dialogCalls[0].parent, main.windows[0]);
    assert.deepEqual(main.dialogCalls[0].options.buttons, ["Leave", "Stay"]);
    assert.equal(main.dialogCalls[0].options.defaultId, 1);
    assert.equal(main.dialogCalls[0].options.cancelId, 1);
    assert.match(main.dialogCalls[0].options.message, /unsaved changes/i);
    assert.equal(event.defaultPrevented, true, "Leave lets the page unload");
  } finally {
    main.app.emit("will-quit", createEvent());
    await waitFor(() => main.app.quitCalls >= 1).catch(() => {});
    main.cleanup();
  }
});

test("choosing Stay keeps the window open", async () => {
  const main = loadMainProcess({ dialogChoice: 1 });
  try {
    await waitFor(() => main.windows.length === 1);
    const event = createEvent();
    main.windows[0].webContents.emit("will-prevent-unload", event);

    assert.equal(main.dialogCalls.length, 1);
    assert.equal(event.defaultPrevented, false, "Stay leaves the cancelled unload in place");
  } finally {
    main.app.emit("will-quit", createEvent());
    await waitFor(() => main.app.quitCalls >= 1).catch(() => {});
    main.cleanup();
  }
});

test("a failing unsaved-changes prompt does not trap the user", async () => {
  const main = loadMainProcess({ dialogThrows: true });
  try {
    await waitFor(() => main.windows.length === 1);
    const event = createEvent();
    main.windows[0].webContents.emit("will-prevent-unload", event);
    assert.equal(event.defaultPrevented, true);
  } finally {
    main.app.emit("will-quit", createEvent());
    await waitFor(() => main.app.quitCalls >= 1).catch(() => {});
    main.cleanup();
  }
});

test("quit closes the local server once and then lets the application exit", async () => {
  const main = loadMainProcess({ dialogChoice: 1 });
  try {
    await waitFor(() => main.windows.length === 1);
    await waitFor(() => main.app.listenerCount("will-quit") === 1);
    await waitUntilServing(main.port);
    assert.equal(await requestStatus(main.port), 200, "the server answers before quit");

    const first = createEvent();
    main.app.emit("will-quit", first);
    assert.equal(first.defaultPrevented, true, "quit waits for the server to close");
    await waitFor(() => main.app.quitCalls === 1);
    assert.equal(await requestStatus(main.port), null, "the server no longer listens");

    const second = createEvent();
    main.app.emit("will-quit", second);
    assert.equal(second.defaultPrevented, false, "the second pass lets the quit finish");
  } finally {
    main.cleanup();
  }
});

test("quit proceeds immediately when the server never started", async () => {
  const main = loadMainProcess({ whenReady: false });
  try {
    const event = createEvent();
    main.app.emit("will-quit", event);
    assert.equal(event.defaultPrevented, false);
    assert.equal(main.app.quitCalls, 0);
  } finally {
    main.cleanup();
  }
});

test("quit handling lives in will-quit, not before-quit", () => {
  assert.equal(source.includes('app.on("before-quit"'), false);
  assert.match(source, /app\.on\("will-quit"/);
});
