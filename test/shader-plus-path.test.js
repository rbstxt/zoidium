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

test("Path defaults to JSON null, which parses to a missing source", () => {
  // Native history redo of a TEXT empty-string write restores the
  // definition instead of the value (a host bug reproduced in isolation),
  // so the kind defaults to JSON "null" and never writes "".
  assert.equal(KINDS.path.create().value, "null");
  assert.equal(parseReference(KINDS.path.create().value), null);
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
