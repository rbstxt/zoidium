"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const EventEmitter = require("node:events");
const { createCommunityBroker } = require("../desktop/community-broker.cjs");
async function fixture(t, enabled = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zoidium-community-broker-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ipcMain = new EventEmitter(); const handlers = {};
  ipcMain.handle = (name, handler) => { handlers[name] = handler; };
  const contents = { isDestroyed: () => false, mainFrame: { url: "http://127.0.0.1:23456/" }, executeJavaScript: async () => enabled };
  const broker = createCommunityBroker({ electron: { ipcMain }, userData: root,
    getWindow: () => ({ webContents: contents }), getOrigin: () => "http://127.0.0.1:23456" });
  t.after(() => broker.close());
  const event = { sender: contents, senderFrame: contents.mainFrame, ports: [] };
  return { root, broker, ipcMain, handlers, event, contents };
}
test("preview off and forged sender or child-frame IPC cannot create storage", async t => {
  const f = await fixture(t, false), handle = f.handlers["zoidium:community-store"];
  await assert.rejects(handle(f.event, { operation: "load" }), /disabled/);
  await assert.rejects(handle({ ...f.event, sender: {} }, { operation: "load" }), /main frame/);
  await assert.rejects(handle({ ...f.event, senderFrame: { url: f.event.senderFrame.url } }, { operation: "load" }), /main frame/);
  assert.deepEqual(await fs.readdir(f.root), []);
});
test("IPC rejects navigation during preview authorization and foreign editor routes", async t => {
  const f = await fixture(t), handle = f.handlers["zoidium:community-store"];
  f.contents.executeJavaScript = async () => { f.contents.mainFrame = { url: "http://127.0.0.1:23456/" }; return true; };
  await assert.rejects(handle(f.event, { operation: "load" }), /disabled/);
  f.event.senderFrame = f.contents.mainFrame; f.contents.mainFrame.url = "http://127.0.0.1:23456/other.html";
  await assert.rejects(handle(f.event, { operation: "load" }), /main frame/);
  assert.deepEqual(await fs.readdir(f.root), []);
});
test("storage broker accepts no path, URL, extra fields, or generic file operation", async t => {
  const f = await fixture(t), handle = f.handlers["zoidium:community-store"];
  for (const request of [{ operation: "load", path: "../secret" }, { operation: "fetch", url: "https://example.invalid" },
    { operation: "commit", revision: 0, next: {} }, { operation: "readFile", revision: 0, next: {} }]) {
    await assert.rejects(handle(f.event, request));
  }
  assert.deepEqual(await fs.readdir(f.root), []);
});
test("runner broker closes forged ports and rejects unapproved configuration", async t => {
  const f = await fixture(t);
  function port() {
    const p = { closed: false, messages: [], close() { this.closed = true; }, postMessage(data) { this.messages.push(data); } }; return p;
  }
  const first = port(), second = port();
  f.ipcMain.emit("zoidium:community-connect", { ...f.event, ports: [first, second] }, {});
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(first.closed, true); assert.equal(second.closed, true); assert.match(first.messages[0].fatal, /Exactly one/);
  const third = port(); f.ipcMain.emit("zoidium:community-connect", { ...f.event, ports: [third] }, { bytes: "file:///tmp/package", approvedHash: "invalid", runnerGeneration: 1 });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(third.closed, true); assert.match(third.messages[0].fatal, /Invalid/);
  assert.deepEqual(await fs.readdir(f.root), []);
});
