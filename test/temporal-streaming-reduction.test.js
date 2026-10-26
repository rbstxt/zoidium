"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/temporal-sampler-host.cjs");

function setup(count, adjustment = false, offsets) {
  const h = host(adjustment), reductions = [];
  h.request = {
    frames: offsets || Array.from({ length: count }, (_, i) => (i + 0.5) / count - 0.5),
    reduceSamples(_renderer, output, samples) {
      assert.ok(samples.length === 4 || samples.length === 8);
      assert.ok(samples.every(sample => sample.target !== output));
      assert.ok(samples.every(sample => !sample.target.disposed));
      output.value = samples.reduce((sum, sample) => sum + sample.target.value, 0) / samples.length;
      reductions.push(samples.map(sample => sample.target.value));
    },
  };
  h.effect._zoidiumFrameSampler.getRequest = () => h.request;
  Object.defineProperty(h, "runtime", { get: () => h.state.frameSamplerRuntimes.get(h.root) });
  h.reductions = reductions;
  h.resolve = (frame = 30, context = {}) => {
    h.owner.update(frame - h.ownerClip.start);
    h.state.contexts.push({ rootCompositor: h.root, compositor: h.root, outputFrame: frame, ...context });
    try { return h.state.resolveFrameSamples(h.effect); }
    finally { h.state.contexts.pop(); }
  };
  return h;
}

for (const count of [32, 64]) for (const adjustment of [false, true]) {
  test(`stream ${count} taps on ${adjustment ? "adjustment" : "ordinary"} layer with bounded targets`, async () => {
    const h = setup(count, adjustment);
    await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
    const frame = h.ownerClip.start + 20;
    const samples = h.resolve(frame);
    assert.equal(samples.length, 1);
    assert.equal(samples[0].reducedCount, count);
    assert.equal(samples[0].target.value, frame + 90);
    assert.equal(h.reductions.length, count / 8 + 1);
    assert.ok(h.runtime.targets.size <= 8 + count / 8);
    assert.equal(h.runtime.targetBytes, h.runtime.targets.size * 80 * 40 * 4);
    const captures = h.decoded.length;
    await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
    assert.equal(h.decoded.length, captures, "same-frame preview reuses its reduced output");
    assert.equal(h.resolve(frame)[0].target, samples[0].target);
    for (const next of [35, 12, 37, 12, 30]) {
      await h.state.prepareFrameSamples(h.effect, next - h.ownerClip.start, { sequence: h.sequence });
      assert.equal(h.resolve(next)[0].target.value, next + 90);
      assert.ok(h.runtime.targets.size <= 8 + count / 8, "seeking does not grow the pool");
    }
    assert.equal(h.runtime.reservations.size, 0);
    const runtime = h.runtime;
    h.root.unload();
    assert.equal(runtime.targets.size, 0);
  });
}

test("synchronous fallback and repeated boundary taps retain their equal weights", () => {
  const h = setup(64, false, Array.from({ length: 64 }, (_, i) => i - 63));
  h.sequence.videoSchedules = [];
  h.owner.update = function (frame) { this.texture.frame = frame; this.frame = frame; };
  const sample = h.resolve(10)[0];
  assert.equal(sample.target.value, 100);
  assert.equal(sample.reducedCount, 64);
  assert.equal(h.reductions.length, 9);
  assert.ok(h.runtime.targets.size <= 16);
  const draws = h.reductions.length;
  assert.equal(h.resolve(10)[0].target, sample.target);
  assert.equal(h.reductions.length, draws);
  h.root.unload();
});

test("export pins preserve earlier reduced shutter clocks while later clocks prepare", async () => {
  const h = setup(64), policy = { check() {} };
  const unpin = h.parts.exportPreparation.begin(h.state, h.root);
  const results = [];
  for (const frame of [20, 20.25, 20.5]) {
    await h.state.prepareFrameSamples(h.effect, frame, { sequence: h.sequence, exportPolicy: policy });
    const sample = h.resolve(h.ownerClip.start + frame, { exportPolicy: policy })[0];
    results.push({ sample, stamp: sample.target.inputStamp, value: sample.target.value });
  }
  assert.equal(h.runtime.exportPins.size, 3, "only final reduced outputs remain pinned");
  for (const { sample, stamp, value } of results) {
    assert.equal(sample.target.inputStamp, stamp);
    assert.equal(sample.target.value, value);
  }
  unpin();
  assert.equal(h.runtime.reservations.size, 0);
  h.root.unload();
});

test("an edit, resolution change, and oracle mode invalidate the reduced cache", async () => {
  const h = setup(32);
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  const captures = h.decoded.length;
  h.parts.sampler.invalidateFrameSamplerInputs(h.runtime);
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.ok(h.decoded.length > captures);
  h.root.setSize(160, 80);
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.resolve()[0].target.width, 160);
  const before = h.decoded.length;
  h.sandbox.PZ.zoidium.debugDisableFrameSamplerInputReuse = true;
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.ok(h.decoded.length >= before + 64);
  h.root.unload();
});

test("failed reduction releases reservations and never publishes a partial preview", async () => {
  const h = setup(32);
  h.request.reduceSamples = () => { throw new Error("Synthetic reducer failure"); };
  h.sandbox.console = { ...console, error() {} };
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.runtime.reservations.size, 0);
  assert.equal(h.runtime.prepared.get(h.effect), undefined);
  await assert.rejects(h.state.prepareFrameSamples(h.effect, 20,
    { sequence: h.sequence, exportPolicy: { check() {} } }), /Synthetic reducer failure/);
  assert.equal(h.runtime.reservations.size, 0);
  h.root.unload();
});


test("quality changes release idle targets and retain pinned earlier clocks", async () => {
  const h = setup(64);
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.runtime.targets.size, 16);
  const stale = h.resolve()[0].target;
  h.request.frames = Array.from({ length: 32 }, (_, i) => (i + 0.5) / 32 - 0.5);
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.runtime.targets.size, 12);
  assert.equal(h.resolve()[0].reducedCount, 32);
  assert.ok(stale.disposed || stale.inputStamp !== h.resolve()[0].stamp);
  h.root.unload();
});

test("a cached shutter result drops idle targets from another reconstruction", async () => {
  const h = setup(32);
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  const output = h.resolve()[0].target;
  for (let i = 12; i < 40; i++) h.parts.sampler.getFrameSamplerTarget(h.runtime, h.effect, 1, i, 80, 40);
  assert.equal(h.runtime.targets.size, 40);
  const captures = h.decoded.length;
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.runtime.targets.size, 12);
  assert.equal(h.decoded.length, captures);
  assert.equal(h.resolve()[0].target, output);
  assert.equal(output.disposed, undefined);
  h.root.unload();
});
