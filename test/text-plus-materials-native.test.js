"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict"), test = require("node:test");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { nativeHost, cache, core } = require("./expressions-plus-harness.js");
const materialParts = require("../plugins/text-plus/text-plus-materials.js");
const plugin = require("../plugins/text-plus/text-plus.js");
const split = require("../plugins/text-plus/text-plus-geometry.js");
const { state } = require("../plugins/text-plus/text-plus-utils.js");
const root = path.resolve(__dirname, "..");
const json = x => JSON.parse(JSON.stringify(x));
const vector = value => ({ animated: false, keyframes: [{ value, frame: 0, tween: 1 }] });
const nativeTest = (name, run) => test(name, { skip: !fs.existsSync(core) }, run);

function fixture() {
  const native = nativeHost(), { PZ, THREE, context } = native;
  Object.assign(context, { Image: class {}, CSS: { supports: () => true },
    window: { addEventListener() {} }, navigator: {}, ZoidiumPluginApis: globalThis.ZoidiumPluginApis });
  vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context);
  PZ.zoidium = { define(name, api) { this[name] = api; }, remove(name) { delete this[name]; } };
  vm.runInContext(fs.readFileSync(path.join(root, "plugins/core/object3d-registry.js"), "utf8"), context);
  PZ.material.fnList.singlecolor = Promise.resolve(vm.runInContext("(function(){" + fs.readFileSync(path.join(cache, "material/singlecolor.js"), "utf8") + "})", context));
  const editor = {};
  PZ.observable.defineObservableProp(editor, "project", "onProjectChanged");
  const project = new PZ.project();
  project.ui = { onChanged: new PZ.observable() };
  project.threeObj = new THREE.Object3D();
  project.objects = new PZ.objectList(project, PZ.object3d);
  project.children.push(project.objects);
  editor.history = new PZ.ui.history(editor);
  editor.project = project;
  const edit = Object.create(PZ.ui.edit.prototype); edit.editor = editor;
  const getAsset = (_kind, source) => fs.readFileSync(path.join(root, source.split("?")[0]), "utf8");
  plugin.activate({ PZ, window: { THREE }, editor, object3d: PZ.zoidium.object3d, getAsset });
  const scene = PZ.object3d.create(5);
  project.objects.push(scene); scene.load({ objects: [] });
  const make = (data = {}, parent = scene) => {
    const object = PZ.object3d.create(materialParts.TYPE);
    parent.objects.push(object); object.load(data); return object;
  };
  function operation(fn) { editor.history.startOperation(); fn(); editor.history.finishOperation(); }
  async function settle(parent) {
    for (const collection of [parent.frontMaterials, parent.sideMaterials]) {
      if (collection?.[0]) await collection[0].loading;
    }
  }
  const clear = () => { scene.unload(); plugin.deactivate(); };
  return { ...native, editor, project, scene, make, edit, operation, settle, clear, getAsset };
}

nativeTest("native singleton slots have distinct addresses and preserve keyframes through undo, duplicate, paste, and reload", async () => {
  const f = fixture(), { PZ, make, operation, edit, editor, settle } = f;
  try {
    const parent = make({ frontMaterial: { type: "singlecolor", properties: { color: vector([1, 0, 0]) } },
      sideMaterial: { type: "singlecolor", properties: { color: vector([0, 1, 0]) } } });
    await settle(parent);
    assert.equal(parent.frontMaterials.name, "Front material");
    assert.equal(parent.sideMaterials.name, "Side material");
    assert.notDeepEqual(json(parent.frontMaterials.getAddress()), json(parent.sideMaterials.getAddress()));
    parent.frontMaterials[0].properties.color.objects.forEach(property => { property.animated = true; });
    parent.frontMaterials[0].properties.color.objects[0].keyframes.push(new PZ.keyframe(0.25, 14));
    const before = json(parent);
    operation(() => edit.deleteObject({ oldParentAddress: parent.sideMaterials.getAddress(), oldIdx: 0 }));
    assert.equal(parent.sideMaterials.length, 0);
    editor.history.undo(); await settle(parent);
    assert.deepEqual(json(parent), before);
    editor.history.redo(); assert.equal(parent.sideMaterials.length, 0);
    editor.history.undo(); await settle(parent);
    operation(() => {
      edit.deleteObject({ oldParentAddress: parent.frontMaterials.getAddress(), oldIdx: 0 });
      edit.createObject({ newParentAddress: parent.frontMaterials.getAddress(), baseType: PZ.material,
        subType: "singlecolor", data: { type: "singlecolor", properties: { color: vector([0, 0, 1]) } } });
    });
    await settle(parent);
    assert.equal(parent.frontMaterials.length, 1);
    editor.history.undo(); await settle(parent);
    assert.deepEqual(json(parent), before);
    editor.history.redo(); await settle(parent);
    assert.deepEqual(json(parent.frontMaterials[0].properties.color.get(14)), [0, 0, 1]);
    editor.history.undo(); await settle(parent);
    const duplicate = make(json(parent)); await settle(duplicate);
    const copied = json(new PZ.package([parent]));
    const pasted = make(copied.data[0]); await settle(pasted);
    const reloaded = make(json(parent)); await settle(reloaded);
    assert.deepEqual(json(duplicate), before);
    assert.deepEqual(json(pasted), before);
    assert.deepEqual(json(reloaded), before);
    assert.notEqual(duplicate.frontMaterials[0].properties.color, parent.frontMaterials[0].properties.color);
    assert.deepEqual(json(parent.frontMaterials[0].properties.color.get(14)), [0.25, 0, 0]);
  } finally { f.clear(); }
});

nativeTest("native material load, prepare, update and unload retain asset ownership in each slot", async () => {
  const f = fixture(), { PZ, make, settle } = f;
  const events = [];
  PZ.material.fnList.slotprobe = Promise.resolve(function () {
    this.load = function (data) { this.threeObj = {}; this.asset = data.asset; events.push(["load", this.asset, this.parentProject]); };
    this.prepare = async function (frame) { events.push(["prepare", this.asset, frame]); };
    this.update = function (frame) { events.push(["update", this.asset, frame]); };
    this.unload = function () { events.push(["unload", this.asset, this.parentProject]); };
    this.toJSON = function () { return { type: this.type, asset: this.asset }; };
  });
  try {
    const parent = make({ frontMaterial: { type: "slotprobe", asset: "front-image" }, sideMaterial: { type: "slotprobe", asset: "side-image" } });
    await settle(parent); await parent.prepare(17); parent.update(17);
    assert.deepEqual(events.map(e => e.slice(0, 2)), [["load", "front-image"], ["load", "side-image"],
      ["prepare", "front-image"], ["prepare", "side-image"], ["update", "front-image"], ["update", "side-image"]]);
    assert.equal(events[0][2], f.project); assert.equal(events[1][2], f.project);
    f.scene.unload();
    assert.deepEqual(events.slice(-2).map(e => e.slice(0, 2)), [["unload", "front-image"], ["unload", "side-image"]]);
    assert.equal(events.at(-1)[2], f.project);
    f.scene.objects.splice(0, 1);
  } finally { f.clear(); }
});

nativeTest("missing Text+ keeps a native Group, source geometry, slot data, and editable descendants", async () => {
  const f = fixture();
  try {
    const parent = f.make({ frontMaterial: { type: "singlecolor", properties: { color: vector([1, 0, 0]) } },
      objects: [{ type: 5, properties: { name: "Child" }, objects: [], customProperties: [] }] });
    await f.settle(parent);
    const saved = json(parent), list = parent.parent;
    parent.unload(); list.splice(0, 1);
    plugin.deactivate();
    const missing = f.PZ.object3d.create(materialParts.TYPE);
    list.push(missing); missing.load(saved);
    assert.ok(missing instanceof f.PZ.object3d.group);
    assert.equal(missing.objects.length, 1);
    assert.equal(missing.threeObj.children[0], missing.objects[0].threeObj);
    assert.deepEqual(json(missing), saved);
    missing.objects[0].properties.name.set("Edited child");
    assert.equal(json(missing).objects[0].properties.name, "Edited child");
    assert.deepEqual(json(missing).frontMaterial, saved.frontMaterial);
    await missing.prepare(0); missing.update(0);
  } finally { f.clear(); }
});

nativeTest("real Three.js cap and wall faces use separate stable material groups", async () => {
  const f = fixture();
  try {
    const parent = f.make({ characterProperties: { characterNumbers: "1,3" },
      frontMaterial: { type: "singlecolor", properties: { color: vector([1, 0, 0]) } },
      sideMaterial: { type: "singlecolor", properties: { color: vector([0, 1, 0]) } } });
    await f.settle(parent);
    const source = { threeObj: new f.THREE.Mesh(new f.THREE.Geometry(), new f.THREE.MeshBasicMaterial()),
      parentObject: parent, font: { font3d: { generateShapes: () => {
        const s = new f.THREE.Shape(); s.moveTo(0, 0); s.lineTo(10, 0); s.lineTo(10, 10); s.lineTo(0, 10); s.lineTo(0, 0); return [s];
      } } }, properties: { text: { get: () => "AVA" } } };
    try {
      state.THREE = f.THREE;
      split.syncTextRendering(source, 0);
      const entries = split.getSplitState(source).entries;
      assert.deepEqual(entries.map(e => Array.isArray(e.mesh.material)), [true, false, true]);
      const first = entries[0], pair = first.mesh.material;
      assert.ok(first.geometry.faces.some(face => face.materialIndex === 0));
      assert.ok(first.geometry.faces.some(face => face.materialIndex === 1));
      assert.equal(pair[0], parent.frontMaterials[0].threeObj);
      assert.equal(pair[1], parent.sideMaterials[0].threeObj);
      for (const frame of [19, 2, 19, 0]) { split.syncTextRendering(source, frame); assert.equal(first.mesh.material, pair); }
    } finally { split.restoreTextRendering(source); }
  } finally { f.clear(); }
});
