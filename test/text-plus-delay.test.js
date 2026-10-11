"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/text-plus/text-plus.js");
const { _test } = plugin;


test("delay order decides which character starts first", () => {
  const count = 5;
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => _test.getDelayRank("start", index, count, 1)),
    [0, 1, 2, 3, 4]
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => _test.getDelayRank("end", index, count, 1)),
    [4, 3, 2, 1, 0]
  );
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((index) => _test.getDelayRank("middle", index, count, 1)),
    [4, 2, 0, 1, 3]
  );
  assert.equal(_test.getDelayRank("middle", 0, 1, 1), 0);
});

test("random delay order is a stable permutation", () => {
  const first = Array.from({ length: 8 }, (_value, index) =>
    _test.getDelayRank("random", index, 8, 1234)
  );
  const second = Array.from({ length: 8 }, (_value, index) =>
    _test.getDelayRank("random", index, 8, 1234)
  );
  const other = Array.from({ length: 8 }, (_value, index) =>
    _test.getDelayRank("random", index, 8, 4321)
  );

  assert.deepEqual(first, second);
  assert.deepEqual(first.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.notDeepEqual(first, other);
  assert.deepEqual(_test.getRandomOrder(8, 1234), _test.getRandomOrder(8, 1234));
});

test("fractional seed values produce distinct random states", () => {
  assert.notEqual(
    _test.seededRandom(1, 0, 20),
    _test.seededRandom(1.0000000000000002, 0, 20)
  );
  assert.notDeepEqual(
    _test.getRandomOrder(8, 1234),
    _test.getRandomOrder(8, 1234.0000000000002)
  );

  const ranges = {
    positionMin: [-10, -10, -10],
    positionMax: [10, 10, 10],
    rotationMin: [-1, -1, -1],
    rotationMax: [1, 1, 1],
    scaleMin: [0.5, 0.5, 0.5],
    scaleMax: [1.5, 1.5, 1.5],
  };
  assert.notDeepEqual(
    _test.getRandomScatterTransform(1, ranges, 7, 2),
    _test.getRandomScatterTransform(1, ranges, 7.000000000000001, 2)
  );
});

test("delay offsets the animation frame by the configured step", () => {
  assert.equal(_test.getCharacterDelay("start", 0, 4, 3, 1), 0);
  assert.equal(_test.getCharacterDelay("start", 1, 4, 3, 1), 3);
  assert.equal(_test.getCharacterDelay("start", 2, 4, 3, 1), 6);
  assert.equal(_test.getCharacterDelay("end", 3, 4, 3, 1), 0);
  assert.equal(_test.getCharacterDelay("start", 3, 4, -5, 1), 0);
});
