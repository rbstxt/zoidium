"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { host, core } = require("./expressions-plus-harness");
const { createPropertyStore } = require("../plugins/constraints/constraint-properties");
const { createEvaluator } = require("../plugins/constraints/track-to-evaluate");

test("both bundles embed the same constraint evaluator source", () => {
  const key = "/plugins/constraints/track-to-evaluate.js";
  const source = fs.readFileSync(require.resolve("../plugins/constraints/track-to-evaluate.js"), "utf8");
  for (const plugin of ["constraints", "expressions-plus"]) {
    assert.equal(require(`../plugins/${plugin}/bundle.json`).assets.text[key], source);
  }
});

test("native empty constraint index skips getters and follows structure and identity events", { skip: !fs.existsSync(core) }, () => {
  const { PZ, THREE } = host();
  const store = createPropertyStore({ PZ, onStructureChanged: () => evaluator.invalidate() });
  let reads = 0;
  const evaluator = createEvaluator({ PZ, THREE, store: { ...store,
    readId(object) { reads++; return store.readId(object); },
    readTarget(object) { reads++; return store.readTarget(object); },
  }, patch(holder, key, make) { holder[key] = make(holder[key]); } });
  const scene = new PZ.object3d.group(); scene.load({ objects: [] });
  function group(data) {
    const object = new PZ.object3d.group(); object.load({ objects: [] }); store.attach(object, data);
    scene.objects.push(object); return object;
  }
  const a = group(), b = group();
  const beforeAttach = evaluator.collect(scene);
  const late = new PZ.object3d.group(); late.load({objects:[]}); scene.objects.push(late);
  evaluator.collect(scene);
  late.properties.onListChanged.watch(() => evaluator.collect(scene));
  store.attach(late, {properties:{zoidiumTrackTo:"missing"}});
  assert.notEqual(evaluator.collect(scene), beforeAttach);
  assert.equal(evaluator.hasConstraints(scene), true);
  late.properties.zoidiumTrackTo.set("");
  assert.equal(evaluator.hasConstraints(scene), false);
  const empty = evaluator.collect(scene); reads = 0;
  for (let i = 0; i < 100; i++) {
    assert.equal(evaluator.applyScene(scene, i + 0.5), false);
    assert.equal(evaluator.hasConstraints(scene), false);
  }
  assert.equal(reads, 0); assert.equal(evaluator.collect(scene), empty);
  b.properties.zoidiumId.set("b"); a.properties.zoidiumTrackTo.set("b");
  assert.equal(evaluator.hasConstraints(scene), true); assert.equal(evaluator.resolveTarget(a, scene), b);
  b.properties.zoidiumId.set("changed"); assert.equal(evaluator.resolveTarget(a, scene), null);
  b.properties.zoidiumId.set("b"); assert.equal(evaluator.resolveTarget(a, scene), b);
  // Clearing and restoring the observable slot covers history undo and redo.
  a.properties.zoidiumTrackTo.set(""); assert.equal(evaluator.hasConstraints(scene), false);
  a.properties.zoidiumTrackTo.set("b"); assert.equal(evaluator.hasConstraints(scene), true);
  scene.objects.splice(scene.objects.indexOf(b), 1); assert.equal(evaluator.resolveTarget(a, scene), null);
  scene.objects.push(b); assert.equal(evaluator.resolveTarget(a, scene), b);
  const parent = group(); scene.objects.splice(scene.objects.indexOf(b), 1); parent.objects.push(b);
  assert.equal(evaluator.collect(scene).parents.get(b), parent);
  const previous = evaluator.collect(scene); b.parent = null;
  assert.notEqual(evaluator.collect(scene), previous);
  const saved = group({ properties: { zoidiumTrackTo: "b" } });
  assert.equal(evaluator.collect(scene).trackers.includes(saved), true);
  store.detach(saved); assert.equal(evaluator.collect(scene).trackers.includes(saved), false);
  // Cached structure still samples moving targets and fractional-frame
  // influence on every pass, including the velocity buffer sample.
  const uncached = createEvaluator({ THREE, store });
  a.properties.zoidiumTrackTo.set("b");
  a.properties.zoidiumInfluence.get = frame => frame * 2;
  const structure = evaluator.collect(scene);
  for (const frame of [12, 12.5, 50, 3, 12.5]) {
    b.threeObj.position.set(10, frame, frame / 2);
    b.threeObj.updateMatrixWorld(true);
    const sample = evaluator => {
      a.threeObj.quaternion.set(0, 0, 0, 1); a.threeObj.updateMatrixWorld(true);
      evaluator.applyScene(scene, frame);
      return a.threeObj.quaternion.toArray();
    };
    assert.deepEqual(sample(evaluator), sample(uncached));
    assert.equal(evaluator.collect(scene), structure);
  }
  const replacement = new PZ.object3d.group(); replacement.load({ objects: [] });
  assert.equal(evaluator.hasConstraints(replacement), false);
});

test("constraint evaluator leaves the shared update alone and wraps observed events per instance", { skip: !fs.existsSync(core) }, () => {
  const { PZ, THREE } = host();
  const nativeUpdate = PZ.observable.prototype.update;
  const store = createPropertyStore({ PZ, onStructureChanged: () => evaluator.invalidate() });
  const evaluator = createEvaluator({ PZ, THREE, store,
    patch(holder, key, make) { holder[key] = make(holder[key]); } });
  assert.equal(PZ.observable.prototype.update, nativeUpdate);
  const plain = new PZ.observable();
  assert.equal(plain.update, nativeUpdate);
  const scene = new PZ.object3d.group(); scene.load({ objects: [] });
  evaluator.collect(scene);
  // The visited structural event carries a per-instance wrapper ...
  assert.notEqual(scene.objects.onListChanged.update, nativeUpdate);
  // ... while unrelated observables and the shared prototype stay native.
  assert.equal(plain.update, nativeUpdate);
  assert.equal(PZ.observable.prototype.update, nativeUpdate);
  // A native list edit still invalidates through the instance hook.
  const before = evaluator.collect(scene);
  const extra = new PZ.object3d.group(); extra.load({ objects: [] });
  scene.objects.push(extra);
  assert.notEqual(evaluator.collect(scene), before);
  assert.equal(PZ.observable.prototype.update, nativeUpdate);
});
