"use strict";

// Magic Looks lifecycle: enabling the plugin must not open a window, change the
// editor, or inject styles. The setup window opens only from the shared
// registerEditor entry, and disabling closes it and removes that entry.

require("./migrate-test-apis.js").ensureMainRealmApis();
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
  const editors = [];
  const ui = {
    controls: { checkbox() { return { element: fakeElement("div") }; } },
    getWindow() { return null; },
    registerEditor(spec) {
      editors.push(spec);
      return () => {
        const index = editors.indexOf(spec);
        if (index >= 0) editors.splice(index, 1);
      };
    },
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
  return { state, PZ, CM, ui, opened, closed, windows, editors, originalCreate, context };
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
  assert.equal(h.editors.length, 1, "one shared editor entry");
  assert.equal(h.editors[0].title, "Magic Looks Setup");
  assert.equal(h.editors[0].label, undefined, "the shared button reads Open Magic Looks Setup");
  assert.equal(h.PZ.ui.controls.createControls, h.originalCreate, "no property renderer is patched");
  mod.deactivate();
});

test("disable closes the window and removes the editor entry and styles", () => {
  const h = makeHarness();
  installFakeDocument(h.state);
  const mod = loadModule();
  mod.activate(h.context);
  mod.deactivate();
  assert.equal(h.PZ.ui.controls.createControls, h.originalCreate, "renderer untouched");
  assert.equal(h.editors.length, 0, "editor entry removed");
  assert.equal(h.state.styles.size, 0);
});

test("a failed activation rolls back and leaves no editor entry", () => {
  const h = makeHarness();
  installFakeDocument(h.state);
  h.context.getAsset = () => undefined;
  const mod = loadModule();
  assert.throws(() => mod.activate(h.context), /missing its bundled source/);
  assert.equal(h.editors.length, 0, "no partial registration left behind");
  mod.deactivate();
});

test("the editor entry opens the setup window", () => {
  const h = makeHarness();
  installFakeDocument(h.state);
  const mod = loadModule();
  mod.activate(h.context);
  const effect = { type: "looks", parent: {}, properties: {} };
  const spec = h.editors[0];
  assert.equal(spec.match(effect), true, "the looks effect matches");
  spec.open(effect);
  assert.equal(h.opened.length, 1, "open shows the window");
  assert.equal(h.opened[0].title, "Magic Looks Setup");
  assert.equal(h.opened[0].persistKey, "looks-setup");
  assert.equal(typeof h.opened[0].footer[0].onClick, "function");
  assert.ok(h.opened[0].isValid(), "window stays open while the effect exists");
  assert.equal(h.state.styles.has("zoidium-looks-setup-style"), true, "stylesheet installed for the open window");
  mod.deactivate();
  assert.equal(h.closed.length, 1, "disable closes the window");
  assert.equal(h.state.styles.size, 0, "stylesheet removed on disable");
});

test("effects of another type do not match the editor", () => {
  const h = makeHarness();
  installFakeDocument(h.state);
  const mod = loadModule();
  mod.activate(h.context);
  const spec = h.editors[0];
  assert.equal(spec.match({ type: "vhs", properties: {} }), false, "no entry on other effects");
  assert.equal(spec.match(null), false);
  mod.deactivate();
});
