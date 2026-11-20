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

test("serialized groups filter bypassed children without hiding active child expressions", () => {
  const Policy = require("../zoidium/community-resource-policy.js");
  const policy = Policy.create({ PZ: {} });
  const child = { type: 1, zoidiumBypassed: true, properties: { expression: "unsupported" } };
  const group = { type: 0, objects: [child] };
  const layer = { effects: [], objects: [], toJSON: () => ({ type: 4, effects: [group] }) };
  assert.doesNotThrow(() => policy.assertLayer(layer));
  child.zoidiumBypassed = false;
  assert.throws(() => policy.assertLayer(layer), /LOCAL_DEPENDENCY_UNAVAILABLE/);
});

test("active groups check active children but ignore bypassed expressive children", () => {
  const Policy = require("../zoidium/community-resource-policy.js");
  const PZ = { zoidium: { effectBypass: { bypassed: effect => effect.zoidiumBypassed === true } } };
  const policy = Policy.create({ PZ });
  const child = { zoidiumBypassed: true, pass: {}, toJSON() { return { type: 1,
    zoidiumBypassed: this.zoidiumBypassed, properties: { expression: "unsupported" } }; } };
  const group = { objects: [child], toJSON() { return { type: 0, objects: this.objects.map(x => x.toJSON()) }; } };
  const layer = { effects: [group], objects: [], toJSON() { return { type: 4, effects: [group.toJSON()] }; } };
  assert.doesNotThrow(() => policy.assertEffect(group));
  assert.doesNotThrow(() => policy.assertLayer(layer));
  child.zoidiumBypassed = false;
  assert.throws(() => policy.assertEffect(group), /LOCAL_DEPENDENCY_UNAVAILABLE/);
  assert.throws(() => policy.assertLayer(layer), /LOCAL_DEPENDENCY_UNAVAILABLE/);
});
