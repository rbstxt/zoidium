"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { host } = require("./helpers/temporal-sampler-host.cjs");

test("bypassed effects are skipped when no resource policy prepares inputs", async () => {
  const h = host(false);
  h.PZ.zoidium = { effectBypass: { bypassed: effect => effect.zoidiumBypassed === true } };
  const calls = [];
  h.owner.effects[0] = {
    update() {},
    prepare: async () => { calls.push("bypassed"); },
    zoidiumBypassed: true,
  };
  const stage = { layer: h.owner, clip: h.ownerClip, trackIndex: 0, effectIndex: 1 };
  await h.parts.sampler.prepareInputEffects(h.sequence, stage, 30, {}, null);
  assert.deepEqual(calls, []);

  h.owner.effects[0].zoidiumBypassed = false;
  h.owner.effects[0].prepare = async () => { calls.push("active"); };
  await h.parts.sampler.prepareInputEffects(h.sequence, stage, 30, {}, null);
  assert.deepEqual(calls, ["active"]);
});
