"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createRequire } = require("node:module");
const { nativeHost, cache, core } = require("./expressions-plus-harness");
const constraints = require("../plugins/constraints/constraints");

function fixture() {
  const native = nativeHost(), { PZ, THREE, context } = native;
  Object.assign(context, { DOMAIN: "", fetch: async () => ({ text: async () => "" }), Image: class {},
    CSS: { supports: () => true }, window: { addEventListener() {} }, navigator: {} });
  vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context);
  const editor = {};
  PZ.observable.defineObservableProp(editor, "project", "onProjectChanged");
  editor.history = new PZ.ui.history(editor);
  const edit = Object.create(PZ.ui.edit.prototype); edit.editor = editor;
  edit.propertyOps = new PZ.ui.properties(editor);
  constraints.activate({ PZ, window: { THREE, CM: editor },
    apis: { propertyControls: { register: () => () => {} }, modules: {
      createRequire(_getAsset, { root }) { return createRequire(path.resolve(__dirname, "..", root, "entry.js")); },
    } } });
  const project = new PZ.project(); project.ui = { onChanged: new PZ.observable() }; editor.project = project;
  project.load({ assets: {}, media: [], sequence: { length: 100, properties: { resolution: [128, 72] },
    videoTracks: [0, 10].map(start => ({ type: 0, clips: [{ start, length: 60,
      object: { type: 4, properties: {}, effects: [], objects: [{ type: 5, properties: {}, objects: [] }] } }] })), audioTracks: [] } });
  const scenes = Array.from(project.sequence.videoTracks, track => track.clips[0].object);
  const [a, b] = scenes.map(scene => scene.objects[0]);
  function operation(fn) { editor.history.startOperation(); fn(); editor.history.finishOperation(); }
  function set(property, value) { operation(() => edit.propertyOps.setValue({ property: property.getAddress(), value })); }
  return { ...native, editor, edit, project, scenes, a, b, operation, set };
}

test("native Follow edits, target deletion, undo, redo, duplication and reopen keep the link and deletion pose", { skip: !fs.existsSync(core) }, () => {
  const { PZ, editor, edit, scenes, a, b, operation, set } = fixture();
  try {
    set(b.properties.zoidiumId, "driver"); set(b.properties.position, [12, 4, 2]);
    set(a.properties.zoidiumFollow, "driver");
    scenes[0].update(20); assert.deepEqual(Array.from(a.threeObj.position.toArray()), [12, 4, 2]);
    editor.history.undo(); scenes[0].update(20); assert.deepEqual(Array.from(a.threeObj.position.toArray()), [0, 0, 0]);
    editor.history.redo(); scenes[0].update(20); assert.deepEqual(Array.from(a.threeObj.position.toArray()), [12, 4, 2]);
    operation(() => edit.createObject({ newParentAddress: a.parent.getAddress(), baseType: PZ.object3d,
      subType: 5, data: JSON.parse(JSON.stringify(a)) }));
    const copy = a.parent[1]; assert.equal(copy.properties.zoidiumFollow.get(), "driver");
    scenes[0].update(20);
    operation(() => edit.deleteObject({ oldParentAddress: b.parent.getAddress(), oldIdx: 0 }));
    scenes[0].update(37); assert.deepEqual(Array.from(a.threeObj.position.toArray()), [12, 4, 2]);
    assert.ok(a.properties.zoidiumFollowFallback.get());
    assert.deepEqual(Array.from(copy.threeObj.position.toArray()), [12, 4, 2]);
    const saved = JSON.parse(JSON.stringify(editor.project));
    editor.history.undo(); assert.equal(scenes[1].objects.length, 1); assert.equal(a.properties.zoidiumFollowFallback.get(), "");
    editor.history.redo(); assert.equal(scenes[1].objects.length, 0); assert.ok(a.properties.zoidiumFollowFallback.get());
    const next = new PZ.project(); next.load(saved); next.ui = { onChanged: new PZ.observable() }; editor.project = next;
    const scene = next.sequence.videoTracks[0].clips[0].object; scene.update(0);
    assert.equal(scene.objects[0].properties.zoidiumFollow.get(), "driver");
    assert.deepEqual(Array.from(scene.objects[0].threeObj.position.toArray()), [12, 4, 2]);
    assert.equal(constraints.isInUse(), true);
  } finally { constraints.deactivate(); }
});

test("native motion-blur sampling applies Follow at the half frame without recursive matrix updates", { skip: !fs.existsSync(core) }, () => {
  const { THREE, scenes, a, b, set } = fixture();
  try {
    set(b.properties.zoidiumId, "driver"); set(a.properties.zoidiumFollow, "driver");
    b.properties.position.get = frame => [frame, 0, 0];
    const motion = scenes[0].motionBlur;
    motion.velocityBuffer = {};
    scenes[0].pass.camera = new THREE.PerspectiveCamera();
    let sampled = null;
    const traverse = scenes[0].threeObj.traverse;
    scenes[0].threeObj.traverse = function () {
      sampled = a.threeObj.position.x;
      return traverse.apply(this, arguments);
    };
    scenes[0].update(11);
    assert.equal(sampled, 1.5); assert.equal(a.threeObj.position.x, 1);
  } finally { constraints.deactivate(); }
});

test("Follow visibility is display-only through native target history, duplicate, save, and reopen", { skip: !fs.existsSync(core) }, async () => {
  const { PZ, editor, edit, a, set, operation } = fixture();
  const extraKeys = ["zoidiumFollowSpace", "zoidiumFollowPosition", "zoidiumFollowRotation", "zoidiumFollowScale",
    "zoidiumFollowPositionOffset", "zoidiumFollowRotationOffset", "zoidiumFollowScaleOffset"];
  const flush = () => Promise.resolve();
  function visible(object, active) {
    assert.equal(object.properties.zoidiumFollow.visible !== false, true);
    for (const key of extraKeys) assert.equal(object.properties[key].visible !== false, active, key);
    assert.equal(object.properties.zoidiumFollowFallback.visible, false);
  }
  try {
    visible(a, false);
    const instances = extraKeys.map(key => a.properties[key]);
    set(a.properties.zoidiumFollowSpace, 1);
    set(a.properties.zoidiumFollowScale, 0);
    a.properties.zoidiumFollowPositionOffset.load({ objects: [
      { animated: true, keyframes: [{ frame: 0, value: 2, tween: 1 }, { frame: 10, value: 8, tween: 1 }] },
      { expression: "value + frame" }, { keyframes: [{ frame: 0, value: 3, tween: 1 }] },
    ] });
    const preserved = () => JSON.stringify(extraKeys.map(key => a.properties[key]));
    const savedValues = preserved();
    let notifications = 0;
    a.properties.onListChanged.watch(() => { notifications++; });
    for (const value of ["missing-target", "", "missing-target", ""]) {
      set(a.properties.zoidiumFollow, value); await flush();
      visible(a, Boolean(value)); assert.equal(preserved(), savedValues);
      assert.ok(instances.every((property, i) => property === a.properties[extraKeys[i]]));
    }
    assert.equal(notifications, 4, "one deferred list notification per completed target edit");
    editor.history.undo(); await flush(); visible(a, true); assert.equal(preserved(), savedValues);
    editor.history.redo(); await flush(); visible(a, false); assert.equal(preserved(), savedValues);
    operation(() => edit.createObject({ newParentAddress: a.parent.getAddress(), baseType: PZ.object3d,
      subType: 5, data: JSON.parse(JSON.stringify(a)) }));
    const duplicate = a.parent[1]; visible(duplicate, false);
    assert.equal(JSON.stringify(extraKeys.map(key => duplicate.properties[key])), savedValues);
    const saved = JSON.parse(JSON.stringify(editor.project));
    const reopened = new PZ.project(); reopened.load(saved); reopened.ui = { onChanged: new PZ.observable() }; editor.project = reopened;
    const copy = reopened.sequence.videoTracks[0].clips[0].object.objects[0]; visible(copy, false);
    assert.equal(JSON.stringify(extraKeys.map(key => copy.properties[key])), savedValues);
    set(copy.properties.zoidiumFollow, "missing-target"); await flush(); visible(copy, true);
    assert.equal(JSON.stringify(extraKeys.map(key => copy.properties[key])), savedValues);
  } finally { constraints.deactivate(); }
});
