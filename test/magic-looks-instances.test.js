"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const model = require("../plugins/magic-looks/looks-instances.js");
const Looks = {};
for (const file of ["looks-color.js", "looks-tools.js"]) {
  new Function("Looks", fs.readFileSync(require.resolve("../plugins/magic-looks/" + file), "utf8"))(Looks);
}
const tools = Looks.tools;
const reference = require("../plugins/magic-looks/looks-instance-reference.js");
const compiler = require("../plugins/magic-looks/looks-passes.js");
test("historical grading sources remain byte-identical to the imported renderer", () => {
  const pins = {
    "looks-grade.glsl": "9a562e72d8d91b461bab2f6d48172bf9044006796725637b02072478daabca2b",
    "looks-tools.js": "7d73e3283ea71d1b5a857eac7f0321e6b056827bdfb327f63f04482d4b62ea9e",
    "looks-color.js": "0670b62de40254a9430914cbf5368c651d031ef3266eb49ba3af8eb3510cd2d2",
    "looks-vert.glsl": "9e79c8236c95c912b1ca44ef3f369636b79dfa3427aab412f2e0de37868ad450",
  };
  for (const [file, hash] of Object.entries(pins)) {
    const source = fs.readFileSync(require.resolve("../plugins/magic-looks/davidium-" + file));
    assert.equal(crypto.createHash("sha256").update(source).digest("hex"), hash, file);
  }
});
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
test("native fractional controls retain precision without the old percent display transform", () => {
  const PZ = { property: { type: { NUMBER: 0, OPTION: 6, TEXT: 7, ASSET: 8 } }, asset: { type: { MISC: 5 } } };
  const definitions = model.definitions({ id: "i1", tool: "lens-distortion" }, tools, PZ);
  assert.ok(definitions.ml_i1_lensDistortion.decimals >= 3);
  assert.equal(definitions.ml_i1_lensDistortion.min, -1);
  assert.equal(definitions.ml_i1_lensDistortion.max, 1);
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


test("visual storage stays serialized but hidden in every instance tool", () => {
  const PZ = { property: { type: { NUMBER: 0, OPTION: 6, TEXT: 7, ASSET: 8 } }, asset: { type: { MISC: 5 } } };
  for (const tool of tools.TOOLS) {
    const definitions = model.definitions({ id: "i12", tool: tool.id }, tools, PZ);
    assert.deepEqual(Object.keys(definitions), model.toolKeys(tool.id, tools).map(key => model.key("i12", key)));
    const visible = Object.values(definitions).filter(definition => definition.visible !== false);
    assert.equal(new Set(visible.map(definition => definition.name)).size, visible.length, tool.id);
    for (const definition of Object.values(definitions)) {
      if ([PZ.property.type.TEXT, PZ.property.type.ASSET].includes(definition.type)) assert.equal(definition.visible, false);
      assert.match(definition.name, /^12 /);
    }
  }
  const lens = model.definitions({ id: "i2", tool: "lens-distortion" }, tools, PZ);
  assert.equal(lens.ml_i2_lensEnable.name, "2 Lens");
  assert.equal(lens.ml_i2_lensDistortion.name, "2 Distort");
  assert.equal(lens.ml_i2_lensFlatten.name, "2 Flatten");
  const curves = model.definitions({ id: "i1", tool: "curves" }, tools, PZ);
  assert.equal(curves.ml_i1_curvEnable.name, "1 Curves");
  assert.ok(JSON.parse(curves.ml_i1_curvCurvesJson.value).RGB);
});

test("selection preserves identity through reorder and chooses an adjacent removed row", () => {
  let state = model.empty();
  for (const tool of ["curves", "lens-distortion", "curves"]) state = model.append(state, tool, tools);
  const moved = model.move(state, "i2", 0, tools);
  assert.equal(model.selection(moved, "i2", state.order), "i2");
  assert.equal(model.selection(model.remove(state, "i2", tools), "i2", state.order), "i3");
  assert.equal(model.selection(model.remove(state, "i3", tools), "i3", state.order), "i2");
  assert.equal(model.selection(state, "missing"), "i1");
  assert.equal(model.selection(model.empty(), "i1", state.order), undefined);
});
