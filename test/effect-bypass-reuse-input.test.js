"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { host } = require("./helpers/temporal-sampler-host.cjs");

test("bypassed first effect disables adjustment input reuse", () => {
  const h = host(true);
  h.owner.effects = [h.effect, { add: 100, update() {} }];
  h.effect._zoidiumFrameSampler.getRequest = () => ({ enabled: true, reuseCurrentInput: true, frames: [-1, 0] });
  h.PZ.zoidium = { effectBypass: { bypassed: effect => effect.zoidiumBypassed === true } };
  const frame = 30;
  const stage = h.parts.layers.findFrameSamplerStage(h.sequence, h.effect, frame);
  assert.equal(stage.effectIndex, 0);
  const runtime = h.parts.sampler.getFrameSamplerRuntime(h.state, h.root);
  const revision = h.parts.layers.frameSamplerInputKey(h.sequence, h.root, stage, undefined, false);
  const target = {
    width: 80, height: 40, viewport: { z: 80, w: 40 },
    inputStamp: {}, texture: { target: { value: 1 } },
  };
  runtime.prepared.set(h.effect, {
    depth: 1,
    scope: undefined,
    projectFrame: frame,
    samples: [
      { frame: frame - 1, target: { width: 80, height: 40, viewport: { z: 80, w: 40 }, inputStamp: {} } },
      { frame, stamp: target.inputStamp, target },
    ],
    revision,
  });

  const before = h.root.renderEffects;
  const restore = h.parts.preview.reusePreparedAdjustmentInput(h.viewport, runtime, frame);
  assert.notEqual(h.root.renderEffects, before);
  h.root.renderEffects(h.owner.effects);
  assert.equal(runtime.reusedCurrentInputs, 1);
  restore();
  assert.equal(h.root.renderEffects, before);

  h.effect.zoidiumBypassed = true;
  const bypassedBefore = h.root.renderEffects;
  const restoreBypassed = h.parts.preview.reusePreparedAdjustmentInput(h.viewport, runtime, frame);
  assert.equal(h.root.renderEffects, bypassedBefore);
  restoreBypassed();
});
