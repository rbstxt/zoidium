"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { indentCode, shaderSymbols } = require("../plugins/shader-plus/code-model.js");
test("code editor indentation preserves multiline selection and removes only one level", () => {
  assert.deepEqual(indentCode("a\nb\nc", 0, 4), { text: "  a\n  b\nc", start: 2, end: 8 });
  assert.deepEqual(indentCode("  a\n\tb\nc", 0, 7, true), { text: "a\nb\nc", start: 0, end: 4 });
  assert.deepEqual(indentCode("ab", 1, 1), { text: "a  b", start: 3, end: 3 });
  assert.deepEqual(indentCode("a", 0, 0, true), { text: "a", start: 0, end: 0 });
});
test("shader symbol list reflects native GLSL types and texture helper bindings", () => {
  const prop = (name, type, kind) => ({ definition: { type, zoidiumShader: { kind } }, properties: { name: { get: () => name } } });
  const symbols = shaderSymbols({ customProperties: [prop("My Point", 1), prop("Life", 7, "curve"), prop("Palette", 7, "palette"), prop("Title", 7, "text")] }, { expressions: true, controls: [prop("My Slider", 0)] });
  const types = Object.fromEntries(symbols.map(p => [p.name, p.type]));
  assert.equal(types.My_Point, "vec2"); assert.equal(types.Life, "sampler2D"); assert.equal(types.Life_range, "vec2");
  assert.equal(types.Palette, "vec4[16]"); assert.equal(types.Palette_count, "int"); assert.equal(types.Title_size, "vec2");
  assert.equal(types.ctl_My_Slider, "float"); assert.equal(types.zFrame, "float"); assert.equal(types.zCurves, "vec4()");
  assert.ok(!shaderSymbols(null).some(s => s.name === "zTime"));
});
