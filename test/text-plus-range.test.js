"use strict";

// Index offset / total characters: mapping local per-Text character
// indices onto a word built from several Text objects.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;

function fakeProp(value) {
  return { get: () => value };
}

function fakeText(offset, total) {
  return {
    properties: {
      characterIndexOffset: fakeProp(offset),
      characterCountOverride: fakeProp(total),
    },
  };
}

test("default range values reproduce the local index and count exactly", () => {
  assert.deepEqual(_test.resolveCharacterRange(0, 0, 0, 1), { index: 0, count: 1 });
  assert.deepEqual(_test.resolveCharacterRange(0, 0, 3, 7), { index: 3, count: 7 });
  assert.deepEqual(_test.resolveCharacterRange(undefined, undefined, 2, 4), {
    index: 2,
    count: 4,
  });
});

test("offset shifts the index and a total replaces the count", () => {
  assert.deepEqual(_test.resolveCharacterRange(2, 10, 0, 2), { index: 2, count: 10 });
  assert.deepEqual(_test.resolveCharacterRange(2, 10, 1, 2), { index: 3, count: 10 });
  assert.deepEqual(_test.resolveCharacterRange(1.9, 0, 0, 3), { index: 1, count: 3 });
  assert.deepEqual(_test.resolveCharacterRange(-4, -2, 1, 3), { index: 1, count: 3 });
});

test("split Texts with offsets reproduce the single-Text delay ranks", () => {
  // One two-letter Text: ranks 0, 1 with count 2.
  const single = [0, 1].map((index) => _test.getDelayRank("start", index, 2, 1));
  // Two single-letter Texts mapped onto characters 1..2 of 2.
  const split = [0, 1].map((letter) => {
    const range = _test.resolveCharacterRange(letter, 2, 0, 1);
    return _test.getDelayRank("start", range.index, range.count, 1);
  });
  assert.deepEqual(single, [0, 1]);
  assert.deepEqual(split, single);
});

test("mapped delay matches for every delay order", () => {
  for (const order of ["start", "end", "middle", "random"]) {
    const single = [0, 1, 2].map((index) =>
      _test.getDelayRank(order, index, 3, 7)
    );
    const split = [0, 1, 2].map((letter) => {
      const range = _test.resolveCharacterRange(letter, 3, 0, 1);
      return _test.getDelayRank(order, range.index, range.count, 7);
    });
    assert.deepEqual(split, single, order);
  }
});

test("effective range reads the Text properties at the frame", () => {
  const animated = {
    properties: {
      characterIndexOffset: { get: (frame) => (frame >= 10 ? 5 : 0) },
      characterCountOverride: { get: (frame) => (frame >= 10 ? 8 : 0) },
    },
  };
  assert.deepEqual(_test.getEffectiveCharacterRange(animated, 0, 1, 2), {
    index: 1,
    count: 2,
  });
  assert.deepEqual(_test.getEffectiveCharacterRange(animated, 10, 1, 2), {
    index: 6,
    count: 8,
  });
  assert.deepEqual(_test.getEffectiveCharacterRange(fakeText(3, 4), 0, 0, 1), {
    index: 3,
    count: 4,
  });
  // An unreadable property keeps the legacy behavior instead of throwing.
  assert.deepEqual(
    _test.getEffectiveCharacterRange({ properties: null }, 0, 2, 5),
    { index: 2, count: 5 }
  );
});

test("Text property definitions expose the range fields with zero defaults", () => {
  const PZ = {
    object3d: { eulerOrders: [] },
    property: { type: { NUMBER: 0, VECTOR2: 1, VECTOR3: 2, OPTION: 6, LIST: 9, TEXT: 10 } },
  };
  const original = {
    detail: { value: 5 },
    spacing: { value: 1 },
    bevelSize: { value: [0.1, 0.5] },
  };
  const definitions = _test.getTextPropertyDefinitions({
    object3d: { text: { propertyDefinitions: original, changeFn: () => {} } },
    property: PZ.property,
  });
  assert.equal(definitions.characterIndexOffset.name, "Index offset");
  assert.equal(definitions.characterIndexOffset.value, 0);
  assert.equal(definitions.characterCountOverride.name, "Total characters");
  assert.equal(definitions.characterCountOverride.value, 0);
  assert.ok(
    Object.keys(definitions).indexOf("characterIndexOffset") >
      Object.keys(definitions).indexOf("spacing")
  );
  assert.equal(definitions.characterIndexOffset.dynamic, true);
  assert.equal(definitions.characterCountOverride.interpolated, true);
});

test("extended-use detection never reads animated properties without a frame", () => {
  const animatedProp = (values) => ({
    animated: true,
    keyframes: values.map((value) => ({ value })),
    get: () => {
      throw new Error("arg-less get must not be called");
    },
  });
  const staticProp = (value) => ({
    animated: false,
    get: () => value,
  });
  // A multi-keyframe animated offset (arg-less get would hang CM3).
  assert.equal(
    _test.textUsesExtendedProperties({
      properties: {
        spacing: staticProp(0),
        characterIndexOffset: animatedProp([0, 1]),
        characterCountOverride: animatedProp([2]),
        bevelSide: staticProp(0),
        bevelDetail: staticProp(3),
        bevelProfile: staticProp(1),
        bevelTension: staticProp(0.5),
      },
    }),
    true
  );
  assert.equal(
    _test.textUsesExtendedProperties({
      properties: {
        spacing: staticProp(0),
        characterIndexOffset: animatedProp([0, 0]),
        characterCountOverride: animatedProp([0]),
        bevelSide: staticProp(0),
        bevelDetail: staticProp(3),
        bevelProfile: staticProp(1),
        bevelTension: staticProp(0.5),
      },
    }),
    false
  );
  assert.equal(
    _test.textUsesExtendedProperties({
      properties: { spacing: staticProp(1) },
    }),
    true
  );
  assert.equal(_test.textUsesExtendedProperties({ properties: {} }), false);
  assert.equal(_test.textUsesExtendedProperties(null), false);
});
