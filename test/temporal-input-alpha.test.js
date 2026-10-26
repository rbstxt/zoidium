"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/temporal-sampler-host.cjs");

function copyFixture() {
  const h = host(false);
  h.sandbox.THREE.NoBlending = 0;
  const material = { blending: 1 };
  const scale = { set(x, y) { this.x = x; this.y = y; } };
  const compositor = { renderer: {}, copyPass: {
    material,
    uniforms: { tDiffuse: {}, opacity: {}, uvScale: { value: scale } },
    render(_renderer, output) {
      const rgba = this.uniforms.tDiffuse.value.rgba;
      output.rgba = rgba.map((value, channel) => channel === 3 || material.blending === 0
        ? value : Math.round(value * rgba[3] / 255));
    },
  } };
  return { h, compositor, material, scale, source: { texture: { rgba: [128, 64, 32, 128] } } };
}

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
  h.request.preserveInputRGB = true;
  await h.state.prepareFrameSamples(h.effect, 20, { sequence: h.sequence });
  assert.equal(h.resolve().length, 2);
  assert.deepEqual(h.copies, [true, true, false, false], "a resident matching encoding still reuses its taps");
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
