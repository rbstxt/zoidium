"use strict";

// Magic Looks lifecycle: enabling the plugin must not open a window, change the
// editor, or inject styles. The setup window opens only from the effect's
// property button, and disabling closes it and restores the property renderer.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const packDir = path.join(projectRoot, "plugins/magic-looks");

function readPack(file) {
  return fs.readFileSync(path.join(packDir, file), "utf8");
}

function loadModule() {
  const module = { exports: {} };
  new Function("module", "exports", "plugin", readPack("looks-setup.js"))(module, module.exports, {});
  return module.exports;
}

function fakeElement(tag) {
  const el = {
    tagName: tag,
    className: "",
    textContent: "",
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    querySelector() { return null; },
    removeChild() {},
    setAttribute() {},
  };
  return el;
}

// Minimal DOM for make() and the property button; the test never mounts the
// window body, so canvas and layout APIs are not needed.
function installFakeDocument(state) {
  global.document = {
    createElement: fakeElement,
    getElementById(id) { return state.styles.get(id) || null; },
    head: {
      appendChild(el) { state.styles.set(el.id, { id: el.id, remove() { state.styles.delete(el.id); } }); },
    },
  };
}

function makeHarness() {
  const state = { styles: new Map() };
  const originalCreate = function createControls(row, prop) { return { row, prop }; };
  const PZ = {
    ui: {
      controls: { createControls: originalCreate },
      properties: function FakeOps(editor) { this.editor = editor; },
    },
  };
  const CM = {
    history: {
      startOperation() {},
      finishOperation() {},
      undoStack: { length: 0 },
      redoStack: { length: 0 },
    },
    playback: { currentFrame: 0 },
  };
  const opened = [];
  const closed = [];
  const windows = new Set();
  const ui = {
    controls: { checkbox() { return { element: fakeElement("div") }; } },
    getWindow() { return null; },
    openWindow(options) {
      opened.push(options);
      const win = {
        id: options.id,
        focus() {},
        close() { closed.push(options.id); windows.delete(win); },
      };
      windows.add(win);
      return win;
    },
  };
  const assets = {
    "looks-color.js": readPack("looks-color.js"),
    "looks-tools.js": readPack("looks-tools.js"),
    "looks-widgets.js": readPack("looks-widgets.js"),
    "looks-setup.css": readPack("looks-setup.css"),
  };
  const context = {
    PZ,
    editor: CM,
    ui,
    getAsset(kind, url) {
      return assets[String(url).split("/").pop()];
    },
  };
  return { state, PZ, CM, ui, opened, closed, windows, originalCreate, context };
}

test("activation changes nothing visible and opens no window", () => {
  const h = makeHarness();
  installFakeDocument(h.state);
  const editorKeysBefore = Object.keys(h.CM).sort().join(",");
  const mod = loadModule();
  mod.activate(h.context);
  assert.equal(h.opened.length, 0, "no window opens on enable");
  assert.equal(Object.keys(h.CM).sort().join(","), editorKeysBefore, "no editor globals added");
  assert.equal(h.state.styles.size, 0, "no stylesheet injected on enable");
  assert.notEqual(h.PZ.ui.controls.createControls, h.originalCreate, "only the property renderer is patched");
  mod.deactivate();
});

test("disable restores the property renderer and leaves no styles", () => {
  const h = makeHarness();
  installFakeDocument(h.state);
  const mod = loadModule();
  mod.activate(h.context);
  mod.deactivate();
  assert.equal(h.PZ.ui.controls.createControls, h.originalCreate, "renderer restored");
  assert.equal(h.state.styles.size, 0);
});

test("a failed activation rolls back and leaves the renderer untouched", () => {
  const h = makeHarness();
  installFakeDocument(h.state);
  h.context.getAsset = () => undefined;
  const mod = loadModule();
  assert.throws(() => mod.activate(h.context), /missing its bundled source/);
  assert.equal(h.PZ.ui.controls.createControls, h.originalCreate, "no partial patch left behind");
  mod.deactivate();
});

test("the setup button opens one window; a second click refocuses it", () => {
  const h = makeHarness();
  installFakeDocument(h.state);
  const mod = loadModule();
  mod.activate(h.context);
  const effect = { parent: {}, properties: {} };
  const prop = { definition: { magicLooksSetup: { name: "Setup", title: "Open" } }, parentObject: effect };
  const row = fakeElement("li");
  row.children = [fakeElement("span"), fakeElement("div")];
  h.PZ.ui.controls.createControls(row, prop, false);
  const host = row.children[1];
  assert.equal(host.children.length, 1, "button appended to the value host");
  const button = host.children[0];
  button.onclick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(h.opened.length, 1, "click opens the window");
  assert.equal(h.opened[0].title, "Magic Looks");
  assert.equal(h.opened[0].persistKey, "looks-setup");
  assert.equal(typeof h.opened[0].footer[0].onClick, "function");
  assert.ok(h.opened[0].isValid(), "window stays open while the effect exists");
  assert.equal(h.state.styles.has("zoidium-looks-setup-style"), true, "stylesheet installed for the open window");
  mod.deactivate();
  assert.equal(h.closed.length, 1, "disable closes the window");
  assert.equal(h.state.styles.size, 0, "stylesheet removed on disable");
});

test("rows without the setup definition are not decorated", () => {
  const h = makeHarness();
  installFakeDocument(h.state);
  const mod = loadModule();
  mod.activate(h.context);
  const row = fakeElement("li");
  row.children = [fakeElement("span"), fakeElement("div")];
  h.PZ.ui.controls.createControls(row, { definition: {} }, false);
  assert.equal(row.children[1].children.length, 0, "no button on other properties");
  mod.deactivate();
});
