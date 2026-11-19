"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildEnv } = require("./optical-flares-fixture.js");

function createFlare() {
  const { PZ } = buildEnv();
  const flare = new PZ.object3d.optflares();
  flare.type = 13;
  flare.load({ objectType: 1 });
  return flare;
}

function state(flare) {
  flare.update(0);
  return {
    occlude: flare._frame.occlude,
    gpu: flare.material.uniforms.uGpu.value,
    dataA: Array.from(flare._dataA),
    dataB: Array.from(flare._dataB),
    dataD: Array.from(flare._dataD),
    count: flare.material.uniforms.uElementCount.value,
  };
}

test("animated flare options produce the same state for numeric and string keys", () => {
  for (const select of [
    f => f.properties.positioning.foreground.occlude,
    f => f.properties.flareSetup.gpu,
    f => f.properties.global.scaleOffset,
    f => f.properties.flareSetup.scaleOffset,
    f => f.stack[1].properties.element.solo,
    f => f.stack[1].properties.globalParams.scaleOffset,
    f => f.stack[1].properties.element.animate,
    f => f.stack[1].properties.element.enabled,
  ]) {
    const flare = createFlare();
    flare.stack[1].properties.element.distance.set(100);
    const property = select(flare);
    for (const value of [0, 1]) {
      property.set(value);
      const expected = state(flare);
      property.set(String(value));
      assert.deepEqual(state(flare), expected);
      assert.equal(property.get(), String(value));
    }
  }
});
