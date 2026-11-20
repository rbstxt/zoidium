"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { nativeHost } = require("./expressions-plus-harness.js");
const { resourceCounter } = require("./helpers/resource-counter.js");

test("S_Glow releases allocations after a default draw", async () => {
  const { PZ, THREE, context } = nativeHost();
  const counter = resourceCounter();
  for (const name of ["ShaderMaterial", "PlaneBufferGeometry", "WebGLRenderTarget"]) THREE[name] = counter.track(THREE[name], name);
  context.queueMicrotask = queueMicrotask;
  context.ZoidiumPluginApis = { gl: { createRenderTarget: (T, w, h, options) => new T.WebGLRenderTarget(w, h, options) } };
  context.effect = new PZ.effect();
  const source = fs.readFileSync(path.join(__dirname, "../plugins/sglow-hq-v2-preview/effects/sglow-hq-v2-preview.js"), "utf8");
  vm.runInContext(`(function(){${source}\n}).call(effect)`, context);
  await context.effect.load();
  context.effect.update(0);
  const renderer = { getContext: () => ({ isContextLost: () => false }), extensions: { get: () => null },
    getClearColor: () => ({ clone() { return this; } }), getClearAlpha: () => 1,
    setClearColor() {}, render() {}, setRenderTarget() {}, getRenderTarget: () => null };
  context.effect.pass.render(renderer, {}, { width: 32, height: 32, texture: {} });
  // setSize can dispose target storage before it is reused at the new size.
  counter.reset();
  context.effect.unload();
  counter.assertDisposed();
});

test("S_Glow applies half the atmosphere amplitude in its render pass", async () => {
  const { PZ, THREE, context } = nativeHost();
  context.queueMicrotask = queueMicrotask;
  context.ZoidiumPluginApis = { gl: { createRenderTarget: (T, w, h, options) => new T.WebGLRenderTarget(w, h, options) } };
  context.effect = new PZ.effect();
  const source = fs.readFileSync(path.join(__dirname, "../plugins/sglow-hq-v2-preview/effects/sglow-hq-v2-preview.js"), "utf8");
  vm.runInContext(`(function(){${source}\n}).call(effect)`, context);
  await context.effect.load();
  context.effect.update(0);
  context.effect.cached.atmosphereAmp = 0.8;
  const renderer = { getContext: () => ({ isContextLost: () => false }), extensions: { get: () => null },
    getClearColor: () => ({ clone() { return this; } }), getClearAlpha: () => 1,
    setClearColor() {}, render() {}, setRenderTarget() {}, getRenderTarget: () => null };
  context.effect.pass.render(renderer, {}, { width: 32, height: 32, texture: {} });
  assert.equal(context.effect.compositeMat.uniforms.uAtmosAmp.value, 0.4);
  context.effect.unload();
});
