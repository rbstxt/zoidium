"use strict";

// ExpressText+ Delay sequential-playback bit-identity: the incremental
// chase (checkpoints), the per-fingerprint generation caches and the
// single-pass fingerprint must evaluate bit-identically to the original
// whole-window traversal (test/expresstext-plus-delay-reference.js) over
// sequential playback, scrubbing, seeks, fractional frames, mid-playback
// edits, chained delays, all three modes, growing travel and frames past
// the simulation window. Comparisons use Object.is per component.

const assert = require("node:assert/strict");
const test = require("node:test");
const D = require("../plugins/expresstext-plus/expresstext-delay.js");
const C = require("../plugins/expresstext-plus/expresstext-delay-cache.js");
const { staticProps } = require("../plugins/expresstext-plus/expresstext-eval.js");
const { state } = require("../plugins/expresstext-plus/expresstext-constants.js");
const { EFFECTOR_BUILDERS } = require("../plugins/expresstext-plus/expresstext-properties.js");
const { nativeHost } = require("./expressions-plus-harness.js");
const { referenceStack } = require("./expresstext-plus-delay-reference.js");

function layer(kind, values) {
  const props = new PZ.propertyList(EFFECTOR_BUILDERS[kind](PZ), new PZ.object());
  props.load();
  for (const [key, value] of Object.entries(values)) props[key].set(value, 0);
  return { kind, props };
}

// Report-like stacks: Shake, Wrap, Twist, Plain, Random, Delay, Plain.
// Stack A trails in Even mode; stack B chains Spring into Blend. The Plain
// flight runs out and back, so travel over the window grows, then holds.
function buildStack(seed, delayModes) {
  const shake = layer("shake", {
    shakePosition: [30, 0, 0], shakeRotation: [0, 0, 20],
    shakeFrequency: 2, shakeMode: 0, shakeStrength: 100,
  });
  const wrap = layer("wrap", { wrapAmplitude: 20 + seed, wrapFrequency: 2, wrapPhase: 30, wrapStrength: 100 });
  const twist = layer("twist", { twistAngle: 90, twistAxis: 2, twistStrength: 100 });
  const plain = layer("plain", { plainPosition: [0, 10, 0], plainRotation: [15, 0, 0], plainStrength: 100 });
  const track = plain.props.plainPosition.objects[0];
  track.animated = true;
  track.keyframes.push(new PZ.keyframe(0, 0, 1));
  track.keyframes.push(new PZ.keyframe(120, 200, 1));
  track.keyframes.push(new PZ.keyframe(0, 400, 1));
  const random = layer("random", {
    randomMode: 2, randomAnimationSpeed: 70, randomStrength: 12, randomSeed: seed,
  });
  const delays = delayModes.map((mode) => layer("delay", { delayMode: mode, delayStrength: 84 }));
  const tail = layer("plain", { plainPosition: [5, 0, 0], plainStrength: 100 });
  return [shake, wrap, twist, plain, random, ...delays, tail];
}

const LETTERS = 3;
const list = { order: [0, 1, 2], total: LETTERS };
const bases = [[-30, 0, 0], [0, 1, 0], [30, 0, 1]];
const container = staticProps({ rotationOrder: "XYZ" });

let PZ;
let stacks;

function equalControls(actual, expected, where) {
  for (const key of ["position", "rotation", "scale"]) {
    for (let axis = 0; axis < 3; axis += 1) {
      assert.ok(Object.is(actual[key][axis], expected[key][axis]),
        `${where} ${key}[${axis}]: ${actual[key][axis]} != ${expected[key][axis]}`);
    }
  }
  assert.equal(actual.eulerOrder, expected.eulerOrder, `${where} eulerOrder`);
}

function check(frame, where) {
  for (let s = 0; s < stacks.length; s += 1) {
    for (let index = 0; index < LETTERS; index += 1) {
      const actual = D.evaluateStack(stacks[s], container, frame, index, list, bases[index]);
      const expected = referenceStack(stacks[s], container, frame, index, list, bases[index]);
      equalControls(actual, expected, `${where} stack${s} letter${index} frame${frame}`);
    }
  }
}

// Deterministic seeks without Math.random: the sequence is fixed.
function seekFrames(count, lo, hi) {
  let seed = 0x12345678;
  const out = [];
  for (let i = 0; i < count; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    out.push(lo + (seed % (hi - lo + 1)) + (seed % 4) * 0.25);
  }
  return out;
}

function setup(t) {
  ({ PZ } = nativeHost());
  state.PZ = PZ;
  C.clearDelayCache();
  stacks = [buildStack(1, [0]), buildStack(7, [2, 1])];
  t.after(() => { state.PZ = null; C.clearDelayCache(); });
}

test("sequential playback with growing then stable travel matches the original traversal", { timeout: 120000 }, (t) => {
  setup(t);
  // The keyframed flight runs out (travel grows: full reruns) and back
  // (travel holds: incremental chase), alternating both objects per frame.
  for (let frame = 0; frame <= 300; frame += 1) check(frame, "sequential");
  const stats = C.cacheStats();
  const targetRate = stats.targetHits / (stats.targetHits + stats.targetMisses);
  const paramRate = stats.paramHits / (stats.paramHits + stats.paramMisses);
  assert.ok(targetRate > 0.9, `two objects share the target cache (hit rate ${targetRate})`);
  assert.ok(paramRate > 0.9, `two objects share the param cache (hit rate ${paramRate})`);
});

test("scrubs, seeks, fractional frames and repeats match the original traversal", { timeout: 120000 }, (t) => {
  setup(t);
  for (let frame = 0; frame <= 120; frame += 1) check(frame, "warmup");
  for (const frame of [120, 119.5, 30, 30, 90.25, 0.5, 0, 120.75, 120.25, 45, 300, 299.5, 7199]) {
    check(frame, "scrub");
  }
  for (const frame of seekFrames(12, 0, 500)) check(frame, "seek");
});

test("keyframes edited mid-playback invalidate both paths identically", { timeout: 120000 }, (t) => {
  setup(t);
  for (let frame = 0; frame <= 100; frame += 1) check(frame, "pre-edit");
  stacks[0][3].props.plainPosition.objects[0].keyframes[1].value = 40;
  stacks[1][5].props.delayStrength.set(30, 0);
  for (let frame = 101; frame <= 160; frame += 1) check(frame, "post-edit");
  stacks[0][0].props.shakeFrequency.set(5, 0);
  for (const frame of [160, 100.5, 200, 50]) check(frame, "post-edit-seek");
});

test("frames past the simulation window match the original traversal", { timeout: 180000 }, (t) => {
  setup(t);
  for (const frame of [600, 900, 7199, 7200, 7200.5, 7201, 7300, 7517.75, 7300, 7200.25]) {
    check(frame, "far");
  }
  for (let frame = 7198; frame <= 7203; frame += 1) check(frame, "slide");
});
