"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs");
const { nativeHost, core } = require("./expressions-plus-harness");
const { createPropertyStore } = require("../plugins/constraints/constraint-properties");
const { FOLLOW_KEYS } = require("../plugins/constraints/follow-properties");
const visibleKeys = object => Object.values(FOLLOW_KEYS).filter(key => object.properties[key]?.visible !== false);

test("Follow rows and values are ready before the native property-list notification", { skip: !fs.existsSync(core) }, () => {
  const { PZ } = nativeHost(), store = createPropertyStore({ PZ });
  for (const target of ["", "missing-target"]) {
    const object = new PZ.object3d.group(); object.load({ objects: [] });
    const notifications = [];
    object.properties.onListChanged.watch(() => notifications.push({
      visible: visibleKeys(object), target: object.properties[FOLLOW_KEYS.follow].get(),
      offset: Array.from(object.properties[FOLLOW_KEYS.positionOffset].get(0)),
    }));
    store.attach(object, { properties: { [FOLLOW_KEYS.follow]: target } });
    const expected = target ? Object.values(FOLLOW_KEYS).filter(key => key !== FOLLOW_KEYS.fallback) : [FOLLOW_KEYS.follow];
    assert.deepEqual(notifications, [{ visible: expected, target, offset: [0, 0, 0] }]);
    assert.deepEqual(visibleKeys(object), expected);
  }
});

test("unused Follow fields add no bytes to native object JSON while hidden edits remain saved", { skip: !fs.existsSync(core) }, () => {
  const { PZ } = nativeHost(), store = createPropertyStore({ PZ });
  const objects = Array.from({ length: 100 }, () => {
    const object = PZ.object3d.create(5); object.load({ objects: [] }); return object;
  });
  const before = JSON.stringify(objects);
  for (const object of objects) store.attach(object);
  assert.equal(JSON.stringify(objects), before);
  const object = objects[0];
  object.properties[FOLLOW_KEYS.followSpace].set(1);
  object.properties[FOLLOW_KEYS.positionOffset].objects[0].expression = new PZ.expression("value + frame");
  const saved = JSON.parse(JSON.stringify(object));
  assert.equal(saved.properties[FOLLOW_KEYS.follow], undefined);
  assert.equal(saved.properties[FOLLOW_KEYS.followSpace], 1);
  assert.equal(saved.properties[FOLLOW_KEYS.positionOffset].objects[0].expression, "value + frame");
});
