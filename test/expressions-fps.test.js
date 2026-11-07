"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { host } = require("./expressions-plus-harness");
test("fps reads the owning sequence at frame zero and through legacy calls and reload", () => {
  let rate = 23.976;
  const { PZ, a, owner, engine } = host({ sequence: () => sequence });
  const sequence = new PZ.sequence(); sequence.properties.rate.get = () => rate; owner.parent = sequence;
  a.expression = new PZ.expression("fps");
  for (const frame of [0, 30, 1, 0]) assert.equal(a.get(frame), rate);
  assert.equal(a.expression.fn(0, 0, PZ.expression.methods, {}), rate);
  assert.equal(a.expression.fn(0, 0, PZ.expression.methods, {}, null, a, 7), rate);
  assert.equal(engine.requiresSource("fps"), true);
  const saved = JSON.parse(JSON.stringify(a)); a.load(saved); assert.equal(a.get(0), rate);
  const duplicate = PZ.property.create(a.definition); duplicate.parent = a.parent; duplicate.load(saved);
  assert.equal(duplicate.get(0), rate);
  rate = 60; assert.equal(a.get(0), 60); assert.equal(a.expression.fn(0, 0, PZ.expression.methods, {}), 60);
  a.expression = new PZ.expression("var fps=9; fps"); assert.equal(a.get(0), 9);
});
