"use strict";
// Shader+ Path property: the empty-value sentinel, reference handling and
// the documented example's uniform contract.
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { KINDS } = require("../plugins/shader-plus/kinds.js");
const { parseReference } = require("../plugins/shape-plus/mask-model.js");

test("removing one Path property does not dispose shared coverage", () => {
  const { installPathSampling } = require("../plugins/shader-plus/path-sample.js");
  class Texture { constructor(data) { this.image = { data }; this.disposed = false; } dispose() { this.disposed = true; } }
  class Shader { propertyRemoved() {} unload() {} }
  const shared = new Texture(new Uint8Array(4));
  const api = { parseReference: () => ({}), evaluateReference: () => ({ signature: "same", points: [], width: 1, height: 1, length: 0 }),
    toUV: () => [], coverageTexture: () => shared, releaseCoverageTexture(texture) { if (texture !== shared) texture.dispose(); } };
  const PZ = { effect: { shader: Shader }, zoidium: { layerMask: api } }, stages = [];
  installPathSampling({ PZ, THREE: { DataTexture: Texture }, patch(holder, key, wrap) { holder[key] = wrap(holder[key]); },
    pipeline: { register(stage) { stages.push(stage); return () => {}; } }, onDispose() {}, editor: () => null, report() {} });
  const property = name => ({ definition: KINDS.path.create(), get: () => "{}", properties: { name: { get: () => name } } });
  const a = property("A"), b = property("B"), effect = new Shader();
  effect.customProperties = [a, b]; effect.parentProject = {}; effect.pass = { uniforms: {} }; effect.fixPropertyName = name => name;
  stages[0].beforeUpdate.call(effect, 0);
  assert.equal(effect.pass.uniforms.ACoverage.value, shared);
  assert.equal(effect.pass.uniforms.BCoverage.value, shared);
  effect.customProperties.splice(0, 1); effect.propertyRemoved(a);
  assert.equal(shared.disposed, false);
  assert.equal(effect.pass.uniforms.BCoverage.value, shared);
});

test("mask API releases private CPU coverage but keeps cached GPU coverage", () => {
  const filename = require.resolve("../plugins/shape-plus/mask-api.js"), Module = require("node:module");
  const localRequire = Module.createRequire(filename), shared = { disposed: false, dispose() { this.disposed = true; } };
  const source = fs.readFileSync(filename, "utf8"), exports = { exports: {} };
  const gpu = { coverageTexture: () => shared, stats: () => ({}), setForceCpu() {} };
  const load = name => name === "./mask-gpu.js" ? { ...localRequire(name), sharedGpu: () => gpu } : localRequire(name);
  new Function("require", "module", "exports", source)(load, exports, exports.exports);
  class Texture { constructor(data) { this.image = { data }; this.disposed = false; } dispose() { this.disposed = true; } }
  const api = exports.exports.installMaskApi({ PZ: {}, THREE: { DataTexture: Texture }, onDispose() {} });
  const evaluated = { evaluated: [], size: { width: 1, height: 1 }, signature: "a" };
  const gpuTexture = api.coverageTexture({}, evaluated), cpuTexture = api.coverageTexture(null, evaluated);
  api.releaseCoverageTexture(gpuTexture); api.releaseCoverageTexture(cpuTexture);
  assert.equal(shared.disposed, false); assert.equal(cpuTexture.disposed, true);
});

test("Path reacquires coverage evicted by nine active signatures", () => {
  const { installMaskApi } = require("../plugins/shape-plus/mask-api.js");
  const { installPathSampling } = require("../plugins/shader-plus/path-sample.js");
  class Texture { constructor(data) { this.image = { data }; this.disposed = false; } dispose() { this.disposed = true; } }
  class Target { constructor() { this.texture = new Texture(); } dispose() { this.texture.disposed = true; } }
  class Scene { add() {} }
  class Camera { updateProjectionMatrix() {} }
  class Mesh { constructor(geometry) { this.geometry = geometry; } }
  class Material { constructor(options) { Object.assign(this, options); } dispose() {} }
  class Vector2 { constructor(x, y) { this.x = x; this.y = y; } }
  const THREE = { DataTexture: Texture, WebGLRenderTarget: Target, Scene, OrthographicCamera: Camera, Mesh,
    ShaderMaterial: Material, Vector2, PlaneGeometry: class { dispose() {} } };
  const renderer = { clearTarget() {}, extensions: { get: () => true } };
  class Shader { propertyRemoved() {} unload() {} }
  const PZ = { effect: { shader: Shader }, zoidium: {} }, stages = [];
  const api = installMaskApi({ PZ, THREE, onDispose() {} });
  api.parseReference = value => value;
  api.evaluateReference = (_project, ref) => ({ signature: ref, evaluated: [], size: { width: 1, height: 1 }, points: [], width: 1, height: 1, length: 0 });
  api.toUV = () => [];
  installPathSampling({ PZ, THREE, patch(holder, key, wrap) { holder[key] = wrap(holder[key]); },
    pipeline: { register(stage) { stages.push(stage); return () => {}; } }, onDispose() {},
    editor: () => ({ mainViewport: { renderer } }), report() {} });
  const properties = Array.from({ length: 9 }, (_, i) => ({ definition: KINDS.path.create(), get: () => "s" + i,
    properties: { name: { get: () => "Path" + i } } }));
  const effects = properties.map(property => {
    const effect = new Shader(); effect.customProperties = [property]; effect.parentProject = {};
    effect.pass = { uniforms: {} }; effect.fixPropertyName = name => name; return effect;
  });
  stages[0].beforeUpdate.call(effects[0], 0);
  const first = effects[0].pass.uniforms.Path0Coverage.value;
  for (const effect of effects.slice(1)) stages[0].beforeUpdate.call(effect, 0);
  assert.equal(first.disposed, true);
  // Another consumer can repopulate the same key with a different texture.
  const replacement = api.coverageTexture(renderer, api.evaluateReference({}, "s0"));
  stages[0].beforeUpdate.call(effects[0], 0);
  assert.notEqual(effects[0].pass.uniforms.Path0Coverage.value, first);
  assert.equal(effects[0].pass.uniforms.Path0Coverage.value, replacement);
  assert.equal(effects[0].pass.uniforms.Path0Coverage.value.disposed, false);
  assert.equal(api.coverageStats().misses, 10);
  api.setForceCpu(true);
  const cpuEffect = effects[1]; properties[1].get = () => "cpu";
  stages[0].beforeUpdate.call(cpuEffect, 0);
  const cpu = cpuEffect.pass.uniforms.Path1Coverage.value;
  stages[0].beforeUpdate.call(cpuEffect, 0);
  assert.equal(cpuEffect.pass.uniforms.Path1Coverage.value, cpu);
  cpuEffect.propertyRemoved(properties[1]); assert.equal(cpu.disposed, true);
  api.setForceCpu(false);
});

test("Path defaults to JSON null, which parses to a missing source", () => {
  // Native history redo of a TEXT empty-string write restores the
  // definition instead of the value (a host bug reproduced in isolation),
  // so the kind defaults to JSON "null" and never writes "".
  assert.equal(KINDS.path.create().value, "null");
  assert.equal(parseReference(KINDS.path.create().value), null);
});

test("a resolved Path binds Count as an integer uniform with the point count", () => {
  const { installPathSampling } = require("../plugins/shader-plus/path-sample.js");
  class Texture { constructor(data) { this.image = { data }; this.disposed = false; } dispose() { this.disposed = true; } }
  class Shader { propertyRemoved() {} unload() {} }
  const shared = new Texture(new Uint8Array(4));
  const api = { parseReference: () => ({}),
    evaluateReference: () => ({ signature: "bound", evaluated: [], size: { width: 10, height: 10 }, points: [], width: 10, height: 10, length: 5 }),
    toUV: () => [[0, 0], [0.5, 0.5], [1, 1]], coverageTexture: () => shared, releaseCoverageTexture() {} };
  const PZ = { effect: { shader: Shader }, zoidium: { layerMask: api } }, stages = [];
  installPathSampling({ PZ, THREE: { DataTexture: Texture }, patch(holder, key, wrap) { holder[key] = wrap(holder[key]); },
    pipeline: { register(stage) { stages.push(stage); return () => {}; } }, onDispose() {}, editor: () => null, report() {} });
  const property = { definition: KINDS.path.create(), get: () => "{}", properties: { name: { get: () => "Mask_Layer" } } };
  const effect = new Shader();
  effect.customProperties = [property]; effect.parentProject = {}; effect.pass = { uniforms: {} }; effect.fixPropertyName = name => name;
  stages[0].beforeUpdate.call(effect, 0);
  assert.equal(effect.pass.uniforms.Mask_LayerCount.type, "i");
  assert.equal(effect.pass.uniforms.Mask_LayerCount.value, 3);
  assert.equal(effect.pass.uniforms.Mask_LayerLength.value, 0.5);
});

test("documented glow example binds only uniforms the host provides", () => {
  // The host binds <Name>Coverage, <Name>Points, <Name>Length and
  // <Name>Count (path-sample.js bind). The flagship example once gated its
  // glow on GlowCount, which is never set and renders nothing; this pins
  // the whole example contract for EN and JA.
  for (const file of ["docs/shader-properties.md", "docs/ja/shader-properties.md"]) {
    const text = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const block = text.slice(text.indexOf("Example: draw a glow") > 0 ? text.indexOf("Example: draw a glow") : text.indexOf("例: パスに沿ったグロー"));
    const fence = block.slice(block.indexOf("```glsl"));
    const source = fence.slice("```glsl".length, fence.indexOf("```", "```glsl".length));
    const declared = [...source.matchAll(/uniform\s+\w+\s+(\w+)\s*;/g)].map(m => m[1]);
    const bound = ["Coverage", "Points", "Length", "Count"].map(suffix => "GlowPath" + suffix);
    for (const name of declared.filter(name => name.startsWith("Glow"))) {
      assert.ok(bound.includes(name), file + ": " + name + " is not bound by the host");
    }
    assert.ok(declared.includes("GlowPathCoverage"), file + ": example must sample coverage");
    assert.ok(declared.includes("GlowPathPoints"), file + ": example must sample points");
    assert.ok(declared.includes("GlowPathCount"), file + ": example must gate on the bound count");
    // Balanced braces keep the snippet compiling; the browser probe draws
    // the exact example and asserts a non-empty glow.
    assert.equal((source.match(/{/g) || []).length, (source.match(/}/g) || []).length, file + ": unbalanced braces");
  }
});
