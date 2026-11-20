"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

test("resource policy ignores bypassed unsupported effects during isolated capture", async () => {
  const Policy = require("../zoidium/community-resource-policy.js");
  const PZ = { zoidium: { effectBypass: { bypassed: effect => effect.zoidiumBypassed === true } } };
  const policy = Policy.create({ PZ });
  let prepared = 0;
  const effect = { zoidiumBypassed: true, toJSON: () => ({ type: "unsupported" }), prepare: () => { prepared++; } };
  const layer = { toJSON: () => ({ type: 4 }), effects: [effect], objects: [] };
  assert.doesNotThrow(() => policy.assertLayer(layer));
  await policy.prepareEffect(effect, 0, {});
  assert.equal(prepared, 0);
  effect.zoidiumBypassed = false;
  assert.throws(() => policy.assertLayer(layer), /LOCAL_DEPENDENCY_UNAVAILABLE/);
});

test("serialized layer checks ignore bypassed effect data but reject active expressions", () => {
  const Policy = require("../zoidium/community-resource-policy.js");
  const PZ = { zoidium: { effectBypass: { bypassed: effect => effect.zoidiumBypassed === true } } };
  const policy = Policy.create({ PZ });
  const effect = { zoidiumBypassed: true, toJSON: () => ({ type: "unknown", zoidiumBypassed: true,
    properties: { expression: "unsupported" } }) };
  const layer = { effects: [effect], objects: [], toJSON: () => ({ type: 4, effects: [effect.toJSON()] }) };
  assert.doesNotThrow(() => policy.assertLayer(layer));
  layer.toJSON = () => ({ type: 4, properties: { expression: "unsupported" }, effects: [effect.toJSON()] });
  assert.throws(() => policy.assertLayer(layer), /LOCAL_DEPENDENCY_UNAVAILABLE/);
});
