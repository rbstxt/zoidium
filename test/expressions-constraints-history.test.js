"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const { createRequire } = require("node:module");
const { nativeHost, cache, core } = require("./expressions-plus-harness");
const { installEngine } = require("../plugins/expressions-plus/engine");
const { createEvaluator } = require("../plugins/constraints/track-to-evaluate");
const constraints = require("../plugins/constraints/constraints");

function fixture() {
  const native = nativeHost(), { PZ, context } = native;
  Object.assign(context, { Image: class {}, CSS: { supports: () => true },
    window: { addEventListener() {} }, navigator: {} });
  vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context);
  const editor = {};
  PZ.observable.defineObservableProp(editor, "project", "onProjectChanged");
  editor.history = new PZ.ui.history(editor);
  const project = new PZ.project();
  project.threeObj = new native.THREE.Object3D();
  project.ui = { onChanged: new PZ.observable() };
  project.objects = new PZ.objectList(project, PZ.object3d);
  project.children.push(project.objects);
  editor.project = project;
  editor.properties = new PZ.ui.properties(editor);
  const edit = Object.create(PZ.ui.edit.prototype); edit.editor = editor;
  const scene = PZ.object3d.create(5); project.objects.push(scene); scene.load({ objects: [] });
  function group(parent = scene, data = { objects: [] }) {
    const object = PZ.object3d.create(5); parent.objects.push(object); object.load(data); return object;
  }
  function operation(fn) { editor.history.startOperation(); fn(); editor.history.finishOperation(); }
  function clone(object, data = JSON.parse(JSON.stringify(object))) {
    const parent = object.parent;
    operation(() => edit.createObject({ newParentAddress: parent.getAddress(), baseType: PZ.object3d,
      subType: 5, data }));
    return parent[parent.length - 1];
  }
  return { ...native, editor, project, scene, group, clone, edit, operation };
}

test("native expression edits, history, duplicate and package paste keep selective getters", { skip: !fs.existsSync(core) }, () => {
  const state = fixture(), { PZ, editor, group, clone, project } = state;
  const first = group();
  const property = first.properties.position;
  // This expression predates activation and exercises the project walk.
  property.expression = new PZ.expression("[frame, 2, 3]");
  const engine = installEngine({ ...state, project });
  assert.deepEqual(Array.from(property.get(8)), [8, 2, 3]);
  assert.equal(Object.hasOwn(property, "get"), true);
  const key = property.objects[0], nativeGet = key.get;
  const setExpression = expression => editor.properties.setExpression({ property: key.getAddress(), expression });
  setExpression("value + frame");
  assert.equal(key.get(8), 8);
  editor.history.undo(); assert.equal(key.get, nativeGet); assert.equal(Object.hasOwn(key, "get"), false);
  editor.history.redo(); assert.equal(key.get(8), 8);
  setExpression(null); assert.equal(key.get, nativeGet);
  editor.history.undo(); assert.equal(key.get(8), 8);
  editor.history.redo(); assert.equal(key.get, nativeGet);
  const duplicate = clone(first);
  assert.deepEqual(Array.from(duplicate.properties.position.get(9)), [9, 2, 3]);
  editor.history.undo(); assert.equal(duplicate.parent, null);
  editor.history.redo();
  const recreated = first.parent[first.parent.length - 1];
  assert.notEqual(recreated, duplicate);
  assert.deepEqual(Array.from(recreated.properties.position.get(9)), [9, 2, 3]);
  const copied = JSON.parse(JSON.stringify(new PZ.package([first])));
  const pasted = clone(first, copied.data[0]);
  assert.deepEqual(Array.from(pasted.properties.position.get(10)), [10, 2, 3]);
  assert.notEqual(pasted.properties.position.expression, property.expression);
  const shared = new PZ.expression('[value[0] + thisObject.property("Scale").value[0], 0, 0]');
  const a = first.properties.rotation, b = pasted.properties.rotation;
  first.properties.scale.set([2, 1, 1]); pasted.properties.scale.set([5, 1, 1]);
  a.expression = shared; b.expression = shared;
  assert.equal(a.get(0)[0], 2); assert.equal(b.get(0)[0], 5); assert.equal(a.get(0)[0], 2);
  engine.restore(project);
  assert.equal(Object.hasOwn(property, "get"), false);
  assert.equal(Object.hasOwn(b, "get"), false);
});

test("native constraint history, hierarchy copies, reload and replacement invalidate structure", { skip: !fs.existsSync(core) }, () => {
  const state = fixture(), { PZ, THREE, editor, scene, group, edit, operation, clone } = state;
  const disposers = [];
  constraints.activate({ PZ, window: { THREE, CM: editor, document: state.document },
    apis: { propertyControls: { register: () => () => {} }, modules: {
      createRequire(_getAsset, { root }) { return createRequire(path.resolve(__dirname, "..", root, "entry.js")); },
    } }, lifecycle: { onDispose(fn) { disposers.push(fn); } } });
  try {
    const evaluator = createEvaluator({ PZ, THREE, patch: state.patch, store: {
      isAttached: object => !!object.properties?.zoidiumTrackTo,
      readId: object => object.properties.zoidiumId.get(), readTarget: object => object.properties.zoidiumTrackTo.get(),
    } });
    const a = group(), b = group();
    assert.equal(evaluator.hasConstraints(scene), false);
    const set = (property, value) => operation(() => editor.properties.setValue({ property: property.getAddress(), value }));
    set(b.properties.zoidiumId, "target"); set(a.properties.zoidiumTrackTo, "target");
    assert.equal(evaluator.resolveTarget(a, scene), b);
    editor.history.undo(); assert.equal(evaluator.hasConstraints(scene), false);
    editor.history.redo(); assert.equal(evaluator.resolveTarget(a, scene), b);
    operation(() => edit.deleteObject({ oldParentAddress: b.parent.getAddress(), oldIdx: b.parent.indexOf(b) }));
    assert.equal(evaluator.resolveTarget(a, scene), null);
    editor.history.undo();
    const restored = evaluator.resolveTarget(a, scene); assert.ok(restored); assert.notEqual(restored, b);
    editor.history.redo(); assert.equal(evaluator.resolveTarget(a, scene), null);
    editor.history.undo();
    const parent = group();
    const moving = evaluator.resolveTarget(a, scene), oldParent = moving.parent;
    operation(() => edit.moveObject({ oldParentAddress: oldParent.getAddress(), oldIdx: oldParent.indexOf(moving),
      newParentAddress: parent.objects.getAddress() }));
    assert.equal(evaluator.collect(scene).parents.get(moving), parent);
    editor.history.undo(); assert.equal(evaluator.collect(scene).parents.get(moving), null);
    editor.history.redo(); assert.equal(evaluator.collect(scene).parents.get(moving), parent);
    const duplicate = clone(parent);
    assert.notEqual(duplicate.objects[0].properties.zoidiumId.get(), "target");
    const cached = evaluator.collect(scene);
    moving.properties.load({ zoidiumId: "replacement" });
    assert.notEqual(evaluator.collect(scene), cached); assert.equal(evaluator.resolveTarget(a, scene), null);
    const nextProject = new PZ.project(); nextProject.ui = { onChanged: new PZ.observable() };
    editor.project = nextProject;
    const nextScene = PZ.object3d.create(5); nextScene.load({ objects: [] });
    assert.equal(evaluator.hasConstraints(nextScene), false);
    editor.project = state.project;
    assert.equal(evaluator.hasConstraints(scene), true);
  } finally { constraints.deactivate(); for (const dispose of disposers.reverse()) dispose(); }
});
