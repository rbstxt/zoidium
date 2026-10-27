"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const { createRunnerHost } = require("../desktop/community-runner.cjs");
const V = require("../zoidium/community-protocol");
const manifest = require("../examples/community-filter/manifest.json");
class Port extends EventEmitter {
  sent = []; closed = false;
  postMessage(value) { this.sent.push(structuredClone(value)); }
  start() {}
  close() { if (!this.closed) { this.closed = true; this.emit("close"); } }
  receive(data, ports = []) { this.emit("message", { data, ports }); }
}
async function fixture(t, authorized = async () => true) {
  let channel;
  class Channel { constructor() { this.port1 = new Port(); this.port2 = new Port(); channel = this; } }
  class Window extends EventEmitter {
    destroyed = false;
    constructor(options) {
      super(); this.options = options; this.webContents = new EventEmitter();
      this.webContents.id = 42; this.webContents.setWindowOpenHandler = () => {}; this.webContents.postMessage = () => {};
    }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit("closed"); }
    loadURL() { return Promise.resolve(); }
  }
  const session = new EventEmitter(); session.webRequest = { onBeforeRequest() {} }; session.closeAllConnections = async () => {};
  for (const name of ["setPermissionRequestHandler", "setPermissionCheckHandler", "setDevicePermissionHandler", "setDisplayMediaRequestHandler"]) session[name] = () => {};
  const editor = new Port(), binding = { packageId: manifest.id, packageHash: "sha256-" + "A".repeat(43) + "=", runnerGeneration: 1 };
  const routes = new Map();
  const host = createRunnerHost({ electron: { BrowserWindow: Window, MessageChannelMain: Channel, session: { fromPartition: () => session } },
    origin: "http://127.0.0.1:12345", config: { binding, bundle: { manifest } }, editorPort: editor, authorized,
    route: (url, doc) => doc ? routes.set(url, doc) : routes.delete(url) });
  t.after(() => host.close()); await host.ready;
  const worker = channel.port1; worker.receive({ connected: true }); worker.receive({ booted: true });
  const message = { protocolVersion: 1, interpreterVersion: V.INTERPRETER, ...binding, instanceId: "instance", instanceGeneration: 1,
    projectGeneration: 1, revision: 1, requestId: "request", frameKey: "frame", operation: "initialize", payload: {} };
  return { host, editor, worker, message, routes };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
test("main port broker validates requests and exact replies before forwarding", async t => {
  const f = await fixture(t); f.editor.receive(f.message); await flush();
  assert.deepEqual(f.worker.sent.at(-1), f.message);
  f.worker.receive({ ...f.message, operation: "ready" }); assert.equal(f.editor.sent.at(-1).operation, "ready");
  f.editor.receive(f.message); await flush(); assert.match(f.editor.sent.at(-1).fatal, /limit/); assert.equal(f.routes.size, 0);
});
test("main port broker refuses replies with a foreign revision", async t => {
  const f = await fixture(t); f.editor.receive(f.message); await flush();
  f.worker.receive({ ...f.message, revision: 2, operation: "ready" });
  assert.match(f.editor.sent.at(-1).fatal, /stale or foreign/); assert.equal(f.host.window.isDestroyed(), true);
});
test("main port broker refuses transferred handles and closes them", async t => {
  for (const side of ["editor", "worker"]) {
    const f = await fixture(t), handle = new Port(); f[side].receive(f.message, [handle]); await flush();
    assert.equal(handle.closed, true); assert.equal(f.host.window.isDestroyed(), true);
    assert.match(f.editor.sent.at(-1).fatal, /handles/);
  }
});
test("authorization changes cannot forward requests, and concurrent messages fail closed", async t => {
  const denied = await fixture(t, async () => false); denied.editor.receive(denied.message); await flush();
  assert.match(denied.editor.sent.at(-1).fatal, /authorization/);
  const concurrent = await fixture(t, () => new Promise(() => {}));
  concurrent.editor.receive(concurrent.message); concurrent.editor.receive({ ...concurrent.message, requestId: "other" }); await flush();
  assert.match(concurrent.editor.sent.at(-1).fatal, /Concurrent/);
});
test("runner watchdog terminates a missing reply and clears its serving route", async t => {
  const f = await fixture(t); f.editor.receive(f.message);
  await new Promise(resolve => f.editor.once("close", resolve));
  assert.match(f.editor.sent.at(-1).fatal, /watchdog/); assert.equal(f.routes.size, 0); assert.equal(f.worker.closed, true);
});
