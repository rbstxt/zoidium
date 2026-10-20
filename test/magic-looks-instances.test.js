"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const model = require("../plugins/magic-looks/looks-instances.js");
const Looks = {};
for (const file of ["looks-color.js", "looks-tools.js"]) {
  new Function("Looks", fs.readFileSync(require.resolve("../plugins/magic-looks/" + file), "utf8"))(Looks);
}
const tools = Looks.tools;
const reference = require("../plugins/magic-looks/looks-instance-reference.js");
const compiler = require("../plugins/magic-looks/looks-passes.js");
test("duplicates have stable independent identities through reorder and removal", () => {
  let state = model.append(model.empty(), "curves", tools);
  state = model.append(state, "lens-distortion", tools);
  state = model.append(state, "curves", tools);
  const before = model.clone(state);
  const moved = model.move(state, "i2", 0, tools);
  assert.deepEqual(moved.order.map(item => item.id), ["i2", "i1", "i3"]);
  assert.deepEqual(state, before);
  state = model.remove(moved, "i1", tools);
  state = model.append(state, "curves", tools);
  assert.deepEqual(state.order.map(item => item.id), ["i2", "i3", "i4"]);
  assert.notEqual(model.key("i3", "curvCurvesJson"), model.key("i4", "curvCurvesJson"));
  assert.deepEqual(model.validate(JSON.parse(JSON.stringify(state)), tools), state);
});
test("pass planning merges repeated pointwise tools and isolates every spatial input", () => {
  let state = model.empty();
  for (const tool of ["curves", "curves", "lens-distortion", "contrast", "diffusion", "vignette", "lut"]) {
    state = model.append(state, tool, tools);
  }
  assert.deepEqual(model.plan(state.order).map(pass => pass.instances.map(item => item.tool)),
    [["curves", "curves"], ["lens-distortion"], ["contrast"], ["diffusion"], ["vignette"], ["lut"]]);
  assert.deepEqual(model.plan(state.order, item => item.tool !== "lens-distortion")[0].instances.map(item => item.tool),
    ["curves", "curves", "contrast"]);
});
test("unmarked saved formats always retain legacy rendering", () => {
  for (const properties of [{}, { chainOrder: "[]" }, { vigStrength: 1 }]) {
    assert.equal(model.mode({ type: "looks", properties }), "legacy");
  }
  assert.equal(model.mode(undefined), "instances");
  assert.equal(model.mode({ properties: {}, looksInstances: model.empty() }), "instances");
});
test("invalid schemas, repeated IDs and excessive chains are rejected", () => {
  for (const value of [{}, { version: 2, order: [] },
    { version: 1, order: [{ id: "../x", tool: "curves" }] },
    { version: 1, order: [{ id: "i1", tool: "curves" }, { id: "i1", tool: "curves" }] },
    { version: 1, order: [{ id: "i1", tool: "missing" }] }]) {
    assert.throws(() => model.validate(value, tools));
  }
  let state = model.empty();
  for (let i = 0; i < model.MAX_INSTANCES; i++) state = model.append(state, "curves", tools);
  assert.throws(() => model.append(state, "curves", tools));
});

test("pointwise fusion respects sampler and uniform budgets", () => {
  const order = Array.from({ length: 40 }, (_, index) => ({ id: "i" + (index + 1), tool: "lut" }));
  const passes = model.plan(order);
  assert.equal(passes.length, 20);
  assert.ok(passes.every(pass => pass.samplers <= 6 && pass.instances.length <= 8));
});
test("compiled Curves instances have separate uniforms and omit unrelated dispatch", () => {
  const shader = compiler.compile(fs.readFileSync(require.resolve("../plugins/magic-looks/looks-grade.glsl"), "utf8"),
    [{ id: "i1", tool: "curves" }, { id: "i3", tool: "curves" }], tools);
  assert.match(shader, /fxCurv_i1\(c,uv\)/);
  assert.match(shader, /fxCurv_i3\(c,uv\)/);
  assert.match(shader, /uCurvesLUT_i1/);
  assert.match(shader, /uCurvesLUT_i3/);
  assert.doesNotMatch(shader, /vec3 fxDif/);
  assert.doesNotMatch(shader, /lkApply/);
  assert.match(shader, /mlInputStraight/);
  assert.match(shader, /mlOutputStraight/);
});
test("CPU reference applies repeated tools independently and converts alpha once", () => {
  const state = tools.defaultToolState(tools.byId("contrast")); state.p.exposure = 1;
  const instances = [{ tool: "contrast", state }, { tool: "contrast", state }];
  assert.deepEqual(reference.gradeImage([.1, .15, .2, .5], 1, 1, instances, Looks), [.4, .5, .5, .5]);
  assert.deepEqual(reference.gradeImage([0, 0, 0, 0], 1, 1, instances, Looks), [0, 0, 0, 0]);
});
test("CPU spatial stages sample the output of the preceding grade", () => {
  const contrast = tools.defaultToolState(tools.byId("contrast")); contrast.p.exposure = 1;
  const diffusion = tools.defaultToolState(tools.byId("diffusion")); diffusion.p.glow = .4; diffusion.p.highlightsOnly = .4;
  const input = Array.from({ length: 8 * 8 }, (_, i) => [.2 + (i % 8) * .05, .1, .1, 1]).flat();
  const a = reference.gradeImage(input, 8, 8, [{ tool: "contrast", state: contrast }, { tool: "diffusion", state: diffusion }], Looks);
  const b = reference.gradeImage(input, 8, 8, [{ tool: "diffusion", state: diffusion }, { tool: "contrast", state: contrast }], Looks);
  assert.ok(a.some((value, index) => Math.abs(value - b[index]) > .01));
  assert.deepEqual(reference.gradeImage(input, 8, 8, [{ tool: "diffusion", state: diffusion, enabled: false }], Looks), input);
});
