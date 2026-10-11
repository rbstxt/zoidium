"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;


test("3D text layout follows the font advance and line-height rules", () => {
  const font = {
    resolution: 1000,
    boundingBox: { yMin: -200, yMax: 800 },
    underlineThickness: 50,
    glyphs: {
      A: { ha: 600 },
      " ": { ha: 250 },
      "?": { ha: 500 },
    },
  };
  const layout = _test.getTextLayout("A A\n?", font, 100);

  assert.equal(layout.lineHeight, 105);
  assert.equal(layout.count, 4);
  assert.deepEqual(
    layout.units.map(({ character, index, x, y, advance }) => ({
      character,
      index,
      x,
      y,
      advance,
    })),
    [
      { character: "A", index: 0, x: 0, y: 0, advance: 60 },
      { character: " ", index: 1, x: 60, y: 0, advance: 25 },
      { character: "A", index: 2, x: 85, y: 0, advance: 60 },
      { character: "?", index: 3, x: 0, y: -105, advance: 50 },
    ]
  );
});

test("3D text layout applies horizontal spacing between characters", () => {
  const font = {
    resolution: 1000,
    boundingBox: { yMin: -200, yMax: 800 },
    underlineThickness: 50,
    glyphs: { A: { ha: 600 } },
  };
  const layout = _test.getTextLayout("AA", font, 100, 5);

  assert.deepEqual(
    layout.units.map(({ character, x, advance }) => ({ character, x, advance })),
    [
      { character: "A", x: 0, advance: 60 },
      { character: "A", x: 65, advance: 60 },
    ]
  );
});

test("Text geometry options map advanced bevel controls to ExtrudeGeometry", () => {
  const property = (value) => ({ get: () => value });
  const options = _test.textGeometryOptions(
    {
      properties: {
        size: property([30, 4]),
        detail: property(7),
        bevel: property(1),
        bevelSize: property([1.25, 2.5]),
        bevelSide: property(1),
        bevelDetail: property(8),
        bevelProfile: property(0),
        bevelTension: property(0.2),
      },
    },
    { data: {} }
  );

  assert.equal(options.size, 30);
  assert.equal(options.height, 4);
  assert.equal(options.amount, 4);
  assert.equal(options.curveSegments, 7);
  assert.equal(options.bevelEnabled, true);
  assert.equal(options.bevelThickness, 1.25);
  assert.equal(options.bevelSize, 2.5);
  assert.equal(options.bevelSizeInner, 2.5);
  assert.equal(options.bevelShift, 2.5);
  assert.equal(options.bevelSegments, 8);
  assert.equal(options.bevelRound, false);
  assert.equal(options.bevelProfile, 0.2);
});

test("Text+ usage detection ignores defaults and catches spacing or advanced bevel values", () => {
  const property = (value) => ({ get: () => value });
  const makeText = (overrides = {}) => ({
    properties: {
      spacing: property(0),
      bevelSide: property(0),
      bevelDetail: property(3),
      bevelProfile: property(1),
      bevelTension: property(0.5),
      ...overrides,
    },
  });

  assert.equal(_test.textUsesExtendedProperties(makeText()), false);
  assert.equal(
    _test.textUsesExtendedProperties(makeText({ spacing: property(5) })),
    true
  );
  assert.equal(
    _test.textUsesExtendedProperties(makeText({ bevelSide: property(1) })),
    true
  );
  assert.equal(
    _test.textUsesExtendedProperties(makeText({ bevelDetail: property(8) })),
    true
  );
  assert.equal(
    _test.textUsesExtendedProperties(makeText({ bevelProfile: property(0) })),
    true
  );
  assert.equal(
    _test.textUsesExtendedProperties(makeText({ bevelTension: property(0.2) })),
    true
  );
});

test("center point modes match the native 3D Text anchor rules", () => {
  const bounds = { min: [-10, -20, -2], max: [30, 40, 8] };
  assert.deepEqual(_test.getCenterOffset(bounds, 0), [-10, -10, -3]);
  assert.deepEqual(_test.getCenterOffset(bounds, 1), [0, -10, -3]);
  assert.deepEqual(_test.getCenterOffset(bounds, 2), [-20, -10, -3]);
  assert.deepEqual(_test.getCenterOffset(bounds, 3), [-10, -20, -3]);
  assert.deepEqual(_test.getCenterOffset(bounds, 4), [-10, 0, -3]);
  assert.deepEqual(_test.getCenterOffset(bounds, 5), [-10, -10, -6]);
  assert.deepEqual(_test.getCenterOffset(bounds, 6), [-10, -10, 0]);
  assert.deepEqual(_test.getCenterOffset(null, 0), [0, 0, 0]);
  assert.deepEqual(_test.getTextCenter(bounds, [-10, -10, -3]), [0, 0, 0]);
  assert.deepEqual(_test.getTextCenter(bounds, [0, -10, -3]), [10, 0, 0]);
  assert.deepEqual(_test.getTextCenter(null, [4, 5, 6]), [0, 0, 0]);
});

test("finiteBox reads finite bounding boxes and rejects the rest", () => {
  const finite = {
    computeBoundingBox() {
      this.boundingBox = {
        min: { x: -1, y: -2, z: -3 },
        max: { x: 4, y: 5, z: 6 },
      };
    },
  };
  assert.deepEqual(_test.finiteBox(finite), {
    min: [-1, -2, -3],
    max: [4, 5, 6],
  });
  assert.equal(
    _test.finiteBox({
      computeBoundingBox() {
        this.boundingBox = {
          min: { x: 0, y: 0, z: 0 },
          max: { x: Infinity, y: 1, z: 1 },
        };
      },
    }),
    null
  );
  assert.equal(_test.finiteBox(null), null);
  assert.equal(_test.finiteBox({}), null);
});

test("expandBounds accumulates translated character boxes", () => {
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
    empty: true,
  };
  _test.expandBounds(bounds, null, 0, 0);
  assert.equal(bounds.empty, true);
  _test.expandBounds(bounds, { min: [-1, -2, -3], max: [4, 5, 6] }, 10, 20);
  assert.deepEqual(bounds.min, [9, 18, -3]);
  assert.deepEqual(bounds.max, [14, 25, 6]);
  assert.equal(bounds.empty, false);
  _test.expandBounds(bounds, { min: [0, 0, 0], max: [1, 1, 1] }, -100, -100);
  assert.deepEqual(bounds.min, [-100, -100, -3]);
  assert.deepEqual(bounds.max, [14, 25, 6]);
});
