"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/temporal-sampler-host.cjs");

const { copyFixture } = require("./helpers/temporal-alpha-fixture.cjs");

test("a raw temporal copy preserves premultiplied RGB and restores the native blend mode", () => {
  const { h, compositor, material, scale, source } = copyFixture();
  const output = {};
  h.parts.sampler.copyRenderTarget(compositor, output, source, 0.5, 0.25, true);
  assert.deepEqual(output.rgba, source.texture.rgba);
  assert.equal(material.blending, 1);
  assert.equal(scale.x, 1);
  assert.equal(scale.y, 1);
  h.parts.sampler.copyRenderTarget(compositor, output, source);
  assert.deepEqual(output.rgba, [64, 32, 16, 128], "ordinary samplers retain native copy pixels");
});

test("a failed raw temporal copy restores blending and UV scale", () => {
  const { h, compositor, material, scale, source } = copyFixture();
  compositor.copyPass.render = () => {
    assert.equal(material.blending, 0);
    throw new Error("copy failed");
  };
  assert.throws(() => h.parts.sampler.copyRenderTarget(compositor, {}, source, 0.5, 0.25, true), /copy failed/);
  assert.equal(material.blending, 1);
  assert.equal(scale.x, 1);
  assert.equal(scale.y, 1);
});

function sampleFixture() {
  const h = host(false), copies = [];
  h.request = { frames: [-0.5, 0.5], preserveInputRGB: true };
  h.effect._zoidiumFrameSampler.getRequest = () => h.request;
  const original = h.parts.sampler.copyRenderTarget;
  h.parts.sampler.copyRenderTarget = function (...args) {
    copies.push(args[5]);
    return original.apply(this, args);
  };
  h.resolve = () => {
    h.owner.update(20);
    h.state.contexts.push({ rootCompositor: h.root, compositor: h.root, outputFrame: 30 });
    try { return h.state.resolveFrameSamples(h.effect); }
    finally { h.state.contexts.pop(); }
  };
  return { ...h, copies };
}

test("prepared taps distinguish preserved RGB from native copies at the same source frames", async () => {
  const h = sampleFixture();
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.resolve().length, 2);
  assert.deepEqual(h.copies, [true, true]);
  h.request.preserveInputRGB = false;
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.resolve().length, 2);
  assert.deepEqual(h.copies, [true, true, false, false], "a copy mode change cannot reuse the old tap encoding");
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.resolve().length, 2);
  assert.equal(h.copies.length, 4, "an unchanged copy mode reuses its prepared taps");
  h.request.preserveInputRGB = true;
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.resolve().length, 2);
  assert.deepEqual(h.copies.slice(-2), [true, true], "returning to raw copies cannot reuse native pixels");
});

test("synchronous capture also preserves RGB only when the request opts in", () => {
  const h = sampleFixture();
  h.sequence.videoSchedules = [];
  assert.equal(h.resolve().length, 2);
  assert.deepEqual(h.copies, [true, true]);
  h.request.preserveInputRGB = false;
  assert.equal(h.resolve().length, 2);
  assert.deepEqual(h.copies, [true, true, false, false]);
});

test("streamed shutter means cannot reuse a reduction made with a different copy mode", async () => {
  const h = sampleFixture();
  h.request.frames = Array.from({ length: 32 }, (_, i) => (i + 0.5) / 32 - 0.5);
  h.request.reduceSamples = (_renderer, output, samples) => {
    output.value = samples.reduce((sum, sample) => sum + sample.target.value, 0) / samples.length;
  };
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.resolve()[0].reducedCount, 32);
  assert.equal(h.copies.length, 32);
  assert.ok(h.copies.every(value => value === true));
  h.request.preserveInputRGB = false;
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.resolve()[0].reducedCount, 32);
  assert.equal(h.copies.length, 64);
  assert.ok(h.copies.slice(32).every(value => value === false));
});
