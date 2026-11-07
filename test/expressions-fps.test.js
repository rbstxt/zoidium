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
test("fps on clip Time and transforms remains finite with an expression for clip time", () => {
  const { PZ, a, owner } = host();
  const sequence = new PZ.sequence(); sequence.properties.load({ rate: 24 });
  const clip = new PZ.clip(); clip.parent = sequence; clip.properties.load(); owner.parent = clip;
  clip.properties.time.expression = new PZ.expression("fps");
  assert.equal(clip.properties.time.get(0), 24);
  assert.equal(clip.properties.time.expression.error, null);
  clip.properties.time.keyframes.forEach(key => { key.value = 3; });
  clip.properties.time.expression = new PZ.expression("time + 2");
  assert.equal(clip.properties.time.get(0), 5);
  clip.properties.time.expression = new PZ.expression("frame / 12");
  a.expression = new PZ.expression("fps + time");
  for (const frame of [0, 24, 6, 0]) {
    assert.equal(clip.properties.time.get(frame), frame / 12);
    assert.equal(a.get(frame), 24 + frame / 12);
  }
});
