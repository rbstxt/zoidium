"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { lint, declareUniform, transformedMap, diagnostics, checkShader } = require("../plugins/shader-plus/code-check.js");
const { symbols, completions } = require("../plugins/shader-plus/code-assist.js");
const prop = (name, kind, type = 0) => ({ definition: { type, dynamic: type === 0, zoidiumShader: { kind } }, properties: { name: { get: () => name } } });
const layerSource = name => ({ definition: { type: 10, _zoidiumShaderLayerSource: true }, properties: { name: { get: () => name } } });
test("uniform lint suggests declarations, catches unmatched uniforms and kinds, accepts int/bool NUMBER bindings", () => {
  const fx = { customProperties: [prop("Enabled", "checkbox"), prop("Ramp", "gradient", 7), prop("Colors", "palette", 7)] };
  const source = "precision highp float;\nuniform vec3 Enabled;\nuniform vec4 Colors[16];\nuniform int Colors_count;\nuniform float Typo;\n// uniform float Ramp;";
  const hints = lint(source, fx, symbols(fx));
  assert.ok(hints.some(h => h.message.includes("Enabled expects bool or int or float") && h.line === 2));
  assert.ok(hints.some(h => h.declare === "uniform sampler2D Ramp;"));
  assert.ok(hints.some(h => h.message.startsWith("Typo has no matching")));
  assert.ok(!hints.some(h => h.message.startsWith("Colors")));
  assert.deepEqual(lint("uniform bool Enabled; uniform sampler2D Ramp; uniform vec4 Colors[16];", fx, symbols(fx)), []);
});
test("lint ignores static defines and commented declarations and inserts after the last precision", () => {
  const fx = { customProperties: [prop("Mode", "staticDropdown", 6)] };
  assert.deepEqual(lint("#define Mode 0", fx, symbols(fx)), []);
  assert.equal(declareUniform("precision highp float;\nprecision highp int;\nvoid main(){}", "uniform float Amount;"), "precision highp float;\nprecision highp int;\nuniform float Amount;\n\nvoid main(){}");
});
test("Layer Input properties are sampler bindings while a plain static LIST stays a define", () => {
  const fx = { customProperties: [layerSource("Texture_1_Source")] }, scope = symbols(fx);
  const binding = scope.find(e => e.name === "Texture_1_Source");
  assert.equal(binding.type, "sampler2D"); assert.equal(binding.static, false);
  assert.equal(binding.signature, "uniform sampler2D Texture_1_Source;");
  assert.deepEqual(lint("precision highp float;\nuniform sampler2D Texture_1_Source;", fx, scope), []);
  const missing = lint("precision highp float;", fx, scope);
  assert.equal(missing.length, 1);
  assert.equal(missing[0].declare, "uniform sampler2D Texture_1_Source;");
  const plain = { customProperties: [prop("Texture_1_Source", null, 10)] }, plainScope = symbols(plain);
  assert.equal(plainScope.find(e => e.name === "Texture_1_Source").type, "#define");
  assert.deepEqual(lint("#define Texture_1_Source value", plain, plainScope), []);
});
test("Path properties bind only their four auxiliary uniforms", () => {
  const fx = { customProperties: [prop("Mask_Layer", "path", 7)] }, scope = symbols(fx);
  assert.deepEqual(scope.filter(e => e.name.startsWith("Mask_Layer")).map(e => e.name).sort(),
    ["Mask_LayerCount", "Mask_LayerCoverage", "Mask_LayerLength", "Mask_LayerPoints"]);
  assert.ok(!scope.some(e => e.name === "Mask_Layer"));
  const source = "precision highp float;\nuniform sampler2D Mask_LayerCoverage;\nuniform sampler2D Mask_LayerPoints;\nuniform float Mask_LayerLength;\nuniform int Mask_LayerCount;";
  assert.deepEqual(lint(source, fx, scope), []);
  assert.equal(completions("Mask_", 5, scope).find(e => e.name === "Mask_LayerCount").signature, "uniform int Mask_LayerCount;");
});
test("a property that claims a Path auxiliary uniform gets one collision hint naming both", () => {
  const fx = { customProperties: [prop("Mask_Layer", "path", 7), prop("Mask_LayerCount")] };
  const source = "precision highp float;\nuniform sampler2D Mask_LayerCoverage;\nuniform sampler2D Mask_LayerPoints;\nuniform float Mask_LayerLength;\nuniform int Mask_LayerCount;";
  const hints = lint(source, fx, symbols(fx));
  assert.deepEqual(hints, [{ line: 5, message: "Mask_LayerCount is used by both the Path Mask_Layer and the property Mask_LayerCount; rename one." }]);
});
test("diagnostics map define prefixes and expanded include lines to authored source", () => {
  const map = transformedMap("precision;\nhelper\nhelper2\nmain", [1, 2, 2, 3], "precision;\nuniform vec2 Ramp_range;\nhelper\nhelper2\nmain");
  assert.deepEqual(map, [1, 1, 2, 2, 3]);
  assert.deepEqual(diagnostics("ERROR: 0:7: 'bad' : undeclared identifier", 2, map), [{ line: 3, message: "'bad' : undeclared identifier", severity: "error" }]);
});
test("scratch checker frees shaders/program on compile failure without drawing or binding a program", () => {
  const deleted = [], shaders = [], gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader: type => ({ type }), createProgram: () => ({}), shaderSource: (s, text) => shaders.push(text), compileShader() {},
    getShaderInfoLog: s => s.type === 2 ? "ERROR: 0:3: bad" : "", getShaderParameter: s => s.type !== 2,
    deleteProgram: () => deleted.push("program"), deleteShader: s => deleted.push(s.type),
  };
  const issues = checkShader(gl, { defines: { Mode: 1 }, source: "a\nb", expanded: "a\nb", locations: [1, 2], vertexShader: "vertex" });
  assert.deepEqual(issues, [{ line: 2, message: "bad", severity: "error" }]); assert.deepEqual(deleted, ["program", 1, 2]);
  assert.equal(shaders[1], "#define Mode 1\na\nb");
});

test("actual curve include and injected range/blank lines retain the authored error line", () => {
  const { expandIncludes } = require("../plugins/core/shader-pipeline.js");
  const { helpers, bindCurveRanges } = require("../plugins/shader-plus/glsl-library.js");
  const raw = require("../plugins/shader-plus/code-templates.js").templates.find(t => t.id === "curve").source;
  const locations = [], expanded = expandIncludes(raw, helpers, locations), transformed = bindCurveRanges(expanded, new Set(["Remap"]));
  const map = transformedMap(expanded, locations, transformed);
  const line = transformed.split("\n").findIndex(l => l.includes("gl_FragColor"));
  assert.equal(map[line], 8);
  for (let i = 3; i < transformed.split("\n").findIndex(l => l.startsWith("uniform sampler2D")); i++) assert.equal(map[i], 2, "helper line " + i);
});
