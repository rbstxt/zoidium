"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { nativeHost } = require("./expressions-plus-harness.js");
const { records } = require("../plugins/node-effect/parameters.js");

function serializedParameter(PZ, type, value, edited) {
  const property = PZ.property.create({ custom: true, dynamic: true, type, value, zoidiumDefault: value });
  property.load();
  property.properties.name.set("ne_parameter");
  property.set(edited || value, 0);
  return JSON.parse(JSON.stringify(property));
}
function update(kind, value, saved) {
  return records({ parameters: [{ uniform: "ne_parameter", label: "Parameter", kind, value }] }, [saved])[0];
}
function values(record) { return record.objects.map(axis => axis.keyframes[0].value); }

test("native Color and Vector2 defaults follow changes until edited", () => {
  const { PZ } = nativeHost();
  for (const [kind, type, before, after, edited] of [
    [1, 4, [1, .5, .25], [.2, .3, .4], [1, .6, .25]],
    [2, 1, [.2, .3], [.8, .9], [.2, .6]],
  ]) {
    const untouched = serializedParameter(PZ, type, before);
    assert.deepEqual(values(update(kind, after, untouched)), after);
    const modified = serializedParameter(PZ, type, before, edited);
    assert.deepEqual(values(update(kind, after, modified)), edited);
  }
  // Node Effect does not expose Vector3, but CM3 serializes it as scalar axes too.
  assert.deepEqual(values(serializedParameter(PZ, 2, [.1, .2, .3])), [.1, .2, .3]);
});

test("array-valued keyframes follow defaults only when unchanged", () => {
  for (const [kind, type, before, after, edited] of [
    [1, 4, [1, .5, .25], [.2, .3, .4], [1, .6, .25]],
    [2, 1, [.2, .3], [.8, .9], [.2, .6]],
  ]) {
    const base = { type: { type, zoidiumDefault: before }, properties: { name: "ne_parameter" },
      animated: false, keyframes: [{ value: before, frame: 0 }] };
    assert.deepEqual(update(kind, after, base).keyframes[0].value, after);
    const modified = { ...base, keyframes: [{ value: edited, frame: 0 }] };
    assert.deepEqual(update(kind, after, modified).keyframes[0].value, edited);
  }
});
