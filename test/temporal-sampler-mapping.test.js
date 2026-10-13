"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mapFrameSamplerInputFrame, planFrameSamples } = require("../plugins/core/temporal-math.js");
const { readTemporalOperatorsBeforeIndex } = require("../plugins/core/temporal-layers.js");
const quantize = fps => ({ kind: "posterize-time", fps });
const offset = offsetFrames => ({ kind: "time-offset", offsetFrames });
const map = (frame, operators) => mapFrameSamplerInputFrame(frame, 30, operators, 180, true);

test("Posterize Time maps the requested Echo taps using the floor rule", () => {
  const taps = planFrameSamples(32.5, 4, -3, 1, 1, 0, 180);
  assert.deepEqual(taps.map(tap => map(tap.frame, [quantize(12)])), [27.5, 25, 22.5, 20]);
});

test("time offsets already in the input clock are not added again", () => {
  assert.equal(map(35, [offset(5)]), 35);
  assert.equal(map(29, [offset(5), offset(-8)]), 29);
  assert.equal(map(34.5, [offset(5), quantize(12)]), 32.5);
  assert.equal(map(34.5, [quantize(12), offset(3)]), 33);
  assert.equal(map(34.5, [offset(-7), quantize(12), offset(3)]), 33);
});

test("nested quantizers keep their serialized order", () => {
  assert.equal(map(29.5, [quantize(12), quantize(10)]), 27);
  assert.equal(map(29.5, [quantize(10), quantize(12)]), 25);
});

test("disabled quantizers, empty prefixes and clamping keep their contract", () => {
  assert.equal(map(29.5, []), 29.5);
  assert.equal(map(29.5, [{ ...quantize(12), enabled: false }, offset(5)]), 29.5);
  assert.equal(mapFrameSamplerInputFrame(-2, 30, [quantize(12)], 20, false), 0);
  assert.equal(mapFrameSamplerInputFrame(22, 30, [quantize(12)], 20, false), 20 - 1e-9);
  assert.equal(map(-2, [quantize(12)]), -2.5);
});

test("only time operators before the sampler are evaluated, at the tap frame", () => {
  const frames = [];
  const effect = value => ({ _zoidiumTemporal: { getOperator: (_effect, frame) => {
    frames.push(frame); return value;
  } } });
  const layer = { effects: [effect(quantize(12)), {}, effect(offset(5)), {}, effect(quantize(7))] };
  assert.deepEqual(readTemporalOperatorsBeforeIndex(layer, 3, 29.5), [quantize(12), offset(5)]);
  assert.deepEqual(frames, [29.5, 29.5]);
});

test("frame mapping does not depend on the order of earlier requests", () => {
  const ops = [quantize(12), offset(3), quantize(7)];
  const frames = [0, 29.5, 26.5, 23.5, 20.5, 70];
  assert.deepEqual(frames.map(frame => map(frame, ops)),
    frames.toReversed().map(frame => map(frame, ops)).toReversed());
});
