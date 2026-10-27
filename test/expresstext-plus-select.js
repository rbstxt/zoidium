"use strict";

// ExpressText+ tests: select. Required by test/expresstext-plus.test.js; not discovered directly.

const assert = require("node:assert/strict");
const test = require("node:test");
const { T, copyState, copyVel } = require("./expresstext-plus-helpers.js");

test("letter selection parses numbers, ranges and separators", () => {
  assert.equal(T.parseLetterSelection("", 5), null, "blank means all");
  assert.equal(T.parseLetterSelection("   ", 5), null);
  assert.deepEqual([...T.parseLetterSelection("1,4,5", 5)], [0, 3, 4]);
  assert.deepEqual([...T.parseLetterSelection("1.4.5.", 5)], [0, 3, 4]);
  assert.deepEqual([...T.parseLetterSelection("2-4", 5)], [1, 2, 3]);
  assert.deepEqual([...T.parseLetterSelection("1, 3-5, 3", 5)], [0, 2, 3, 4], "dedupe + sort");
  assert.deepEqual([...T.parseLetterSelection("0,-1,2x5,text,6,3", 5)], [2], "junk ignored, clamped");
  assert.deepEqual([...T.parseLetterSelection("5-2", 5)], [1, 2, 3, 4], "reversed range");
  assert.deepEqual([...T.parseLetterSelection("1", 0)], [], "empty text selects nothing");
  assert.deepEqual([...T.parseLetterSelection("1+2", 5)], [0, 1], "plus adds letters");
  assert.deepEqual([...T.parseLetterSelection("1+2+5", 5)], [0, 1, 4]);
  assert.deepEqual([...T.parseLetterSelection("1-3+5", 5)], [0, 1, 2, 4], "plus mixes with ranges");
  assert.deepEqual([...T.parseLetterSelection("1 + 2", 3)], [0, 1], "spaces around plus");
  assert.deepEqual([...T.parseLetterSelection("+2+", 5)], [1], "stray plus ignored");
});

test("strength counts 0 to 100", () => {
  assert.equal(T.strengthWeight(0), 0);
  assert.equal(T.strengthWeight(50), 0.5);
  assert.equal(T.strengthWeight(100), 1);
  assert.equal(T.strengthWeight(150), 1, "clamped");
  assert.equal(T.strengthWeight(-5), 0, "clamped");
});

test("fields gate letters by position", () => {
  assert.equal(T.fieldWeight(0, [999, 0, 0], [0, 0, 0], [100, 100, 100]), 1, "infinite");
  assert.equal(T.fieldWeight(1, [-50, 0, 0], [0, 0, 0], [100, 100, 100]), 0, "linear low edge");
  assert.equal(T.fieldWeight(1, [50, 0, 0], [0, 0, 0], [100, 100, 100]), 1, "linear high edge");
  assert.equal(T.fieldWeight(1, [0, 0, 0], [0, 0, 0], [100, 100, 100]), 0.5, "linear middle");
  assert.equal(T.fieldWeight(2, [0, 0, 0], [0, 0, 0], [100, 100, 100]), 1, "box inside");
  assert.equal(T.fieldWeight(2, [60, 0, 0], [0, 0, 0], [100, 100, 100]), 0, "box outside");
  assert.equal(T.fieldWeight(3, [0, 0, 0], [0, 0, 0], [100, 100, 100]), 1, "sphere inside");
  assert.equal(T.fieldWeight(3, [60, 0, 0], [0, 0, 0], [100, 100, 100]), 0, "sphere outside");
});

test("random and stagger are deterministic", () => {
  assert.equal(T.seededRandom(1, 0, 0), T.seededRandom(1, 0, 0));
  assert.ok(T.seededRandom(1, 0, 0) !== T.seededRandom(1, 1, 0), "per-letter spread");
  for (let i = 0; i < 5; i += 1) {
    const v = T.seededRandom(2, i, 3);
    assert.ok(v >= 0 && v < 1, "unit range");
  }
  assert.deepEqual([0, 1, 2, 3].map((p) => T.delayRank(0, p, 4, 1)), [0, 1, 2, 3], "forward");
  assert.deepEqual([0, 1, 2, 3].map((p) => T.delayRank(1, p, 4, 1)), [3, 2, 1, 0], "reverse");
  assert.deepEqual([0, 1, 2, 3].map((p) => T.delayRank(2, p, 4, 1)), [1.5, 0.5, 0.5, 1.5], "center out");
  const r1 = [0, 1, 2, 3].map((p) => T.delayRank(3, p, 4, 9));
  assert.deepEqual([...r1].sort((a, b) => a - b), [0, 1, 2, 3], "random is a permutation");
  assert.deepEqual([0, 1, 2, 3].map((p) => T.delayRank(3, p, 4, 9)), r1, "random is seeded");
});

test("shake oscillates smoothly", () => {
  assert.equal(T.shakeValue(0, 1, 0, 0), 0);
  assert.ok(Math.abs(T.shakeValue(7.5, 1, 0, 0) - 1) < 1e-9, "quarter period peaks");
  assert.ok(Math.abs(T.shakeValue(15, 1, 0, 0)) < 1e-9, "half period rests");
});

test("delay selection references plain sections with plain-N tokens", () => {
  const plainLists = ["", "1,3-4", "5"];
  assert.deepEqual([...T.resolveSelection("plain-2", 5, plainLists)], [0, 2, 3], "Nth plain");
  assert.deepEqual([...T.resolveSelection("plain-1", 5, plainLists)], [0, 1, 2, 3, 4], "blank means all");
  assert.deepEqual([...T.resolveSelection("2+plain-3", 5, plainLists)], [1, 4], "mixes with literals");
  assert.deepEqual([...T.resolveSelection("plain-9", 5, plainLists)], [], "missing section is empty");
  assert.deepEqual([...T.resolveSelection("plain-9", 5, null)], [], "no lists is empty");
  // One level only: a plain's own plain-N token is inert, so chains cannot loop.
  assert.deepEqual([...T.resolveSelection("plain-1", 3, ["plain-1", "2"])], [], "self reference inert");
  assert.deepEqual([...T.resolveSelection("plain-2", 3, ["plain-1", "2"])], [1], "sibling reads literals");
  // parseLetterSelection alone has no section context: the token selects nothing.
  assert.deepEqual([...T.parseLetterSelection("plain-1", 4)], []);
});

test("selection tokens address every section kind", () => {
  const lists = ["", "1,3-4"];
  lists.sections = {
    plain: ["", "1,3-4"],
    voronoi: ["2-3", ""],
    shake: ["4"],
  };
  // voronoi-N reads the Nth Voronoi section (Delay Letters "voronoi-1").
  assert.deepEqual([...T.resolveSelection("voronoi-1", 5, lists)], [1, 2], "voronoi section letters");
  assert.deepEqual([...T.resolveSelection("voronoi-2", 5, lists)], [0, 1, 2, 3, 4], "blank voronoi means all");
  assert.deepEqual([...T.resolveSelection("shake-1", 5, lists)], [3], "other kinds work too");
  assert.deepEqual([...T.resolveSelection("orbit-9", 5, lists)], [], "missing section is empty");
  assert.deepEqual([...T.resolveSelection("2+voronoi-1", 5, lists)], [1, 2], "mixes with literals");
  // Legacy plain arrays without a sections map behave exactly as before.
  assert.deepEqual([...T.resolveSelection("plain-2", 5, ["", "1,3-4"])], [0, 2, 3], "legacy plain-N");
  assert.deepEqual([...T.resolveSelection("shake-1", 5, ["", "1,3-4"])], [], "unknown token without map");
  // Nested section tokens stay inert (one level only).
  const nested = [];
  nested.sections = { voronoi: ["voronoi-1"] };
  assert.deepEqual([...T.resolveSelection("voronoi-1", 3, nested)], [], "nested inert");
  assert.deepEqual([...T.resolveSelection("voronoi-1", 3, { voronoi: ["voronoi-1"] })], [], "sectionless object inert");
});

test("delay chase steps toward its own target per mode", () => {
  const target = (v) => ({ position: [v, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  const snap = target(0);
  const pace = { position: [100, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const full = { mode: 1, strength: 1, position: true, scale: true, rotation: true };
  // Even covers the travel uniformly: SPAN frames for the full range.
  const evenState = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  T.chaseToward(evenState, T.blankDelayVelocity(), target(100), snap, { ...full, mode: 0 }, pace, 1);
  assert.deepEqual(evenState.position, [40, 0, 0], "even paces itself in world units");
  T.chaseToward(evenState, T.blankDelayVelocity(), target(30), snap, { ...full, mode: 0 }, pace, 1);
  assert.deepEqual(evenState.position, [30, 0, 0], "even lands exactly, never crosses");
  const frozen = { position: [5, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const noTravel = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [0, 0, 0] };
  T.chaseToward(frozen, T.blankDelayVelocity(), target(100), snap, { ...full, mode: 0 }, noTravel, 1);
  assert.deepEqual(frozen.position, [5, 0, 0], "static travel holds");
  // Blend closes a quarter of the gap per step: fast far away, slow up close.
  const blendState = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  T.chaseToward(blendState, T.blankDelayVelocity(), target(100), snap, full, pace, 1);
  assert.deepEqual(blendState.position, [25, 0, 0], "blend closes fast-then-slow");
  const near = { position: [90, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  T.chaseToward(near, T.blankDelayVelocity(), target(100), snap, full, pace, 1);
  assert.ok(near.position[0] <= 100, "blend never crosses the target");
  // Spring crosses past a step, then rings back.
  const chase = { mode: 2, strength: 1, position: true, scale: true, rotation: true };
  let spring = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  let svel = T.blankDelayVelocity();
  let peak = -Infinity;
  for (let f = 0; f < 60; f += 1) {
    const next = copyState(spring);
    const nextVel = copyVel(svel);
    T.chaseToward(next, nextVel, target(100), target(100), chase, pace, 1);
    spring = next;
    svel = nextVel;
    if (spring.position[0] > peak) peak = spring.position[0];
  }
  assert.ok(peak > 100, "spring crosses past a step");
  assert.ok(Math.abs(spring.position[0] - 100) < 5, "spring rings back down");
  // Bypass snaps to the target and clears stale velocity.
  const stale = { position: [999, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const staleVel = {
    positionVelocity: [50, 0, 0],
    rotationVelocity: [0, 0, 0],
    scaleVelocity: [0, 0, 0],
  };
  T.chaseToward(stale, staleVel, target(100), target(7), null, pace, 1);
  assert.deepEqual(stale.position, [7, 0, 0], "bypass follows the raw target");
  assert.deepEqual(staleVel.positionVelocity, [0, 0, 0], "bypass clears velocity");
  // A toggled-off channel follows the target while others chase.
  const mixed = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  T.chaseToward(
    mixed,
    T.blankDelayVelocity(),
    { position: [100, 0, 0], rotation: [50, 0, 0], scale: [1, 1, 1] },
    target(7),
    { mode: 2, strength: 1, position: false, scale: true, rotation: true },
    pace,
    1
  );
  assert.deepEqual(mixed.position, [7, 0, 0], "delayed-off channel follows target");
  assert.ok(mixed.rotation[0] > 0, "enabled channels still chase");
});


test("delay strength blends the trail with the raw target", () => {
  const target = { position: [10, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const chased = { position: [4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  assert.deepEqual(T.blendDelayOutput(target, chased, 0).position, [10, 0, 0], "0% is off");
  assert.deepEqual(T.blendDelayOutput(target, chased, 1).position, [4, 0, 0], "100% is full trail");
  assert.deepEqual(T.blendDelayOutput(target, chased, 0.5).position, [7, 0, 0], "half blends");
});
