"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const { host } = require("./helpers/temporal-sampler-host.cjs");

test("bypassed samplers do not force deep cache depth", () => {
  const h = host(false);
  h.PZ.zoidium = { effectBypass: { bypassed: effect => effect.zoidiumBypassed === true } };
  const prefix = { _zoidiumFrameSampler: {}, zoidiumBypassed: true };
  h.source.effects = [prefix, { update() {} }];
  assert.equal(h.parts.sampler.frameSamplerCacheDepth({ layer: h.source, effectIndex: 1 }, 3), 1);
  prefix.zoidiumBypassed = false;
  assert.equal(h.parts.sampler.frameSamplerCacheDepth({ layer: h.source, effectIndex: 1 }, 3), 3);

  Object.setPrototypeOf(h.source, h.PZ.layer.composite.prototype);
  const child = { effects: [{ _zoidiumFrameSampler: {}, zoidiumBypassed: true }] };
  h.source.objects = [child];
  h.source.effects = [{ update() {} }, { update() {} }];
  assert.equal(h.parts.sampler.frameSamplerCacheDepth({ layer: h.source, effectIndex: 1 }, 3), 1);
  child.effects[0].zoidiumBypassed = false;
  assert.equal(h.parts.sampler.frameSamplerCacheDepth({ layer: h.source, effectIndex: 1 }, 3), 3);
});
