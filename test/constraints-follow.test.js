"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { nativeHost } = require("./expressions-plus-harness");
const { createPropertyStore } = require("../plugins/constraints/constraint-properties");
const { createEvaluator } = require("../plugins/constraints/track-to-evaluate");
const { createFollowEvaluator } = require("../plugins/constraints/follow-evaluate");

function fixture() {
  const { PZ, THREE, context } = nativeHost();
  context.DOMAIN = "";
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

test("Follow evaluates a constrained target first and Track To wins rotation after Follow", () => {
  const { PZ, THREE, a, b, store, scenes, set, link, update } = fixture();
  const c = new PZ.object3d.group(); scenes[1].objects.push(c); c.load({ objects: [] }); store.attach(c);
  set(c, "position", [10, 4, 0]); set(c, "rotation", [0, Math.PI / 3, 0]); set(c, "scale", [3, 2, 1]);
  link(b, c); link(a, b);
  update(0, 20); close(a.threeObj.position.toArray(), [10, 4, 0]); close(a.threeObj.scale.toArray(), [3, 2, 1]);
  close(a.threeObj.quaternion.toArray(), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 3, 0)).toArray());
  // A same-scene aim is applied after the cross-scene pose copy.
  const aim = new PZ.object3d.group(); scenes[0].objects.push(aim); aim.load({ objects: [] }); store.attach(aim);
  set(aim, "position", [10, 4, 10]); set(a, store.KEYS.target, store.ensureId(aim));
  update(0, 20); close(a.threeObj.quaternion.toArray(), [0, 0, 0, 1]); close(a.threeObj.position.toArray(), [10, 4, 0]);
  // The negative control proves the rotation is caused by Track To.
  set(a, store.KEYS.target, ""); update(0, 20);
  assert.ok(Math.abs(a.threeObj.quaternion.y) > 0.4);
});

test("Follow retains a serialized deletion pose regardless of frame order and safely ignores corrupt fallback data", () => {
  const { a, b, store, scenes, set, link, update, follow } = fixture();
  set(b, "position", [12, 2, 0]); link(a, b); update(0, 20);
  const commands = [];
  follow.captureDeleted(b, { project: a.parentProject, properties: {
    setValue(command) { commands.push(command); a.parentProject.addressLookup(command.property).set(command.value); },
  } });
  assert.equal(commands.length, 1);
  scenes[1].objects.splice(0, 1);
  for (const frame of [37, 0, 11, 37]) { update(0, frame); close(a.threeObj.position.toArray(), [12, 2, 0]); }
  const saved = JSON.parse(JSON.stringify(a));
  const copy = new a.constructor(); a.parent.push(copy); copy.load(saved); store.attach(copy, saved);
  update(0, 6); close(copy.threeObj.position.toArray(), [12, 2, 0]);
  set(a, store.KEYS.fallback, "invalid"); update(0, 8); close(a.threeObj.position.toArray(), [0, 0, 0]);
});

test("Follow samples native camera shake on a detached camera at target time", () => {
  const { PZ, a, scenes, store, set, link, update } = fixture();
  const camera = new PZ.object3d.camera(); scenes[1].objects.push(camera); camera.load({ type: 6, objectType: 1 }); store.attach(camera);
  set(camera, "position", [5, 2, 30]); set(camera, "shakeAmplitude", 4); set(camera, "shakeSpeed", 1);
  link(a, camera);
  camera.update(20);
  const expectedP = camera.threeObj.position.toArray(), expectedQ = camera.threeObj.quaternion.toArray();
  camera.threeObj.position.set(999, 999, 999);
  for (const frame of [30, 40, 30]) {
    update(0, frame);
    if (frame === 30) { close(a.threeObj.position.toArray(), expectedP); close(a.threeObj.quaternion.toArray(), expectedQ); }
    close(camera.threeObj.position.toArray(), [999, 999, 999]);
  }
});

test("world Follow preserves a rotated target under the same nonuniform parent before local decomposition", () => {
  const { PZ, a, b, scenes, store, set, link, update } = fixture();
  const parent = new PZ.object3d.group(); scenes[0].objects.push(parent); parent.load({ objects: [] }); store.attach(parent);
  scenes[0].objects.splice(0, 1); scenes[1].objects.splice(0, 1); parent.objects.push(a, b);
  set(parent, "position", [5, 8, 2]); set(parent, "scale", [2, 3, 1]); set(parent, "rotation", [0.3, 0.5, 0.1]);
  set(b, "rotation", [0.7, 0.2, 0.3]); set(b, "position", [4, 1, 2]); set(b, "scale", [3, 2, 1]);
  link(a, b); update(0, 20);
  close(a.threeObj.matrixWorld.toArray(), b.threeObj.matrixWorld.toArray());
});
