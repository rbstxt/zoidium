"use strict";

// ExpressText+ tests: effectors-a. Required by test/expresstext-plus.test.js; not discovered directly.

const assert = require("node:assert/strict");
const test = require("node:test");
const { T, props } = require("./expresstext-plus-helpers.js");

test("plain poses only the selected letters", () => {  const list = { order: [0, 1, 2, 3, 4], total: 5 };
  const base = [0, 0, 0];
  const p = props({
    plainEnable: 1,
    plainLetters: "2-3",
    plainStrength: 100,
    plainPosition: [10, 0, 0],
    plainRotation: [0, 0, 0],
    plainScale: [1, 1, 1],
    plainDelay: 0,
    plainDelayOrder: 0,
    plainField: 0,
    shakeEnable: 0,
    delayEnable: 0,
    randomEnable: 0,
    rotationOrder: "XYZ",
  });
  const moved = T.evaluateLetter(p, 0, 1, list, base);
  assert.deepEqual(moved.position, [10, 0, 0]);
  const still = T.evaluateLetter(p, 0, 0, list, base);
  assert.deepEqual(still.position, [0, 0, 0], "unselected stays");
  const half = props({
    plainEnable: 1,
    plainLetters: "",
    plainStrength: 50,
    plainPosition: [10, 0, 0],
    plainRotation: [0, 0, 0],
    plainScale: [2, 2, 2],
    plainDelay: 0,
    plainDelayOrder: 0,
    plainField: 0,
    shakeEnable: 0,
    delayEnable: 0,
    randomEnable: 0,
    rotationOrder: "XYZ",
  });
  const mid = T.evaluateLetter(half, 0, 0, list, base);
  assert.deepEqual(mid.position, [5, 0, 0], "strength halves the offset");
  assert.deepEqual(mid.scale, [1.5, 1.5, 1.5], "strength blends the scale");
});

test("plain inverts rotation on odd-numbered letters", () => {
  const list = { order: [0, 1, 2, 3], total: 4 };
  const base = [0, 0, 0];
  const p = props({
    plainEnable: 1,
    plainLetters: "",
    plainStrength: 100,
    plainPosition: [5, 0, 0],
    plainRotation: [10, 20, 30],
    plainScale: [1, 1, 1],
    plainInvertOdd: 1,
    plainDelay: 0,
    plainDelayOrder: 0,
    plainField: 0,
    shakeEnable: 0,
    delayEnable: 0,
    randomEnable: 0,
    rotationOrder: "XYZ",
  });
  const first = T.evaluateLetter(p, 0, 0, list, base);
  assert.deepEqual(first.rotation, [-10, -20, -30], "1st letter mirrored");
  assert.deepEqual(first.position, [-5, 0, 0], "1st letter position mirrored");
  const second = T.evaluateLetter(p, 0, 1, list, base);
  assert.deepEqual(second.rotation, [10, 20, 30], "2nd letter straight");
  assert.deepEqual(second.position, [5, 0, 0], "2nd letter position straight");
  assert.deepEqual(T.evaluateLetter(p, 0, 2, list, base).rotation, [-10, -20, -30], "3rd letter mirrored");
  assert.deepEqual(T.evaluateLetter(p, 0, 3, list, base).rotation, [10, 20, 30], "4th letter straight");
  const off = props({
    plainEnable: 1,
    plainLetters: "",
    plainStrength: 100,
    plainPosition: [0, 0, 0],
    plainRotation: [10, 20, 30],
    plainScale: [1, 1, 1],
    plainInvertOdd: 0,
    plainDelay: 0,
    plainDelayOrder: 0,
    plainField: 0,
    shakeEnable: 0,
    delayEnable: 0,
    randomEnable: 0,
    rotationOrder: "XYZ",
  });
  assert.deepEqual(T.evaluateLetter(off, 0, 0, list, base).rotation, [10, 20, 30], "toggle off");
  // Missing toggle defaults to off (older states keep working).
  const legacy = props({
    plainEnable: 1,
    plainLetters: "",
    plainStrength: 100,
    plainPosition: [0, 0, 0],
    plainRotation: [10, 20, 30],
    plainScale: [1, 1, 1],
    plainDelay: 0,
    plainDelayOrder: 0,
    plainField: 0,
    shakeEnable: 0,
    delayEnable: 0,
    randomEnable: 0,
    rotationOrder: "XYZ",
  });
  assert.deepEqual(T.evaluateLetter(legacy, 0, 0, list, base).rotation, [10, 20, 30]);
});

test("shake envelopes drive the amplitudes", () => {
  const list = { order: [0, 1, 2], total: 3 };
  const base = [0, 0, 0];
  const s = props({
    shakeEnable: 1,
    shakeLetters: "",
    shakeStrength: 100,
    shakePosition: [4, 0, 0],
    shakeRotation: [0, 0, 0],
    shakeScale: [1, 1, 1],
    shakeFrequency: 1,
    shakeOffset: 0.25,
    shakeDelay: 0,
    shakeDelayOrder: 0,
    shakeSeed: 1,
    shakeField: 0,
    plainEnable: 0,
    delayEnable: 0,
    randomEnable: 0,
    rotationOrder: "XYZ",
  });
  const peak = T.evaluateLetter(s, 0, 0, list, base);
  assert.ok(Math.abs(peak.position[0] - 4) < 1e-9, "offset 0.25 peaks at frame 0");
  const rest = T.evaluateLetter(s, 7.5, 0, list, base);
  assert.ok(Math.abs(rest.position[0]) < 1e-9, "quarter period rests");
});

test("random scatters deterministically and blends with strength", () => {
  const list = { order: [0, 1, 2], total: 3 };
  const base = [0, 0, 0];
  const values = {
    randomEnable: 1,
    randomLetters: "",
    randomStrength: 100,
    randomPositionMin: [0, 0, 0],
    randomPositionMax: [10, 10, 10],
    randomRotationMin: [0, 0, 0],
    randomRotationMax: [0, 0, 0],
    randomScaleMin: [1, 1, 1],
    randomScaleMax: [1, 1, 1],
    randomDelay: 0,
    randomDelayOrder: 0,
    randomSeed: 7,
    randomField: 0,
    shakeEnable: 0,
    plainEnable: 0,
    delayEnable: 0,
    rotationOrder: "XYZ",
  };
  const first = T.evaluateLetter(props(values), 0, 0, list, base);
  const again = T.evaluateLetter(props(values), 0, 0, list, base);
  assert.deepEqual(first.position, again.position, "seeded repeat");
  const other = T.evaluateLetter(props(values), 0, 1, list, base);
  assert.ok(
    Math.abs(first.position[0] - other.position[0]) > 1e-9 ||
      Math.abs(first.position[1] - other.position[1]) > 1e-9,
    "letters differ"
  );
  const off = T.evaluateLetter(props({ ...values, randomStrength: 0 }), 0, 0, list, base);
  assert.deepEqual(off.position, [0, 0, 0], "zero strength silences");
});

test("random modes follow the c4d manual", () => {
  const list = { order: [0, 1, 2, 3, 4, 5], total: 6 };
  const base = [0, 0, 0];
  const values = (extra) => ({
    randomEnable: 1,
    randomLetters: "",
    randomStrength: 100,
    randomMode: 0,
    randomMinimum: 0,
    randomMaximum: 100,
    randomSynchronized: 0,
    randomIndexed: 1,
    randomSeed: 7,
    randomSpace: 0,
    randomAnimationSpeed: 0,
    randomNoiseScale: 100,
    randomPositionMin: [0, 0, 0],
    randomPositionMax: [10, 10, 10],
    randomRotationMin: [0, 0, 0],
    randomRotationMax: [10, 10, 10],
    randomScaleMin: [1, 1, 1],
    randomScaleMax: [1, 1, 1],
    randomDelay: 0,
    randomDelayOrder: 0,
    randomField: 0,
    shakeEnable: 0,
    plainEnable: 0,
    delayEnable: 0,
    rotationOrder: "XYZ",
    ...extra,
  });
  const at = (frame, index, extra, b) =>
    T.evaluateLetter(props(values(extra)), frame, index, list, b || base);
  // Every mode stays inside the amplitude and repeats exactly.
  for (const mode of [0, 1, 2, 3, 4]) {
    const seen = [];
    for (let index = 0; index < 6; index += 1) {
      const out = at(0, index, { randomMode: mode }, [index * 20, 0, 0]);
      seen.push(out.position[0]);
      assert.ok(out.position[0] >= -1e-9 && out.position[0] <= 10 + 1e-9, `mode ${mode} in bounds`);
    }
    assert.deepEqual(at(0, 0, { randomMode: mode }, [0, 0, 0]).position, at(0, 0, { randomMode: mode }, [0, 0, 0]).position, `mode ${mode} repeats`);
    assert.ok(new Set(seen.map((v) => v.toFixed(6))).size > 1, `mode ${mode} spreads letters`);
  }
  // Synchronized shares one value across position/rotation/scale.
  const synced = at(0, 2, { randomSynchronized: 1 });
  assert.deepEqual(synced.position, synced.rotation, "synchronized shares groups");
  const loose = at(0, 2, { randomSynchronized: 0 });
  assert.ok(
    loose.position.some((v, axis) => Math.abs(v - loose.rotation[axis]) > 1e-9),
    "unsynchronized splits groups"
  );
  // Noise without Indexed drifts diagonally (equal axes, per the manual).
  const flat = at(0, 2, { randomMode: 2, randomIndexed: 0 });
  assert.ok(flat.position[0] === flat.position[1] && flat.position[1] === flat.position[2], "non-indexed noise is diagonal");
  const full = at(0, 2, { randomMode: 2, randomIndexed: 1 });
  assert.ok(
    full.position.some((v, axis) => axis > 0 && Math.abs(v - full.position[0]) > 1e-9) ||
      full.position.some((v, axis) => axis > 1 && Math.abs(v - full.position[1]) > 1e-9),
    "indexed noise splits axes"
  );
  // Animation Speed evolves the noise; 0% freezes it.
  const stillA = at(0, 2, { randomMode: 2, randomAnimationSpeed: 0 });
  const stillB = at(30, 2, { randomMode: 2, randomAnimationSpeed: 0 });
  assert.deepEqual(stillA.position, stillB.position, "still noise is frozen");
  const movingA = at(0, 2, { randomMode: 2, randomAnimationSpeed: 100 });
  const movingB = at(30, 2, { randomMode: 2, randomAnimationSpeed: 100 });
  assert.ok(
    Math.abs(movingA.position[0] - movingB.position[0]) > 1e-9,
    "animation speed evolves the noise"
  );
  // Sorted deals distinct strata: the set covers the range evenly.
  const strata = [];
  for (let index = 0; index < 6; index += 1) strata.push(at(0, index, { randomMode: 4 }).position[0]);
  assert.deepEqual(
    [...strata].sort((a, b) => a - b).map((v) => Math.round(v * 100) / 100),
    [0.83, 2.5, 4.17, 5.83, 7.5, 9.17],
    "sorted spreads strata evenly"
  );
  // Minimum/Maximum rescale the internal range; equal pins it constant.
  const pinned = at(0, 3, { randomMinimum: 50, randomMaximum: 50 });
  assert.deepEqual(pinned.position.map((v) => Math.round(v * 1e9) / 1e9), [5, 5, 5], "min=max pins the value");
  // Strength scales freely: double doubles, negative mirrors.
  const s100 = at(0, 3, {}).position[0];
  const s200 = at(0, 3, { randomStrength: 200 }).position[0];
  const sneg = at(0, 3, { randomStrength: -100 }).position[0];
  assert.ok(Math.abs(s200 - 2 * s100) < 1e-9, "over-100% amplifies");
  assert.ok(Math.abs(sneg + s100) < 1e-9, "negative strength mirrors");
  // Global follows the base position; UV stays per letter while moving.
  const g1 = at(0, 2, { randomMode: 2, randomSpace: 0 }, [0, 0, 0]).position[0];
  const g2 = at(0, 2, { randomMode: 2, randomSpace: 0 }, [40, 0, 0]).position[0];
  assert.ok(g1 !== g2, "global re-samples a moved letter");
  const u1 = at(0, 2, { randomMode: 2, randomSpace: 1 }, [0, 0, 0]).position[0];
  const u2 = at(0, 2, { randomMode: 2, randomSpace: 1 }, [40, 0, 0]).position[0];
  assert.equal(u1, u2, "uv stays put while moving");
});

test("formula language computes with c4d degree trig", () => {
  const ev = (src, scope) => T.compileFormula(src).fn(scope || {});
  assert.equal(ev("2+3*4", {}), 14, "precedence");
  assert.equal(ev("2^3^2", {}), 512, "power associates right");
  assert.equal(ev("-2^2", {}), -4, "unary binds looser than power");
  assert.equal(ev("2^-3", {}), 0.125, "negative exponents");
  assert.equal(ev("(-2)^2", {}), 4, "parens group");
  assert.equal(ev("10%3", {}), 1, "remainder");
  assert.equal(ev("7>5 ? 1 : 0", {}), 1, "ternary");
  assert.equal(ev("!0", {}), 1, "logical not");
  assert.equal(ev("1&&0", {}), 0, "logical and");
  assert.ok(Math.abs(ev("sin(30)", {}) - 0.5) < 1e-12, "degrees in");
  assert.equal(ev("asin(1)", {}), 90, "degrees out");
  assert.ok(
    Math.abs(ev("sin(u*360)", { u: 1 / 3 }) - Math.sin((120 * Math.PI) / 180)) < 1e-12,
    "manual wave shape"
  );
  assert.equal(ev("pi", {}), Math.PI, "constants");
  assert.ok(T.compileFormula("bogus").error, "unknown names fail closed");
  assert.ok(T.compileFormula("a=5").error, "assignment fails closed");
  assert.ok(T.compileFormula("Math.max(1,2)").error, "code fails closed");
  assert.ok(T.compileFormula("sin(1,2)").error, "arity checked");
  assert.ok(T.compileFormula("(1+2").error, "unbalanced fails");
  assert.ok(T.compileFormula("").error, "empty fails closed");
});

test("formula drives letters like the c4d manual wave", () => {
  const list = { order: [0, 1, 2, 3], total: 4 };
  const base = [0, 0, 0];
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const wave = (extra) => ({
    kind: "formula",
    props: props({
      formulaEnable: 1,
      formulaLetters: "",
      formulaStrength: 100,
      formulaMinimum: 0,
      formulaMaximum: 100,
      formulaExpression: "sin(u*360)",
      formulaTime: 1,
      formulaFrequency: 1,
      formulaPosition: [0, 300, 0],
      formulaRotation: [0, 0, 0],
      formulaScale: [1, 1, 1],
      formulaDelay: 0,
      formulaDelayOrder: 0,
      formulaField: 0,
      ...extra,
    }),
  });
  const at = (frame, index, extra) =>
    T.evaluateStack([wave(extra)], containerProps, frame, index, list, base);
  // Manual example: sin(u*360) with P.Y 300 -> [0, +259.81, -259.81, 0].
  const rounded = [0, 1, 2, 3].map((i) => Math.round(at(0, i).position[1] * 100) / 100 + 0);
  assert.deepEqual(rounded, [0, 259.81, -259.81, 0], "wave across the line");
  // id counts from 0, count is the total.
  assert.equal(at(0, 2, { formulaExpression: "id" }).position[1], 600, "id counts from 0");
  assert.equal(at(0, 0, { formulaExpression: "count" }).position[1], 1200, "count is the total");
  // t flows in seconds; f is a free constant.
  assert.equal(at(0, 0, { formulaExpression: "t" }).position[1], 0, "t starts at rest");
  assert.equal(at(30, 0, { formulaExpression: "t" }).position[1], 300, "t flows in seconds");
  assert.equal(
    at(0, 0, { formulaExpression: "f", formulaFrequency: 3, formulaPosition: [0, 5, 0] }).position[1],
    15,
    "f scales the spatial term"
  );
  // falloff follows the field: excluded letters read 0 and stay 0.
  const gated = { formulaExpression: "falloff", formulaField: 2, formulaFieldPosition: [100, 0, 0] };
  assert.equal(at(0, 0, gated).position[1], 0, "outside the field reads zero");
  // Minimum/Maximum tame wild outputs (the manual's Maximum 1%).
  assert.equal(at(30, 0, { formulaExpression: "2", formulaMaximum: 1 }).position[1], 6, "maximum scales down");
  // Strength scales freely; negative mirrors.
  const s100 = at(0, 1, {}).position[1];
  const s200 = at(0, 1, { formulaStrength: 200 }).position[1];
  assert.ok(Math.abs(s200 - 2 * s100) < 1e-6, "over-100% amplifies");
  const sneg = at(0, 1, { formulaStrength: -100 }).position[1];
  assert.ok(Math.abs(sneg + s100) < 1e-6, "negative mirrors");
  // Selection skips unlisted letters.
  assert.equal(at(0, 0, { formulaLetters: "2" }).position[1], 0, "unselected stays");
  assert.ok(at(0, 1, { formulaLetters: "2" }).position[1] > 200, "selected moves");
  // Rotation arrives in degrees from earlier sections.
  const spin = {
    kind: "plain",
    props: props({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: [0, 0, 0],
      plainRotation: [Math.PI / 2, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const rxLayer = {
    kind: "formula",
    props: props({
      formulaEnable: 1,
      formulaLetters: "",
      formulaStrength: 100,
      formulaMinimum: 0,
      formulaMaximum: 100,
      formulaExpression: "rx",
      formulaTime: 1,
      formulaFrequency: 1,
      formulaPosition: [1, 0, 0],
      formulaRotation: [0, 0, 0],
      formulaScale: [1, 1, 1],
      formulaDelay: 0,
      formulaDelayOrder: 0,
      formulaField: 0,
    }),
  };
  const stacked = T.evaluateStack([spin, rxLayer], containerProps, 0, 0, list, base);
  assert.ok(Math.abs(stacked.position[0] - 90) < 1e-9, "rx arrives in degrees");
  // Scale rides the scalar around 1.
  const grown = at(0, 0, { formulaExpression: "2", formulaScale: [3, 3, 3] }).scale;
  assert.deepEqual(grown, [5, 5, 5], "scale compounds");
  // Garbage can never run or poison: unknown names, injection and empty
  // all read 0; wild math guards to finite.
  assert.deepEqual(at(0, 1, { formulaExpression: "nope(1)" }).position, [0, 0, 0], "unknown fails closed");
  assert.deepEqual(at(0, 1, { formulaExpression: "Math.max(1,2)" }).position, [0, 0, 0], "code fails closed");
  assert.deepEqual(at(0, 1, { formulaExpression: "" }).position, [0, 0, 0], "empty fails closed");
  assert.deepEqual(at(0, 1, { formulaExpression: "1/0" }).position, [0, 0, 0], "infinity guarded");
  assert.deepEqual(at(0, 1, { formulaExpression: "0/0" }).position, [0, 0, 0], "nan guarded");
});

test("fresh formula sections move on play", () => {
  const list = { order: [0, 1, 2, 3], total: 4 };
  const base = [0, 0, 0];
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  // Barely configured: only the enable row. Fallbacks carry the live
  // defaults (traveling wave plus a small lift), so play shows motion.
  const fresh = {
    kind: "formula",
    props: props({ formulaEnable: 1 }),
  };
  const at = (frame, index) =>
    T.evaluateStack([fresh], containerProps, frame, index, list, base);
  const y0 = at(0, 0).position[1];
  const y30 = at(30, 0).position[1];
  assert.ok(Math.abs(y30 - y0) > 1e-9, "default section animates");
  assert.ok(Math.abs(at(0, 1).position[1] - y0) > 1e-9, "default wave spreads letters");
});

