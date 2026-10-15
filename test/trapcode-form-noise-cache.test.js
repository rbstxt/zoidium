"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSuite } = require("./trapcode-env");
function setup() {
  const { PZ } = loadSuite(["trapcode-common.js", "particular.js", "form.js"]);
  return PZ.trapcode.formSampling.smoothNoise;
}
test("Form corner cache matches shared noise bit for bit on coherent and scattered samples", () => {
  const noise = setup(), reference = global.ZoidiumPluginApis.random.formSmoothNoise;
  for (let i = 0; i < 20000; i++) {
    const x = Math.sin(i * 7.13) * 100, y = Math.sin(i * 3.7) * 17, z = Math.cos(i * 1.11) * 9;
    const seed = (i % 13) * 17.3 - 90;
    assert.equal(noise(x,y,z,seed), reference(x,y,z,seed));
    assert.equal(noise(x+0.001,y+0.001,z+0.001,seed), reference(x+0.001,y+0.001,z+0.001,seed));
  }
  for (const x of [-0,0,-1,1,1e12,-1e30,Infinity,-Infinity,NaN]) {
    for (const seed of [-0,0,1.3,1e20,NaN,Infinity,undefined,"3"]) {
      assert.equal(noise(x,x,x,seed), reference(x,x,x,seed));
    }
  }
});
test("Form cache checks every full coordinate and seed and survives slot collisions", () => {
  const noise = setup(), reference = global.ZoidiumPluginApis.random.formSmoothNoise;
  const inputs = [[0.2,0.3,0.4,17.3],[1.2,0.3,0.4,17.3],[0.2,1.3,0.4,17.3],
    [0.2,0.3,1.4,17.3],[0.2,0.3,0.4,17.4],[4096.2,0.3,0.4,17.3],
    [0.2,4096.3,0.4,17.3],[0.2,0.3,4096.4,17.3],[0.2,0.3,0.4,4113.3]];
  for (const samples of [inputs, inputs.slice().reverse(), inputs]) for (const args of samples) {
    assert.equal(noise(...args), reference(...args));
  }
});
test("Form cache reuses corners while recomputing interpolation for each fractional position", () => {
  const noise = setup(), random = global.ZoidiumPluginApis.random;
  const original = random.formHash3;
  let calls = 0;
  random.formHash3 = (...args) => { calls++; return original(...args); };
  try {
    const first = noise(0.1,0.2,0.3,27.9);
    const second = noise(0.2,0.3,0.4,27.9);
    assert.equal(calls,8);
    assert.notEqual(first,second);
    assert.equal(second,random.formSmoothNoise(0.2,0.3,0.4,27.9));
    noise(1.2,0.3,0.4,27.9); assert.equal(calls,16);
    noise(1.2,0.3,0.4,28.9); assert.equal(calls,24);
  } finally { random.formHash3 = original; }
});
