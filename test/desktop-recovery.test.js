"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const EventEmitter = require("node:events");
const test = require("node:test");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../desktop/main.cjs"), "utf8");
function recovery() {
  const window = new EventEmitter();
  window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  window.webContents = new EventEmitter();
  const calls = [];
  const intervals = new Map();
  const timeouts = new Map();
  let timerId = 0;
  window.webContents.isLoading = () => false;
  window.webContents.executeJavaScript = () => Promise.resolve(true);
  window.destroy = () => { window.destroyed = true; window.emit("closed"); };
  window.webContents.reload = () => calls.push("reload");
  window.webContents.forcefullyCrashRenderer = () => {
    calls.push("stop");
    window.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  };
  let resolve;
  const context = {
    quitting: false, quitRequested: false, logMain() {}, errorDetails: () => ({}),
    setInterval(callback) { const id = ++timerId; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
    setTimeout(callback) { const id = ++timerId; timeouts.set(id, callback); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    app: { quit: () => calls.push("quit") },
    dialog: { showMessageBox(parent, options) {
      assert.equal(parent, window);
      calls.push(options);
      return new Promise((done) => { resolve = done; });
    } },
  };
  const install = vm.runInNewContext(source.slice(source.indexOf("function installRendererRecovery("), source.indexOf("function readWindowState(")) + "\ninstallRendererRecovery", context);
  const api = install(window);
  return { window, calls, api, context, intervals, timeouts, tick() { for (const callback of intervals.values()) callback(); }, expire() { for (const callback of [...timeouts.values()]) callback(); }, answer(response) { resolve({ response }); } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
test("crashed renderer offers Reload and Wait, and reloads on request", async () => {
  const run = recovery();
  run.window.webContents.emit("render-process-gone", {}, { reason: "crashed" });
  assert.deepEqual(Array.from(run.calls[0].buttons), ["Reload", "Wait"]);
  assert.match(run.calls[0].detail, /unsaved changes/);
  run.answer(0);
  await settle();
  assert.equal(run.calls.at(-1), "reload");
});
test("unresponsive events share a prompt and stop the renderer before reloading", async () => {
  const run = recovery();
  run.window.emit("unresponsive");
  run.window.emit("unresponsive");
  assert.equal(run.calls.length, 1);
  run.answer(0);
  await settle();
  assert.deepEqual(run.calls.slice(1), ["stop", "reload"]);
});

test("an asynchronous crash event during recovery does not open another dialog", async () => {
  const run = recovery();
  run.window.webContents.forcefullyCrashRenderer = () => {
    run.calls.push("stop");
    setImmediate(() => run.window.webContents.emit("render-process-gone", {}, { reason: "crashed" }));
  };
  run.window.webContents.emit("unresponsive");
  run.window.emit("unresponsive");
  run.answer(0);
  await settle();
  await settle();
  assert.deepEqual(run.calls.slice(1), ["stop", "reload"]);
});
test("Wait, recovery, navigation and closing suppress stale reload requests", async () => {
  for (const action of ["wait", "responsive", "navigation", "closed"]) {
    const run = recovery();
    run.window.emit("unresponsive");
    if (action === "responsive") run.window.emit("responsive");
    if (action === "navigation") run.window.webContents.emit("did-start-loading");
    if (action === "closed") { run.window.destroyed = true; run.window.emit("closed"); }
    run.answer(action === "wait" ? 1 : 0);
    await settle();
    assert.equal(run.calls.length, 1, action);
  }
});
test("window state keeps usable bounds and discards unreachable coordinates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "zoidium-state-"));
  try {
    const read = vm.runInNewContext(source.slice(source.indexOf("function readWindowState("), source.indexOf("function saveWindowState(")) + "\nreadWindowState", {
      fs, path, app: { getPath: () => root }, screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
    });
    const write = (bounds) => fs.writeFileSync(path.join(root, "window-state.json"), JSON.stringify({ bounds, maximized: true }));
    write({ x: 10, y: 20, width: 1200, height: 800 });
    assert.equal(read().bounds.x, 10);
    assert.equal(read().maximized, true);
    write({ x: -10000, y: 20, width: 1200, height: 800 });
    assert.equal(read().bounds.x, undefined);
    assert.equal(read().bounds.width, 1200);
    write({ x: 0, y: 0, width: -1, height: 800 });
    assert.equal(read(), null);
    fs.writeFileSync(path.join(root, "window-state.json"), "broken");
    assert.equal(read(), null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
test("repeated renderer console errors do not cause a disk write per frame", () => {
  let now = 0;
  const calls = [];
  const logger = vm.runInNewContext(source.slice(source.indexOf("function createRendererConsoleLogger("), source.indexOf("async function createWindow(")) + "\ncreateRendererConsoleLogger()", {
    Date: { now: () => now }, logMain: (...args) => calls.push(args),
  });
  for (let i = 0; i < 600; i += 1) logger({}, 3, "Render error", 10, "fixture.js");
  assert.equal(calls.length, 1);
  now = 10001;
  logger({}, 3, "Render error", 10, "fixture.js");
  assert.equal(calls.length, 2);
  assert.equal(calls[1][2].suppressedRepetitions, 599);
});
test("heartbeat detects a busy renderer without native unresponsive events", async () => {
  const run = recovery();
  let requests = 0;
  run.window.webContents.executeJavaScript = () => { requests += 1; return new Promise(() => {}); };
  run.window.webContents.emit("did-finish-load");
  run.window.webContents.emit("did-finish-load");
  assert.equal(run.intervals.size, 1);
  run.tick();
  run.tick();
  assert.equal(requests, 1);
  run.expire();
  assert.equal(run.api.isUnresponsive(), true);
  assert.equal(run.calls[0].title, "Editor is not responding");
  run.answer(0);
  await settle();
  assert.deepEqual(run.calls.slice(1), ["stop", "reload"]);
  run.window.emit("closed");
  assert.equal(run.intervals.size, 0);
  assert.equal(run.timeouts.size, 0);
});
test("late heartbeat replies cannot cancel recovery for a different document", async () => {
  const run = recovery();
  let resolve;
  run.window.webContents.executeJavaScript = () => new Promise((done) => { resolve = done; });
  run.window.webContents.emit("did-finish-load");
  run.tick();
  run.window.webContents.emit("did-start-loading");
  assert.equal(run.timeouts.size, 0);
  run.window.emit("unresponsive");
  resolve(true);
  await settle();
  assert.equal(run.api.isUnresponsive(), true);
  run.answer(1);
  await settle();
  run.window.emit("closed");
});
test("quit from a hung renderer lets the user close forcibly or keep working", async () => {
  for (const response of [0, 1]) {
    const run = recovery();
    run.context.quitRequested = true;
    run.api.requestQuit();
    assert.equal(run.calls[0].buttons[0], "Close");
    run.answer(response);
    await settle();
    assert.equal(run.window.destroyed, response === 0);
    if (response === 1) assert.equal(run.context.quitRequested, false);
  }
});
test("heartbeat keeps detecting hangs while quit is waiting for beforeunload", async () => {
  const run = recovery();
  run.window.webContents.executeJavaScript = () => new Promise(() => {});
  run.window.webContents.emit("did-finish-load");
  run.context.quitRequested = true;
  run.tick();
  run.expire();
  assert.equal(run.calls[0].buttons[0], "Close");
  run.answer(0);
  await settle();
  assert.equal(run.window.destroyed, true);
  assert.equal(run.timeouts.size, 0);
});
