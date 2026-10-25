"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { host, core } = require("./expressions-plus-harness");
const { createPropertyStore } = require("../plugins/constraints/constraint-properties");
const { createEvaluator } = require("../plugins/constraints/track-to-evaluate");

test("native empty constraint index skips getters and follows structure and identity events", { skip: !fs.existsSync(core) }, () => {
  const { PZ, THREE } = host();
  const store = createPropertyStore({ PZ });
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
  const replacement = new PZ.object3d.group(); replacement.load({ objects: [] });
  assert.equal(evaluator.hasConstraints(replacement), false);
});
