"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const EventEmitter = require("node:events");
const test = require("node:test");
const {
  MAX_PROJECT_BYTES, READY_CHANNEL, DONE_CHANNEL, FILE_CHANNEL,
  projectPathsFromArgv, validateProjectPath, createProjectFileController,
} = require("../desktop/project-files.cjs");

const settle = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-desktop-project-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "Saved project.PZ");
  fs.writeFileSync(file, "project bytes");
  return { root, file };
}

function harness(argv = [], defaultApp = false) {
  const app = new EventEmitter();
  const ipcMain = new EventEmitter();
  let window = null;
  let created = 0;
  class FakeWindow extends EventEmitter {
    constructor() {
      super();
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = { url: "http://127.0.0.1:8471/" };
      this.messages = [];
      this.webContents.send = (channel, message) => this.messages.push({ channel, message });
      this.minimized = true;
      this.focusCalls = 0;
    }
    isDestroyed() { return false; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized = false; }
    focus() { this.focusCalls += 1; }
  }
  const controller = createProjectFileController({
    app, ipcMain, argv, defaultApp, appPath: "/application",
    getWindow: () => window,
    openWindow: () => { created += 1; attach(); },
    isLocalUrl: (url) => url === "http://127.0.0.1:8471/",
  });
  function attach() {
    window = new FakeWindow();
    controller.attachWindow(window);
    return window;
  }
  function event() { return { sender: window.webContents, senderFrame: window.webContents.mainFrame }; }
  return {
    app, ipcMain, controller, attach, event,
    ready() { ipcMain.emit(READY_CHANNEL, event()); },
    done(id) { ipcMain.emit(DONE_CHANNEL, event(), id); },
    open(file) {
      const event = { prevented: false, preventDefault() { this.prevented = true; } };
      app.emit("open-file", event, file);
      assert.equal(event.prevented, true);
    },
    close() { window.emit("closed"); window = null; },
    window: () => window, created: () => created,
  };
}

test("packaged and dev argv omit executable, app, flags and flag values", () => {
  assert.deepEqual(projectPathsFromArgv(["/zoidium", "--no-sandbox", "/tmp/a.PZ", "relative.pz", "https://host/b.pz", "--file=/tmp/c.pz"]), ["/tmp/a.PZ"]);
  assert.deepEqual(projectPathsFromArgv(["/electron", "--inspect=9229", "/app", "--user-data-dir", "/tmp/profile.pz", "/tmp/a.pz"], { defaultApp: true }), ["/tmp/a.pz"]);
  assert.deepEqual(projectPathsFromArgv(["/zoidium", "/tmp/application.pz", "/tmp/a.pz"], { appPath: "/tmp/application.pz" }), ["/tmp/a.pz"]);
  assert.deepEqual(projectPathsFromArgv(["/electron", "--inspect", "/app", "/tmp/a.pz"], { defaultApp: true }), ["/tmp/a.pz"]);
  assert.deepEqual(projectPathsFromArgv(undefined), []);
});

test("Windows argv accepts absolute drive and UNC paths without resolving relative input", () => {
  assert.deepEqual(projectPathsFromArgv(["C:\\Zoidium.exe", "C:\\My Projects\\Saved.PZ", "\\\\server\\share\\a.pz", "C:a.pz", "a.pz"], { pathApi: path.win32 }), ["C:\\My Projects\\Saved.PZ", "\\\\server\\share\\a.pz"]);
});

test("only existing, nonempty, regular absolute .pz files are accepted", (t) => {
  const { root, file } = fixture(t);
  assert.equal(validateProjectPath(file).name, "Saved project.PZ");
  const empty = path.join(root, "empty.pz");
  fs.writeFileSync(empty, "");
  const folder = path.join(root, "folder.pz");
  fs.mkdirSync(folder);
  for (const value of [undefined, "relative.pz", path.join(root, "missing.pz"), empty, folder, file + ".txt"]) {
    assert.equal(validateProjectPath(value), null, String(value));
  }
});

test("validation rejects oversized files before reading any bytes", () => {
  let reads = 0;
  const fsApi = { statSync() { reads += 1; return { isFile: () => true, size: MAX_PROJECT_BYTES + 1 }; } };
  assert.equal(validateProjectPath("/project.pz", { fsApi }), null);
  assert.equal(reads, 1);
  fsApi.statSync = () => ({ isFile: () => true, size: MAX_PROJECT_BYTES });
  assert.ok(validateProjectPath("/project.pz", { fsApi }));
});

test("startup argv and pre-ready macOS events wait for the project loader", (t) => {
  const { file } = fixture(t);
  const run = harness(["/electron", "/application", file], true);
  run.open(file);
  assert.equal(run.window(), null);
  run.controller.applicationReady();
  const window = run.attach();
  assert.equal(window.messages.length, 0, "a BrowserWindow or loaded DOM alone is insufficient");
  run.ready();
  assert.equal(window.messages.length, 1);
  assert.equal(window.messages[0].channel, FILE_CHANNEL);
  assert.equal(window.messages[0].message.name, "Saved project.PZ");
  assert.equal(window.minimized, false);
  assert.ok(window.focusCalls);
  assert.equal("filename" in window.messages[0].message, false);
  run.done(window.messages[0].message.id);
  assert.equal(window.messages.length, 2, "the queued macOS event follows the completed first open");
});

test("second instance queues several files and acknowledges each completed import", (t) => {
  const { file } = fixture(t);
  const run = harness();
  const window = run.attach();
  run.app.emit("second-instance", {}, ["/zoidium", "relative.pz", file, file]);
  assert.equal(window.messages.length, 0);
  run.ready();
  run.done("wrong-token");
  run.ready();
  assert.equal(window.messages.length, 1, "readiness cannot duplicate an active import");
  run.done(window.messages[0].message.id);
  assert.equal(window.messages.length, 2);
  assert.notEqual(window.messages[0].message.id, window.messages[1].message.id);
});

test("IPC messages from another renderer, a subframe or an external page are ignored", (t) => {
  const { file } = fixture(t);
  const run = harness(["/zoidium", file]);
  const window = run.attach();
  run.ipcMain.emit(READY_CHANNEL, { ...run.event(), sender: {} });
  run.ipcMain.emit(READY_CHANNEL, { ...run.event(), senderFrame: { url: "http://127.0.0.1:8471/" } });
  window.webContents.mainFrame.url = "https://example.com/";
  run.ready();
  assert.equal(window.messages.length, 0);
  window.webContents.mainFrame.url = "http://127.0.0.1:8471/";
  run.ready();
  run.open(file);
  run.ipcMain.emit(DONE_CHANNEL, { ...run.event(), sender: {} }, window.messages[0].message.id);
  assert.equal(window.messages.length, 1);
});

test("reload or crash revokes the active URL and waits for a new ready signal", (t) => {
  const { file } = fixture(t);
  for (const event of ["navigation", "render-process-gone"]) {
    const run = harness(["/zoidium", file]);
    const window = run.attach();
    run.ready();
    const oldId = window.messages[0].message.id;
    if (event === "navigation") window.webContents.emit("did-start-navigation", {}, "/", false, true);
    else window.webContents.emit(event);
    run.open(file);
    run.done(oldId);
    assert.equal(window.messages.length, 1);
    run.ready();
    assert.equal(window.messages.length, 2);
    assert.notEqual(oldId, window.messages[1].message.id);
  }
});

test("subframe and same-document navigation do not interrupt a pending open", (t) => {
  const { file } = fixture(t);
  const run = harness(["/zoidium", file]);
  const window = run.attach();
  run.ready();
  window.webContents.emit("did-start-navigation", {}, "/frame", false, false);
  window.webContents.emit("did-start-navigation", {}, "/#anchor", true, true);
  run.open(file);
  run.done(window.messages[0].message.id);
  assert.equal(window.messages.length, 2);
});

test("macOS file opens recreate a closed window once and retain their queue", async (t) => {
  const { file } = fixture(t);
  const run = harness();
  run.controller.applicationReady();
  run.attach();
  run.close();
  run.open(file);
  run.open(file);
  await settle();
  assert.equal(run.created(), 1);
  assert.equal(run.window().messages.length, 0);
  run.ready();
  assert.equal(run.window().messages.length, 1);
});

test("invalid OS requests cannot create windows or reach the renderer", async () => {
  const run = harness();
  run.controller.applicationReady();
  run.open("relative.pz");
  run.app.emit("second-instance", {}, ["/zoidium", "/absent.pz", "--inspect"]);
  await settle();
  assert.equal(run.created(), 0);
});

test("only the active random URL streams the authorized project and expires on completion", async (t) => {
  const { file } = fixture(t);
  const run = harness(["/zoidium", file]);
  run.attach();
  run.ready();
  const { id, url } = run.window().messages[0].message;
  const server = http.createServer((request, response) => {
    run.controller.serveRequest(request, response).then((handled) => {
      if (!handled) { response.writeHead(404); response.end(); }
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (route, options) => fetch(origin + route, options);
  assert.equal((await get(url + "-wrong")).status, 404);
  assert.equal((await get(url, { method: "POST" })).status, 405);
  const response = await get(url);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "project bytes");
  assert.equal((await get(url, { method: "HEAD" })).headers.get("content-length"), "13");
  fs.rmSync(file);
  assert.equal((await get(url)).status, 404, "removed files are rechecked when requested");
  run.done(id);
  assert.equal((await get(url)).status, 404);
});

test("electron-builder validates the .pz association without packaging, fetching or signing", async () => {
  const builderRoot = path.dirname(require.resolve("electron-builder/package.json"));
  const libRoot = path.dirname(require.resolve("app-builder-lib/package.json", { paths: [builderRoot] }));
  const { validateConfiguration } = require(path.join(libRoot, "out/util/config/config.js"));
  const { build } = require("../package.json");
  await validateConfiguration(build, { add() {} });
  assert.deepEqual(build.fileAssociations, [{ ext: "pz", name: "Zoidium Project", role: "Editor", mimeType: "application/x-zoidium-project" }]);
  for (const platform of ["mac", "win", "linux"]) assert.ok(build[platform].target.length);
  assert.equal(build.mac.identity, undefined);
});


test("an activation that already reopened the editor prevents a duplicate window", async (t) => {
  const { file } = fixture(t);
  const run = harness();
  run.controller.applicationReady();
  run.open(file);
  run.attach();
  await settle();
  assert.equal(run.created(), 0);
  run.ready();
  assert.equal(run.window().messages.length, 1);
});
