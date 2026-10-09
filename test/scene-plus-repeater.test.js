"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { _test } = require("../plugins/scene-plus/scene-plus.js");

const PZ = { property: { type: { NUMBER: 0, VECTOR3: 2 } } };
const PZ_REPEATER = { ...PZ, object3d: { group: class {} } };

test("rotation vectors apply the degree-to-radian scale on every axis", () => {
  const linear = _test.makeProperties(PZ, "linear", () => {});
  const step = _test.makeProperties(PZ, "step", () => {});
  const random = _test.makeProperties(PZ, "random", () => {});
  const scale = Math.PI / 180;

  for (const definition of [
    linear.rotationEnd,
    step.rotationStep,
    random.rotationMin,
    random.rotationMax,
  ]) {
    assert.equal(definition.scaleFactor, scale, definition.name + " group scale");
    for (const axis of definition.objects) {
      assert.equal(axis.scaleFactor, scale, definition.name + " axis scale");
    }
  }
});

test("the default Linear Repeater rotation end is 90 degrees in radians", () => {
  const linear = _test.makeProperties(PZ, "linear", () => {});
  const values = linear.rotationEnd.objects.map((axis) => axis.value);
  assert.deepEqual(values, [0, 0, Math.PI / 2]);
  assert.ok(Math.abs((values[2] * 180) / Math.PI - 90) < 1e-9);
});

test("non-rotation vectors do not gain a scale factor", () => {
  const linear = _test.makeProperties(PZ, "linear", () => {});
  for (const definition of [linear.positionEnd, linear.scaleEnd]) {
    assert.equal(definition.scaleFactor, undefined);
    for (const axis of definition.objects) {
      assert.equal(axis.scaleFactor, undefined);
    }
  }
});

function shapeStub(objectType, name) {
  return {
    objectType,
    defaultName: "Shape",
    properties: {
      geometryProperties: {},
      name: {
        _value: name,
        get() { return this._value; },
        set(value) { this._value = value; },
      },
    },
  };
}

test("a freshly added repeater source shape is named after its kind", () => {
  const Repeater = _test.createRepeaterClass(PZ_REPEATER, {}, "linear", "zoidium:repeater/linear-repeater");
  const repeater = Object.create(Repeater.prototype);
  const box = shapeStub(1, "Shape");
  const sphere = shapeStub(5, "Shape");
  repeater.objects = [box, sphere];

  repeater.nameAddedSourceShapes();

  assert.equal(box.properties.name.get(), "Box");
  assert.equal(sphere.properties.name.get(), "Sphere");
});

test("saved source shapes keep their stored names", () => {
  const Repeater = _test.createRepeaterClass(PZ_REPEATER, {}, "linear", "zoidium:repeater/linear-repeater");
  const repeater = Object.create(Repeater.prototype);
  const restored = shapeStub(1, "Shape");
  restored.__zoidiumSourceFromData = true;
  const custom = shapeStub(5, "My sphere");
  repeater.objects = [restored, custom];

  repeater.nameAddedSourceShapes();

  assert.equal(restored.properties.name.get(), "Shape");
  assert.equal(custom.properties.name.get(), "My sphere");
});

test("non-shape children and the generic shape kind are left alone", () => {
  const Repeater = _test.createRepeaterClass(PZ_REPEATER, {}, "linear", "zoidium:repeater/linear-repeater");
  const repeater = Object.create(Repeater.prototype);
  const generic = shapeStub(0, "Shape");
  const group = { properties: { name: { _value: "Group", get() { return this._value; }, set(v) { this._value = v; } } } };
  repeater.objects = [generic, group];

  repeater.nameAddedSourceShapes();

  assert.equal(generic.properties.name.get(), "Shape");
  assert.equal(group.properties.name.get(), "Group");
});

test("nameNewSourceShapes names effector source shapes as well", () => {
  const box = shapeStub(1, "Shape");
  const cylinder = shapeStub(2, "Shape");
  const restored = shapeStub(5, "Shape");
  restored.__zoidiumSourceFromData = true;
  _test.nameNewSourceShapes([box, cylinder, restored]);

  assert.equal(box.properties.name.get(), "Box");
  assert.equal(cylinder.properties.name.get(), "Cylinder");
  assert.equal(restored.properties.name.get(), "Shape");
});
