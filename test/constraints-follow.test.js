"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { nativeHost } = require("./expressions-plus-harness");
const { createPropertyStore } = require("../plugins/constraints/constraint-properties");
const { createEvaluator } = require("../plugins/constraints/track-to-evaluate");
const { createFollowEvaluator } = require("../plugins/constraints/follow-evaluate");

function fixture() {
  const { PZ, THREE, context } = nativeHost();
  context.fetch = async () => ({ text: async () => "" });
  const store = createPropertyStore({ PZ });
  const project = new PZ.project();
  project.load({ assets: {}, media: [], sequence: { length: 100, properties: { resolution: [128, 72] },
    videoTracks: [0, 10].map(start => ({ type: 0, clips: [{ start, length: 60,
      object: { type: 4, properties: {}, effects: [], objects: [{ type: 5, properties: {}, objects: [] }] } }] })), audioTracks: [] } });
  const scenes = Array.from(project.sequence.videoTracks, track => track.clips[0].object);
  project.forEachItemOfType(PZ.object3d, object => store.attach(object));
  const [a, b] = scenes.map(scene => scene.objects[0]);
  const trackEvaluator = createEvaluator({ PZ, THREE, store });
  const warnings = [];
  const follow = createFollowEvaluator({ PZ, THREE, store, trackEvaluator, report: message => warnings.push(message) });
  function set(object, key, value) { object.properties[key].set(value); }
  function link(object, target) { set(object, store.KEYS.follow, store.ensureId(target)); }
  function update(index, frame) { scenes[index].update(frame); follow.applyScene(scenes[index], frame); }
  return { PZ, THREE, store, project, scenes, a, b, follow, warnings, set, link, update };
}
function close(actual, expected) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < 1e-8, `${actual} != ${expected}`));
}

test("Follow samples a different clip's start and remapping without touching its live pose", () => {
  const { a, b, PZ, THREE, scenes, set, link, update } = fixture();
  b.properties.position.get = frame => [frame, 2, 3];
  set(b, "rotation", [0.2, 0.4, 0.1]); set(b, "scale", [2, 3, 4]);
  b.threeObj.position.set(999, 999, 999);
  PZ.zoidium = { temporal: { mapLayerFrame(scene, local) { return scene === scenes[1] ? { sourceFrame: local * 2 } : null; } } };
  link(a, b);
  for (const absolute of [37, 11, 0, 80, 37, 10.5]) {
    update(0, absolute);
    const targetLocal = absolute < 10 ? 0 : absolute >= 70 ? 59 : absolute - 10;
    close(a.threeObj.position.toArray(), [targetLocal * 2, 2, 3]);
    close(a.threeObj.quaternion.toArray(), new THREE.Quaternion().setFromEuler(b.threeObj.rotation.set(0.2, 0.4, 0.1)).toArray());
    close(a.threeObj.scale.toArray(), [2, 3, 4]);
    close(b.threeObj.position.toArray(), [999, 999, 999]);
  }
});

test("Follow converts world transforms through a parent, supports local space and channel offsets", () => {
  const f = fixture(), { PZ, a, b, scenes, set, link, store, update } = f;
  const parent = new PZ.object3d.group(); scenes[0].objects.push(parent); parent.load({ objects: [] }); store.attach(parent);
  scenes[0].objects.splice(0, 1); parent.objects.push(a);
  set(parent, "position", [10, 0, 0]); set(parent, "scale", [2, 2, 2]);
  set(b, "position", [4, 6, 8]); set(b, "scale", [3, 4, 5]); link(a, b);
  update(0, 20);
  close(a.threeObj.position.toArray(), [-3, 3, 4]); close(a.threeObj.scale.toArray(), [1.5, 2, 2.5]);
  set(a, store.KEYS.followSpace, 1); set(a, store.KEYS.positionOffset, [1, 2, 3]);
  set(a, store.KEYS.scaleOffset, [2, 1, 0.5]); set(a, store.KEYS.rotationOffset, [0, 0, Math.PI / 2]);
  update(0, 20); close(a.threeObj.position.toArray(), [5, 8, 11]); close(a.threeObj.scale.toArray(), [6, 4, 2.5]);
  close(a.threeObj.rotation.toArray().slice(0, 3), [0, 0, Math.PI / 2]);
  set(a, store.KEYS.followPosition, 0); set(a, store.KEYS.followScale, 0); set(a, store.KEYS.followRotation, 0);
  update(0, 20); close(a.threeObj.position.toArray(), [0, 0, 0]); close(a.threeObj.scale.toArray(), [1, 1, 1]);
  close(a.threeObj.quaternion.toArray(), [0, 0, 0, 1]);
});

test("Follow orders mixed Track To chains and rejects cross-scene and descendant cycles", () => {
  const { a, b, scenes, set, link, store, update, warnings } = fixture();
  link(a, b); link(b, a); update(0, 20); update(1, 10);
  close(a.threeObj.position.toArray(), [0, 0, 0]); assert.equal(warnings.length, 2);
  set(b, store.KEYS.follow, ""); set(b, "position", [7, 3, 2]); update(0, 20);
  close(a.threeObj.position.toArray(), [7, 3, 2]);
  scenes[1].objects.splice(0, 1); a.objects.push(b); link(a, b); update(0, 20);
  close(a.threeObj.position.toArray(), [0, 0, 0]);
});

test("Follow saved defaults are additive and copy batches remap links, including cross-layer targets", () => {
  const { a, b, store, set } = fixture();
  const before = JSON.parse(JSON.stringify(a));
  assert.equal(Object.hasOwn(before.properties, store.KEYS.follow), false);
  set(a, store.KEYS.follow, store.ensureId(b)); set(a, store.KEYS.positionOffset, [1, 2, 3]);
  const saved = JSON.parse(JSON.stringify(a));
  store.beginLoad();
  const targetCopy = new b.constructor(); b.parent.push(targetCopy); targetCopy.load(JSON.parse(JSON.stringify(b))); store.attach(targetCopy, JSON.parse(JSON.stringify(b)));
  const copy = new a.constructor(); a.parent.push(copy); copy.load(saved); store.attach(copy, saved);
  store.endLoad();
  assert.equal(store.readFollow(copy), store.readId(targetCopy)); assert.notEqual(store.readFollow(copy), store.readFollow(a));
  close(Array.from(copy.properties[store.KEYS.positionOffset].get(3)), [1, 2, 3]);
  copy.properties[store.KEYS.follow].set("");
  assert.equal(JSON.parse(JSON.stringify(copy)).properties[store.KEYS.follow], "");
});

test("Follow uses sequence output time during remapped and half-frame samples", () => {
  const { a, b, PZ, project, scenes, link, follow } = fixture();
  b.properties.position.get = frame => [frame, 0, 0]; link(a, b);
  PZ.zoidium = { temporal: { contexts: [{ renderingSequence: true, outputFrame: 30, compositor: { _sequence: project.sequence } }] } };
  scenes[0].update(70); follow.applyScene(scenes[0], 70);
  close(a.threeObj.position.toArray(), [20, 0, 0]);
  follow.applyScene(scenes[0], 70.5, 0.5); close(a.threeObj.position.toArray(), [20.5, 0, 0]);
});
