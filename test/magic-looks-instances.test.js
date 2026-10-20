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
