"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

function load() {
  const cleared = [], errors = [];
  const sandbox = { module: { exports: {} }, clearTimeout: (id) => cleared.push(id),
    console: { error: (...args) => errors.push(args) }, PZ: {} };
  vm.createContext(sandbox);
  for (const file of ["zoidium/plugin-apis.js", "plugins/graph-plus/graph-plus.js"]) {
    vm.runInContext(fs.readFileSync(path.join(root, file), "utf8"), sandbox);
  }
  const api = sandbox.module.exports.__test;
  api.loadDependencies({ apis: sandbox.ZoidiumPluginApis,
    getAsset: (_kind, file) => fs.readFileSync(path.join(root, file), "utf8") });
  const PZ = { ui: { panel: function () {}, splitPanel: function () {} } };
  return { api, proto: api.gpDefineGraphEditor(PZ).graph.prototype, cleared, errors };
}

test("rebuilding disposes the old graph observer, listeners, popup, timers and active drag", () => {
  const { api, proto, cleared } = load();
  const removed = [], calls = [];
  const owner = { removeEventListener: (type) => removed.push(type) };
  const child = Object.create(proto);
  Object.assign(child, {
    el: { remove: () => calls.push("child removed") }, objects: {},
    _ro: { disconnect: () => calls.push("observer disconnected") },
    _spaceWin: owner, _spaceHandlers: { down() {}, up() {}, blur() {} },
    easePopup: { _openTO: 41, remove: () => calls.push("popup removed") },
    _easeWin: owner, _easeOutside() {}, _win: () => owner, _tipTO: 42,
  });
  function Old() {}
  function Next() { this._left = { selection: [] }; }
  const old = Object.assign(new Old(), { enabled: true, objects: { marker: "keep" },
    panels: [{ selection: ["curve"], el: { remove() {} } }, child],
    el: { remove: () => calls.push("old removed") } });
  const win = { panel: old, setPanel(next) { this.panel = next; calls.push("installed"); } };
  old.drag = { dragging: true, endfn_bound: () => calls.push("drag ended") };
  old.el.ownerDocument = {};
  assert.equal(api.rebuildOpenPanels([win], Old, Next), 1);
  assert.deepEqual(calls, ["installed", "drag ended", "popup removed", "observer disconnected", "child removed", "old removed"]);
  assert.deepEqual(removed, ["pointerdown", "keydown", "keyup", "blur"]);
  assert.deepEqual(cleared, [41, 42]);
  assert.equal(child._ro, null);
  assert.equal(child._spaceHandlers, null);
  assert.equal(child.easePopup, null);
  assert.equal(old.objects, null);
  assert.equal(win.panel.objects.marker, "keep");
  assert.equal(win.panel._left.selection[0], "curve");
});

test("failed replacements retain the old panel; disposal errors do not undo successful replacements", () => {
  const { api, errors } = load();
  function Old() {}
  function Next() {}
  const old = Object.assign(new Old(), { unload: () => { throw new Error("cleanup failed"); } });
  const win = { panel: old, setPanel(next) { this.panel = next; } };
  assert.equal(api.rebuildOpenPanels([win], Old, function () { throw new Error("construction failed"); }), 0);
  assert.equal(win.panel, old);
  win.setPanel = () => { throw new Error("mount failed"); };
  assert.equal(api.rebuildOpenPanels([win], Old, Next), 0);
  assert.equal(win.panel, old);
  win.setPanel = function (next) { this.panel = next; };
  assert.equal(api.rebuildOpenPanels([win], Old, Next), 1);
  assert.ok(win.panel instanceof Next);
  assert.equal(errors.length, 3);
  assert.match(errors[2][0], /dispose the replaced/);
});

test("status pills escape project-controlled messages after the split", () => {
  const { proto } = load();
  const pills = [];
  proto.updateStatus.call({ editor: { playback: { currentFrame: 12 } },
    selectedKeys: () => [], propGroups: () => [], zoomX: 1, zoomY: 1, options: {},
    _doc: () => ({ createElement: () => ({}) }),
    statusEl: { appendChild: (pill) => pills.push(pill) },
  }, '<img src=x onerror="bad">&\'');
  assert.equal(pills.at(-1).innerHTML, "&lt;img src=x onerror=&quot;bad&quot;&gt;&amp;&#39;");
});
