"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEvaluator } = require("../plugins/constraints/track-to-evaluate.js");
const math = require("../plugins/constraints/track-to-math.js");

class Vector3 {
  setFromMatrixPosition(matrix) { [this.x, this.y, this.z] = matrix.position; return this; }
}
class Matrix4 {}
function object(id, target, position = [0, 0, 0]) {
  const quaternion = {
    set(x, y, z, w) { Object.assign(this, { x, y, z, w }); },
  };
  quaternion.set(0, 0, 0, 1);
  return {
    id, target, influence: 100, axis: 2, up: 1,
    threeObj: { quaternion, matrixWorld: { position }, updateMatrixWorld() {} },
  };
}
function setup(objects) {
  const warnings = [];
  const evaluator = createEvaluator({
    THREE: { Vector3, Matrix4 },
    store: {
      isAttached: () => true,
      readId: (item) => item.id,
      readTarget: (item) => item.target,
      readInfluence: (item, frame) => typeof item.influence === "function" ? item.influence(frame) : item.influence,
      readTrackAxis: (item) => item.axis,
      readUpAxis: (item) => item.up,
      classify: () => "rotation",
    },
    report: (warning) => warnings.push(warning),
  });
  return { evaluator, scene: { objects }, warnings };
}
function quaternion(item) {
  const { x, y, z, w } = item.threeObj.quaternion;
  return [x, y, z, w];
}
function sameRotation(actual, expected) {
  assert.ok(Math.abs(Math.abs(actual.reduce((sum, value, i) => sum + value * expected[i], 0)) - 1) < 1e-10);
}

test("scene post pass uses the same-frame target and the full evaluated own quaternion", () => {
  const tracker = object("camera", "sphere");
  const target = object("sphere", "", [10, 0, 0]);
  const { evaluator, scene } = setup([tracker, target]);
  const own = math.quaternionFromEuler(0.3, 0.4, -0.2, "ZYX");
  tracker.threeObj.quaternion.set(...own);
  tracker.influence = (frame) => frame;
  evaluator.applyScene(scene, 50);
  sameRotation(quaternion(tracker), math.solveTrackTo({ direction: [10, 0, 0], own, influence: 50, trackAxis: 2, upAxis: 1 }));
  const first = quaternion(tracker);
  // Emulate the native evaluator resetting poses at a later and earlier time.
  tracker.threeObj.quaternion.set(...own);
  target.threeObj.matrixWorld.position = [-10, 2, 3];
  evaluator.applyScene(scene, 100);
  tracker.threeObj.quaternion.set(...own);
  target.threeObj.matrixWorld.position = [10, 0, 0];
  scene.objects.reverse();
  evaluator.applyScene(scene, 50);
  sameRotation(quaternion(tracker), first);
});

test("missing, zero-influence and coincident targets leave the native pose intact", () => {
  const tracker = object("a", "missing");
  const target = object("b", "");
  const { evaluator, scene } = setup([tracker, target]);
  const own = math.quaternionFromEuler(0, 0.5, 0, "XYZ");
  tracker.threeObj.quaternion.set(...own);
  assert.equal(evaluator.applyScene(scene, 0), false);
  tracker.target = "b";
  evaluator.applyScene(scene, 0);
  sameRotation(quaternion(tracker), own);
  tracker.influence = 0;
  assert.equal(evaluator.applyScene(scene, 0), false);
  sameRotation(quaternion(tracker), own);
});

test("reciprocal and descendant cycles are skipped and reported once per object", () => {
  const a = object("a", "b");
  const b = object("b", "a", [1, 0, 0]);
  const { evaluator, scene, warnings } = setup([a, b]);
  assert.equal(evaluator.applyScene(scene, 1), false);
  assert.equal(evaluator.applyScene(scene, 2), false);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((message) => message.includes("dependency cycle")));
  b.target = "";
  a.objects = [b];
  scene.objects = [a];
  assert.equal(evaluator.applyScene(scene, 3), false);
});
