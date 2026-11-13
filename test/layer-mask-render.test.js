"use strict";
// Mask renderer pure seams: layer classification, coverage sizing and
// JSON-driven evaluation. The compositor wrapper itself is browser-tested.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { PZ } = require("./shape-plus-host.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const { maskable, coverageSize, evaluateMasks, MAX_COVERAGE_SIDE } = require("../plugins/shape-plus/mask-render.js");

PZ.layer = { scene: class Scene {}, adjustment: class Adjustment {}, texture: class Texture {} };

function mask(id, mode = "add") {
  return {
    id, kind: "path", mode, feather: 0, opacity: 1, invert: 0,
    vertexIds: ["a", "b", "c", "d"],
    vertexModes: {},
    properties: {
      name: "Mask " + id, enabled: 1, closed: 1,
      path: { animated: false, keyframes: [{ frame: 0, value: [0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0, 0, 10, 0, 0, 0, 0], tween: 1 }] },
    },
  };
}

test("only Scene and Adjustment layers are maskable", () => {
  assert.equal(maskable(PZ, new PZ.layer.scene()), true);
  assert.equal(maskable(PZ, new PZ.layer.adjustment()), true);
  assert.equal(maskable(PZ, new PZ.layer.texture()), false);
  assert.equal(maskable(PZ, null), false);
  assert.equal(maskable(PZ, { effects: [] }), false);
});

test("coverage size keeps aspect and caps the long side", () => {
  assert.deepEqual(coverageSize([1920, 1080]), { width: 1920, height: 1080, scale: 1 });
  assert.deepEqual(coverageSize([0, 0]), { width: 1, height: 1, scale: 1 });
  const big = coverageSize([8192, 4096]);
  assert.equal(Math.max(big.width, big.height), MAX_COVERAGE_SIDE);
  assert.ok(Math.abs(big.width / big.height - 2) < 0.01);
});

test("evaluation reads geometry and params from persisted JSON", () => {
  const { Content } = createModel(PZ);
  const evaluated = evaluateMasks(Content, [mask("m1", "subtract"), { ...mask("m2"), properties: { ...mask("m2").properties, enabled: 0 } }], 0);
  assert.equal(evaluated.length, 2);
  assert.equal(evaluated[0].mode, "subtract");
  assert.equal(evaluated[0].enabled, true);
  assert.equal(evaluated[0].vertices.length, 4);
  assert.equal(evaluated[1].enabled, false);
});

test("evaluation fails loudly on corrupt items", () => {
  const { Content } = createModel(PZ);
  assert.throws(() => evaluateMasks(Content, [{ id: "bad", kind: "group", contents: [] }], 0), /mask item/);
});
