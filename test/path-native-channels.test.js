"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { nativeHost } = require("./expressions-plus-harness.js");
const { create } = require("../plugins/shape-plus/path-native-channels.js");
const { PZ } = nativeHost(), adapter = create(PZ);
const channel = tween => ({ animated: false, keyframes: [
  { frame: 0, value: 3, tween: 1 }, { frame: 20, value: 19, tween },
] });
function native(data, frame) {
  const p = PZ.property.create({ name: "Test", type: 0, dynamic: true, value: 0 });
  p.load(JSON.parse(JSON.stringify(data))); return p.get(frame);
}
test("sample follows native hold, eased and disabled channel evaluation", () => {
  for (const tween of [0, 1, 2, 7, 18, 257]) for (let frame = -2; frame <= 22; frame += 0.5)
    assert.equal(adapter.sample(channel(tween), frame), native(channel(tween), frame));
  assert.throws(() => adapter.sample({ ...channel(1), expression: "frame" }, 2), /Expression/);
});
test("makeKey uses native key defaults and the incoming segment tween", () => {
  const key = adapter.makeKey(channel(7), 10, 8);
  assert.equal(key.tween, 7); assert.equal(key.frame, 10); assert.equal(key.value, 8);
  assert.deepEqual(key.controlPoints, [[-10, 0], [10, 0]]);
});
