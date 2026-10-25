"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { host, fixture, editorFor, deferred } = require("./helpers/editor-identity-host.cjs");
require("./migrate-test-apis.js").ensureMainRealmApis();
const { createModel } = require("../plugins/shape-plus/model.js");
const { createLayerClass } = require("../plugins/shape-plus/layer.js");
const { install } = require("../plugins/shape-plus/convert-native.js");
function setup(t, stage = "shaders") {
  const c = host(), f = fixture(c), { PZ, THREE } = c, { layer, clip, project } = f;
  // Authored outlines avoid loading native canvas or glyph resources.
  layer.objects = [{ type: 1, properties: {}, operations: [], path: { commands: [
    { type: "M", x: 0, y: 0 }, { type: "L", x: 10, y: 0 },
    { type: "L", x: 0, y: 10 }, { type: "Z" },
  ] } }];
  let updates = 0;
  layer.prepare = async () => {}; layer.update = () => { updates++; }; layer.unload = () => {};
  const editor = editorFor(PZ, project), gate = deferred(), began = deferred();
  const { Content } = createModel(PZ), Base = createLayerClass(PZ, THREE, Content);
  let next, unloads = 0;
  class ObservedLayer extends Base {
    constructor() { super(); next = this; }
    load(data) { super.load(data); if (stage === "load") { began.resolve(); return gate.promise; } }
    unload() { unloads++; super.unload(); }
  }
  project.assets.createFromPreset = () => ({}); project.assets.load = asset => asset;
  project.assets.unload = () => {};
  PZ.asset.shader = function(asset) {
    this.asset = asset;
    this.getShader = () => { began.resolve(); return stage === "shaders" ? gate.promise : Promise.resolve("void main(){}"); };
  };
  if (stage === "source load") layer.loading = gate.promise;
  if (stage === "source prepare") layer.prepare = () => { began.resolve(); return gate.promise; };
  const cleanups = [];
  global.window = { PZ, CM: editor }; global.document = { querySelectorAll: () => [] };
  const api = install({ lifecycle: { onDispose: fn => cleanups.push(fn) } }, ObservedLayer);
  let disposed = false;
  const dispose = () => { if (!disposed) { disposed = true; cleanups.forEach(fn => fn()); } };
  t.after(() => { dispose(); next?.unload(); delete global.window; delete global.document; });
  const detach = () => { clip.unload(); f.track.clips.splice(f.track.clips.indexOf(clip), 1); };
  return { ...f, editor, gate, began, api, detach, dispose,
    get next() { return next; }, get unloads() { return unloads; }, get updates() { return updates; } };
}
for (const stage of ["source load", "source prepare", "load", "shaders"]) {
  test("Shape+ conversion rejects clip deletion during " + stage, async t => {
    const h = setup(t, stage), converting = h.api.convert(h.layer);
    if (stage !== "source load") await h.began.promise;
    h.detach(); h.gate.resolve("void main(){}");
    await assert.rejects(converting, /changed during conversion/);
    assert.equal(h.clip.object, h.layer); assert.equal(h.editor.history.operation, null);
    assert.equal(h.editor.history.undoStack.length, 0);
    if (h.next) assert.equal(h.unloads, 1);
    if (stage.startsWith("source")) assert.equal(h.updates, 0);
  });
}
test("Shape+ conversion rejects an unloaded plugin session", async t => {
  const h = setup(t), converting = h.api.convert(h.layer); await h.began.promise;
  h.dispose(); h.gate.resolve("void main(){}");
  await assert.rejects(converting, /changed during conversion/);
  assert.equal(h.clip.object, h.layer); assert.equal(h.unloads, 1);
  assert.equal(h.editor.history.operation, null); assert.equal(h.editor.history.undoStack.length, 0);
});
test("Shape+ conversion rejects project replacement while native shaders load", async t => {
  const h = setup(t), converting = h.api.convert(h.layer); await h.began.promise;
  const replacement = fixture({ PZ: window.PZ });
  h.editor.project = replacement.project; h.gate.resolve("void main(){}");
  await assert.rejects(converting, /changed during conversion/);
  assert.equal(h.clip.object, h.layer); assert.equal(h.unloads, 1);
  assert.equal(h.editor.history.operation, null); assert.equal(h.editor.history.undoStack.length, 0);
});
test("failed Shape+ exchange restores clip and track and discards history", async t => {
  const h = setup(t), converting = h.api.convert(h.layer); await h.began.promise;
  h.track.layer = h.layer;
  global.document.querySelectorAll = () => [{ pz_panel: Object.assign(Object.create(window.PZ.ui.edit.prototype), {
    objectsChanged() { throw Error("Panel refresh failed"); },
  }) }];
  h.gate.resolve("void main(){}");
  await assert.rejects(converting, /Panel refresh failed/);
  assert.equal(h.clip.object, h.layer); assert.equal(h.track.layer, h.layer);
  assert.ok(h.clip.children.includes(h.layer)); assert.ok(!h.clip.children.includes(h.next));
  assert.equal(h.layer.parent, h.clip); assert.equal(h.unloads, 1);
  assert.equal(h.editor.history.operation, null); assert.equal(h.editor.history.undoStack.length, 0);
});
test("failed Shape+ history notification removes the published operation and preserves redo", async t => {
  const h = setup(t), converting = h.api.convert(h.layer); await h.began.promise;
  const redo = []; h.editor.history.redoStack.push(redo);
  h.project.ui.onChanged.watch(() => { throw Error("Project notification failed"); });
  h.gate.resolve("void main(){}");
  await assert.rejects(converting, /Project notification failed/);
  assert.equal(h.clip.object, h.layer); assert.equal(h.editor.history.operation, null);
  assert.equal(h.editor.history.undoStack.length, 0); assert.equal(h.unloads, 1);
  assert.equal(h.editor.history.redoStack.length, 1); assert.equal(h.editor.history.redoStack.pop(), redo);
});
test("attached Shape+ conversion preserves replacement data and native undo and redo", async t => {
  const h = setup(t), converting = h.api.convert(h.layer); await h.began.promise;
  h.track.layer = h.layer; h.gate.resolve("void main(){}"); await converting;
  const after = JSON.stringify(h.next);
  assert.equal(h.clip.object, h.next); assert.equal(h.track.layer, h.next);
  assert.equal(h.editor.history.undoStack.length, 1); assert.equal(h.editor.history.operation, null);
  h.editor.history.undo(); assert.equal(h.clip.object, h.layer); assert.equal(h.track.layer, h.layer);
  h.editor.history.redo(); assert.equal(h.clip.object, h.next); assert.equal(JSON.stringify(h.next), after);
  assert.equal(h.unloads, 0);
});
