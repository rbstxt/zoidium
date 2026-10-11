"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;


test("new Character Transform objects keep the published serialized type", () => {
  const data = _test.defaultObjectData(null);
  assert.equal(data.type, _test.TEXT_PLUS_TYPE);
  assert.equal(data.schemaVersion, 5);
  assert.deepEqual(data.objects, []);
  assert.deepEqual(data.customProperties, []);
  assert.deepEqual(data.properties, { name: "Character Transform" });
  assert.deepEqual(data.characterProperties, {});
});

test("split shake and selection parents carry independent serialized types", () => {
  const definitions = [
    [
      _test.defaultCharacterShakeData,
      _test.CHARACTER_SHAKE_TYPE,
      "Character Shake",
      4,
    ],
    [
      _test.defaultSelectedTransformData,
      _test.SELECTED_TRANSFORM_TYPE,
      "Selected Character Transform",
      3,
    ],
    [
      _test.defaultSelectedShakeData,
      _test.SELECTED_SHAKE_TYPE,
      "Selected Character Shake",
      4,
    ],
  ];

  for (const [createData, type, name, schemaVersion] of definitions) {
    const data = createData(null);
    assert.equal(data.type, type);
    assert.equal(data.schemaVersion, schemaVersion);
    assert.deepEqual(data.objects, []);
    assert.deepEqual(data.customProperties, []);
    assert.deepEqual(data.properties, { name });
    assert.deepEqual(data.characterProperties, {});
  }
});

test("new Random Scatter objects carry their own serialized type", () => {
  const data = _test.defaultRandomScatterData(null);
  assert.equal(data.type, _test.RANDOM_SCATTER_TYPE);
  assert.equal(data.schemaVersion, 3);
  assert.deepEqual(data.objects, []);
  assert.deepEqual(data.customProperties, []);
  assert.deepEqual(data.properties, { name: "Random Scatter" });
  assert.deepEqual(data.characterProperties, {});
});

test("new Gradient Transform objects carry their own serialized type", () => {
  const data = _test.defaultGradientTransformData(null);
  assert.equal(data.type, _test.GRADIENT_TRANSFORM_TYPE);
  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.objects, []);
  assert.deepEqual(data.customProperties, []);
  assert.deepEqual(data.properties, { name: "Gradient Transform" });
  assert.deepEqual(data.characterProperties, {});
});

test("loaded Text+ objects keep their children and group data", () => {
  const data = _test.defaultObjectData({
    type: "zoidium:text-plus/text-plus",
    properties: { name: "Title animator", position: [1, 2, 3] },
    characterProperties: { charPosition: [4, 5, 6] },
    customProperties: [{ type: 0 }],
    objects: [{ type: 1 }],
  });
  assert.deepEqual(data.objects, [{ type: 1 }]);
  assert.deepEqual(data.customProperties, [{ type: 0 }]);
  assert.deepEqual(data.properties, {
    name: "Title animator",
    position: [1, 2, 3],
  });
  assert.deepEqual(data.characterProperties, {
    charPosition: [4, 5, 6],
  });
});
