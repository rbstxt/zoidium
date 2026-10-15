"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

function observable() {
  const callbacks = new Set();
  return { watch: (fn) => callbacks.add(fn), unwatch: (fn) => callbacks.delete(fn),
    update: () => Array.from(callbacks).forEach((fn) => fn()), callbacks };
}
function fixture() {
  const cleanup = [], events = [];
  class Editor {
    constructor() { this.windows = []; this.onProjectChanged = observable(); }
    createWindow(options) {
      const editor = this, listeners = new Map();
      const popup = { closed: false, screen: { availWidth: 800, availHeight: 600 },
        outerWidth: 1000, outerHeight: 900, screenX: 2000, screenY: -100,
        focus: () => events.push("focus"), resizeTo: (...args) => events.push(["size", ...args]),
        moveTo: (...args) => events.push(["move", ...args]),
        addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
        removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
        close() {
          this.closed = true;
          // Native unload callbacks need the handle and panel until unload.
          handle.panel.enabled = false;
          const index = editor.windows.indexOf(handle);
          if (index >= 0) editor.windows.splice(index, 1);
          for (const fn of Array.from(listeners.get("unload") || [])) fn();
        } };
      const handle = { options, secondary: true, window: popup, panel: null,
        setPanel(panel) { this.panel = panel; }, resize: () => events.push("resize") };
      this.windows.push(handle);
      return handle;
    }
    closeAllWindows() { for (const win of this.windows.slice()) win.window.close(); }
  }
  const originals = { create: Editor.prototype.createWindow, close: Editor.prototype.closeAllWindows };
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../plugins/core/single-graph-window.js"), "utf8"), sandbox);
  sandbox.module.exports.activate({ PZ: { ui: { editor: Editor } }, lifecycle: { onDispose: (fn) => cleanup.push(fn) } });
  return { Editor, events, originals, dispose: () => cleanup.forEach((fn) => fn()) };
}
function panel() {
  const result = { enabled: true, objects: {}, removed: false, rowsUnloaded: false,
    list: {}, unloadListItem() {}, objectsChanged() { this.rowsUnloaded = this.objects === null; },
    el: { remove() { result.removed = true; } } };
  return result;
}

test("ten native requests reuse one window, preserve its panel, and unload discarded panels", () => {
  const { Editor, events, dispose } = fixture();
  const editor = new Editor(), first = editor.createWindow({ title: "Graph editor" }), live = panel();
  first.setPanel(live);
  for (let index = 0; index < 9; index += 1) {
    const next = editor.createWindow({ title: "Graph editor" }), unused = panel();
    assert.equal(next, first);
    next.setPanel(unused);
    assert.equal(next.panel, live);
    assert.equal(unused.enabled, false);
    assert.equal(unused.rowsUnloaded, true);
    assert.equal(unused.removed, true);
  }
  assert.equal(editor.windows.length, 1);
  assert.deepEqual(events.slice(0, 4), [["size", 800, 600], ["move", 0, 0], "focus", "resize"]);
  first.window.close();
  assert.equal(editor.windows.length, 0);
  assert.equal(live.rowsUnloaded, true);
  assert.equal(editor.onProjectChanged.callbacks.size, 0);
  const reopened = editor.createWindow({ title: "Graph editor" });
  assert.notEqual(reopened, first);
  reopened.setPanel(panel());
  dispose();
});

test("editors have independent graphs; project replacement and closeAllWindows forget each handle", () => {
  const { Editor, dispose } = fixture();
  const a = new Editor(), b = new Editor();
  const first = a.createWindow({ title: "Graph editor" }), other = b.createWindow({ title: "Graph editor" });
  first.setPanel(panel()); other.setPanel(panel());
  a.onProjectChanged.update();
  assert.equal(first.window.closed, true);
  assert.equal(other.window.closed, false);
  const next = a.createWindow({ title: "Graph editor" }); next.setPanel(panel());
  assert.notEqual(next, first);
  a.closeAllWindows();
  assert.equal(next.window.closed, true);
  assert.equal(a.onProjectChanged.callbacks.size, 0);
  assert.equal(b.createWindow({ title: "Graph editor" }), other);
  dispose();
});

test("other window types and an editor-owned graph factory keep their behavior; disposal restores owned patches", () => {
  const { Editor, originals, dispose } = fixture();
  const editor = new Editor();
  for (let index = 0; index < 3; index += 1) editor.createWindow({ title: "Other" }).setPanel(panel());
  assert.equal(editor.windows.length, 3);
  const foreign = () => ({ host: {}, marker: true });
  editor.createWindow = foreign;
  assert.equal(editor.createWindow({ title: "Graph editor" }).marker, true);
  dispose();
  assert.equal(Editor.prototype.createWindow, originals.create);
  assert.equal(Editor.prototype.closeAllWindows, originals.close);
  assert.equal(editor.createWindow, foreign);
  assert.equal(editor.windows.length, 3);
});

test("disposal releases a live graph and its project listener without replacing a newer prototype patch", () => {
  const { Editor, dispose } = fixture();
  const editor = new Editor(), win = editor.createWindow({ title: "Graph editor" }), live = panel();
  win.setPanel(live);
  const foreign = () => {};
  Editor.prototype.createWindow = foreign;
  dispose();
  assert.equal(win.window.closed, true);
  assert.equal(live.rowsUnloaded, true);
  assert.equal(editor.onProjectChanged.callbacks.size, 0);
  assert.equal(Editor.prototype.createWindow, foreign);
});

test("a graph plugin can replace the native panel class inside an open popup", () => {
  const { Editor, dispose } = fixture();
  const editor = new Editor(), win = editor.createWindow({ title: "Graph editor" });
  const native = panel(); win.setPanel(native);
  const upgraded = panel(); upgraded.constructor = function UpgradedGraph() {};
  win.setPanel(upgraded);
  assert.equal(win.panel, upgraded);
  assert.equal(upgraded.removed, false);
  const unused = panel(); unused.constructor = upgraded.constructor;
  win.setPanel(unused);
  assert.equal(win.panel, upgraded);
  assert.equal(unused.rowsUnloaded, true);
  dispose();
});

test("a zero-sized native popup recovers usable dimensions within the available screen", () => {
  const { Editor, events, dispose } = fixture();
  const editor = new Editor(), win = editor.createWindow({ title: "Graph editor" });
  win.setPanel(panel());
  win.window.outerWidth = 0; win.window.outerHeight = 0;
  editor.createWindow({ title: "Graph editor" });
  assert.deepEqual(events[0], ["size", 600, 400]);
  dispose();
});
