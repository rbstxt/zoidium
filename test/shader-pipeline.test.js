"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { forHost } = require("../plugins/core/shader-pipeline.js");
function host() {
  const calls = [];
  class Shader {
    updateFragmentShader() { calls.push("native:" + this.properties.fragShader.get()); this.pass.uniforms = { native: 1 }; }
    update(frame) { this.updateFragmentShader(); calls.push("native update:" + frame); }
  }
  const PZ = { effect: { shader: Shader } }, fx = new Shader();
  fx.properties = { fragShader: { get: () => "raw" } }; fx.pass = {};
  return { PZ, fx, calls };
}
test("one core patch orders source/native/declarations/frame stages and restores source", () => {
  const { PZ, fx, calls } = host(), api = forHost(PZ), compile = PZ.effect.shader.prototype.updateFragmentShader;
  assert.equal(forHost(PZ), api); assert.equal(PZ.effect.shader.prototype.updateFragmentShader, compile);
  const dispose = api.register({ id: "test", transformSource(source) { calls.push("transform"); return source + "+"; }, declare(source) { calls.push("declare:" + source); assert.equal(this.pass.uniforms.native, 1); }, update(frame) { calls.push("update:" + frame); } });
  fx.update(7); assert.deepEqual(calls, ["transform", "native:raw+", "declare:raw+", "native update:7", "update:7"]); assert.equal(fx.properties.fragShader.get(), "raw");
  dispose(); calls.length = 0; fx.update(8); assert.deepEqual(calls, ["native:raw", "native update:8"]);
});
test("native failure restores get even when the source property has an inherited getter method", () => {
  const { PZ, fx } = host(), api = forHost(PZ);
  api.register({ id: "test", transformSource() { return "new"; } });
  fx.properties.fragShader = Object.create({ get() { return "old"; } });
  // Fail the native material path after reading the transformed property.
  Object.defineProperty(fx.pass, "uniforms", { set() { throw Error("compile failure"); } });
  assert.throws(() => fx.update(0), /compile failure/); assert.equal(fx.properties.fragShader.get(), "old"); assert.equal(Object.hasOwn(fx.properties.fragShader, "get"), false);
});
test("include registrations change the recovery revision on add and remove", () => {
  const { PZ } = host(), api = forHost(PZ), version = api.includeVersion;
  const remove = api.registerIncludes({ test: "float f(){return 1.;}" }); assert.equal(api.includeVersion, version + 1);
  assert.match(api.expandIncludes("// #include <zoidium/test>"), /float f/); remove(); assert.equal(api.includeVersion, version + 2);
  assert.throws(() => api.expandIncludes("// #include <zoidium/test>"), /Unknown/);
});
test("preview uses native setup and registered stages on an isolated facade", () => {
  const { PZ, fx } = host(), api = forHost(PZ);
  fx.pass = { material: { vertexShader: "vertex", defines: { old: 2 } }, uniforms: { live: true } };
  api.registerIncludes({ sample: "float included;" });
  api.register({ id: "preview-stage", transformSource(s) { this.transformed = true; return s + "\nend"; }, declare() { throw Error("must use preview declaration"); }, previewDeclare() { this.pass.material.defines.Mode = 1; } });
  const snapshot = JSON.stringify(fx.pass), preview = api.preview(fx, "// #include <zoidium/sample>\nmain");
  assert.equal(preview.source, "float included;\nmain\nend"); assert.deepEqual(preview.defines, { Mode: 1 });
  assert.equal(fx.transformed, undefined); assert.equal(fx.properties.fragShader.get(), "raw"); assert.equal(JSON.stringify(fx.pass), snapshot);
  assert.deepEqual(preview.locations, [1, 2]); assert.equal(preview.vertexShader, "vertex");
});
