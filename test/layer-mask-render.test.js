"use strict";
// Mask renderer pure seams: layer classification, coverage sizing and
// JSON-driven evaluation. The compositor wrapper itself is browser-tested.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { PZ } = require("./shape-plus-host.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const { installMaskRender, coverageSize, evaluateMasks, maskable, maskFrameFor, MAX_COVERAGE_SIDE } = require("../plugins/shape-plus/mask-render.js");
const { FIELD, FRAME_KEY } = require("../plugins/shape-plus/mask-model.js");

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

test("mask frame prefers the temporal mapping over the stashed frame", () => {
  // Retimed layers render content at the mapping's source frame while the
  // update wrapper stashes the local frame; masks track the content.
  const layer = { [FRAME_KEY]: 7, __zoidiumTemporalSequenceMapping: { sourceFrame: 5, localFrame: 7 } };
  assert.equal(maskFrameFor(layer), 5);
  assert.equal(maskFrameFor({ [FRAME_KEY]: 7 }), 7);
  assert.equal(maskFrameFor({ [FRAME_KEY]: 7, __zoidiumTemporalSequenceMapping: { sourceFrame: NaN, localFrame: 7 } }), 7);
  assert.equal(maskFrameFor({}), undefined);
});

test("Layer Input stages skip layer masks regardless of wrapper order", () => {
  const { Content } = createModel(PZ);
  const api = installMaskRender({ PZ, THREE: {}, Content, onDispose() {} });
  const layer = new PZ.layer.scene();
  // Corrupt masks would warn and bail under the default stage; a
  // non-default Layer Input stage must skip before touching them, so the
  // Masks/Source capture semantics hold no matter which plugin wrapped
  // renderEffects last.
  const badMasks = () => {
    layer[FIELD] = [{ id: "bad", kind: "group", contents: [] }];
    layer[FRAME_KEY] = 0;
    layer.effects = { parentObject: layer };
  };
  const warnings = [];
  const consoleWarn = console.warn;
  console.warn = message => warnings.push(String(message));
  const compositorFor = mode => ({ __zoidiumLayerInputMode: mode });
  try {
    badMasks();
    assert.equal(api.applyMasks(compositorFor("masks"), layer.effects, { x: 1, y: 1 }), undefined);
    assert.equal(api.applyMasks(compositorFor("source"), layer.effects, { x: 1, y: 1 }), undefined);
    assert.deepEqual(warnings, []);
    // The default stage still evaluates (and warns on the corrupt stack;
    // warnOnce dedupes identical messages, so one warning covers both).
    badMasks();
    assert.equal(api.applyMasks(compositorFor("effects-masks"), layer.effects, { x: 1, y: 1 }), undefined);
    const second = new PZ.layer.scene();
    second[FIELD] = [{ id: "bad", kind: "group", contents: [] }];
    second[FRAME_KEY] = 0;
    second.effects = { parentObject: second };
    assert.equal(api.applyMasks(compositorFor(undefined), second.effects, { x: 1, y: 1 }), undefined);
    assert.ok(warnings.length >= 1, "default stage evaluates, got " + JSON.stringify(warnings));
  } finally {
    console.warn = consoleWarn;
  }
});
