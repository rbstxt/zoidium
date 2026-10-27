"use strict";

// Coverage for the ExpressText+ Phase-1 core: letter selection parsing,
// strength/field/stagger math, effector envelopes, per-letter evaluation
// and the property schema. All pure (no DOM, THREE, or CM3 runtime).

const assert = require("node:assert/strict");
const test = require("node:test");

const mod = require("../plugins/expresstext-plus/expresstext.js");
const T = mod._test;

// Legacy helper: the old combined-props evaluation now runs as an explicit
// four-layer stack, which is exactly what the panel model composes.
T.evaluateLetter = (props, frame, index, list, base) =>
  T.evaluateStack(
    ["shake", "plain", "random", "delay"].map((kind) => ({ kind, props })),
    props,
    frame,
    index,
    list,
    base
  );

function props(values) {
  return T.staticProps(values);
}

// Frame-varying rows: a value may be a constant or a function of frame,
// mirroring host keyframes.
function keyedProps(values) {
  return {
    get(key) {
      const value = values[key];
      if (value === undefined) return undefined;
      return {
        get: (frame) => (typeof value === "function" ? value(frame) : value),
      };
    },
  };
}

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

function copyState(state) {
  return {
    position: state.position.slice(),
    rotation: state.rotation.slice(),
    scale: state.scale.slice(),
  };
}

function copyVel(vel) {
  return {
    positionVelocity: vel.positionVelocity.slice(),
    rotationVelocity: vel.rotationVelocity.slice(),
    scaleVelocity: vel.scaleVelocity.slice(),
  };
}

test("delay strength blends the trail with the raw target", () => {
  const target = { position: [10, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  const chased = { position: [4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };
  assert.deepEqual(T.blendDelayOutput(target, chased, 0).position, [10, 0, 0], "0% is off");
  assert.deepEqual(T.blendDelayOutput(target, chased, 1).position, [4, 0, 0], "100% is full trail");
  assert.deepEqual(T.blendDelayOutput(target, chased, 0.5).position, [7, 0, 0], "half blends");
});

test("static poses hold exactly with scale untouched", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const list = { order: [0], total: 1 };
  const base = [0, 0, 0];
  const spin = {
    kind: "plain",
    props: props({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: [0, 0, 0],
      plainRotation: [360, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const springLayer = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 2,
      delayField: 0,
    }),
  };
  const stack = [spin, springLayer];
  for (const frame of [0, 5, 10, 20, 40]) {
    const out = T.evaluateStack(stack, containerProps, frame, 0, list, base);
    assert.deepEqual(out.rotation, [360, 0, 0], `frame ${frame} holds the static pose`);
    assert.deepEqual(out.scale, [1, 1, 1], `frame ${frame} never scales`);
    assert.deepEqual(out.position, [0, 0, 0], `frame ${frame} never drifts`);
  }
});

test("spring overshoots arrivals, then lands exactly", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const list = { order: [0], total: 1 };
  const base = [0, 0, 0];
  const spinKeys = {
    kind: "plain",
    props: keyedProps({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: [0, 0, 0],
      plainRotation: (frame) => [Math.min(360, Math.max(0, frame * 12)), 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const springDelay = (strength) => ({
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: strength,
      delayMode: 2,
      delayField: 0,
    }),
  });
  const at = (layers, frame) =>
    T.evaluateStack(layers, containerProps, frame, 0, list, base);
  const peak = (layers) => {
    let top = -Infinity;
    for (let frame = 0; frame <= 60; frame += 1) {
      const r = at(layers, frame).rotation[0];
      if (r > top) top = r;
    }
    return top;
  };
  // Arrival overshoots past the pose, scaled by Strength.
  const peak100 = peak([spinKeys, springDelay(100)]);
  assert.ok(peak100 > 380, "spring 100 overshoots markedly");
  assert.ok(peak100 < 450, "spring 100 stays bounded");
  const peak50 = peak([spinKeys, springDelay(50)]);
  assert.ok(peak50 > 360 && peak50 < peak100, "strength scales the bounce");
  const peak25 = peak([spinKeys, springDelay(25)]);
  assert.ok(peak25 > 360 && peak25 < peak50, "low strength barely ripples");
  // Then it lands exactly and stays there.
  assert.ok(Math.abs(at([spinKeys, springDelay(100)], 150).rotation[0] - 360) < 0.5, "lands exactly");
  assert.deepEqual(at([spinKeys, springDelay(100)], 31).scale, [1, 1, 1], "bounce is rotation, not scale");
  // Even trails the same keys with no overshoot at all.
  const evenStack = [spinKeys, { ...springDelay(100), kind: "delay" }];
  evenStack[1] = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 0,
      delayField: 0,
    }),
  };
  assert.deepEqual(at(evenStack, 15).rotation, [180, 0, 0], "even head replays exactly");
  assert.deepEqual(at(evenStack, 31).rotation, [360, 0, 0], "even lands with the keys");
  assert.deepEqual(at(evenStack, 40).rotation, [360, 0, 0], "even stays landed");
  assert.ok(peak(evenStack) <= 360 + 1e-9, "even never crosses");
  // Blend trails fast-then-slow, never crossing either.
  const blendStack = [spinKeys, { ...evenStack[1], kind: "delay" }];
  blendStack[1] = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 1,
      delayField: 0,
    }),
  };
  assert.ok(peak(blendStack) <= 360 + 1e-9, "blend never crosses");
  assert.ok(Math.abs(at(blendStack, 80).rotation[0] - 360) < 0.5, "blend settles exactly");
  // Bounded sweep: wild arrivals stay near the pose, never explode.
  let lo = Infinity;
  let hi = -Infinity;
  for (let frame = 28; frame <= 36; frame += 1) {
    const r = at([spinKeys, springDelay(100)], frame).rotation[0];
    if (r < lo) lo = r;
    if (r > hi) hi = r;
  }
  assert.ok(hi <= 360 + 60 + 1e-9 && lo >= 360 - 60 - 1e-9, "overshoot stays bounded");
});

test("delay bounces letters as a swept field arrives, like the c4d reference", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const list = { order: [0, 1, 2, 3], total: 4 };
  const bases = [
    [-30, 0, 0],
    [-10, 0, 0],
    [10, 0, 0],
    [30, 0, 0],
  ];
  // Plain rotation driven ONLY by a field sweeping right-to-left across
  // the letters (the c4d Box Field move): no rotation keyframes at all.
  const sweeping = (fieldKind) => ({
    kind: "plain",
    props: keyedProps({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: [0, 0, 0],
      plainRotation: [360, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: fieldKind,
      plainFieldPosition: (frame) => [100 - frame * 10, 0, 0],
      plainFieldScale: [100, 100, 100],
    }),
  });
  const springDelay = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 2,
      delayField: 0,
    }),
  };
  const evenDelay = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 0,
      delayField: 0,
    }),
  };
  // Linear ramp: every letter overshoots past the full pose on arrival,
  // then rings back down and stays there, scale untouched throughout.
  // (The sweep staggers each letter, so arrivals land on different frames.)
  {
    const stack = [sweeping(1), springDelay];
    const at = (frame, index) =>
      T.evaluateStack(stack, containerProps, frame, index, list, bases[index]);
    for (let index = 0; index < 4; index += 1) {
      let peak = -Infinity;
      for (let frame = 0; frame <= 60; frame += 1) {
        const r = at(frame, index).rotation[0];
        if (r > peak) peak = r;
      }
      assert.ok(peak > 360, `linear field: letter ${index} bounces on arrival`);
    }
    for (let index = 0; index < 4; index += 1) {
      const settled = at(150, index);
      assert.ok(Math.abs(settled.rotation[0] - 360) < 2, `letter ${index} settles`);
      assert.deepEqual(settled.scale, [1, 1, 1], `letter ${index} never scales`);
    }
    // Even lands exactly with the sweep: a lagged static target is static.
    const evenStack = [sweeping(1), evenDelay];
    const evenAt = (frame, index) =>
      T.evaluateStack(evenStack, containerProps, frame, index, list, bases[index]);
    for (let index = 0; index < 4; index += 1) {
      assert.deepEqual(evenAt(60, index).rotation, [360, 0, 0], `letter ${index} lands exactly`);
    }
  }
  // Box volume: letters bounce as the feathered edge reaches them, then
  // go quiet once the box has passed.
  {
    const stack = [sweeping(2), springDelay];
    const at = (frame, index) =>
      T.evaluateStack(stack, containerProps, frame, index, list, bases[index]);
    for (let index = 0; index < 4; index += 1) {
      let peak = -Infinity;
      for (let frame = 0; frame <= 60; frame += 1) {
        const r = at(frame, index).rotation[0];
        if (r > peak) peak = r;
      }
      assert.ok(peak > 300, `box field: letter ${index} bounces on entry`);
    }
    for (let index = 0; index < 4; index += 1) {
      const settled = at(150, index);
      assert.ok(Math.abs(settled.rotation[0]) < 2, `letter ${index} rests after passing`);
      assert.deepEqual(settled.scale, [1, 1, 1], `letter ${index} never scales`);
    }
    const evenStack = [sweeping(2), evenDelay];
    const evenAt = (frame, index) =>
      T.evaluateStack(evenStack, containerProps, frame, index, list, bases[index]);
    for (let index = 0; index < 4; index += 1) {
      assert.deepEqual(evenAt(60, index).rotation, [0, 0, 0], `letter ${index} rests exactly`);
    }
  }
});

test("delay times forward and reversed sweeps identically", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const list = { order: [0, 1, 2, 3], total: 4 };
  const bases = [
    [-30, 0, 0],
    [-10, 0, 0],
    [10, 0, 0],
    [30, 0, 0],
  ];
  // Box field sweeping across and back; Plain 360 tumble on every letter.
  const sweeping = (x0, x1) => ({
    kind: "plain",
    props: keyedProps({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: [0, 0, 0],
      plainRotation: [360, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 2,
      plainFieldPosition: (frame) => [x0 + ((x1 - x0) * frame) / 60, 0, 0],
      plainFieldScale: [60, 60, 60],
    }),
  });
  const mk = (mode) => ({
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: mode,
      delayField: 0,
    }),
  });
  // First frame each letter's rotation reaches halfway: the wavefront clock.
  const crossings = (x0, x1, mode) => {
    const times = [];
    for (let index = 0; index < 4; index += 1) {
      let cross = -1;
      for (let frame = 0; frame <= 90; frame += 1) {
        const r = T.evaluateStack(
          [sweeping(x0, x1), mk(mode)],
          containerProps,
          frame,
          index,
          list,
          bases[index]
        ).rotation[0];
        if (r >= 180) {
          cross = frame;
          break;
        }
      }
      times.push(cross);
    }
    return times;
  };
  for (const mode of [0, 1, 2]) {
    const forward = crossings(-80, 80, mode);
    const reverse = crossings(80, -80, mode);
    assert.deepEqual(
      reverse,
      [forward[3], forward[2], forward[1], forward[0]],
      `mode ${mode}: reverse mirrors forward`
    );
    assert.ok(
      forward[0] < forward[1] && forward[1] < forward[2] && forward[2] < forward[3],
      `mode ${mode}: forward cascades in letter order`
    );
    assert.ok(
      reverse[3] < reverse[2] && reverse[2] < reverse[1] && reverse[1] < reverse[0],
      `mode ${mode}: reverse cascades in mirror order`
    );
  }
  // Deterministic: same frame twice, same pose.
  const flight = {
    kind: "plain",
    props: keyedProps({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: (frame) => [Math.max(0, frame) * 10, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const at = (frame, index) =>
    T.evaluateStack([flight, mk(0)], containerProps, frame, index, list, bases[0]);
  assert.deepEqual(at(14, 1), at(14, 1), "scrubbing is deterministic");
  // Unknown modes fall back to Even.
  const strange = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 9,
      delayField: 0,
    }),
  };
  assert.deepEqual(
    T.evaluateStack([flight, strange], containerProps, 14, 1, list, bases[0]).position,
    at(14, 1).position,
    "unknown mode is even"
  );
});

test("delay cascades an animated plain flight like the c4d tutorial", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  // Four letters spread in X, like a split text line.
  const list = { order: [0, 1, 2, 3], total: 4 };
  const bases = [
    [-30, 0, 0],
    [-10, 0, 0],
    [10, 0, 0],
    [30, 0, 0],
  ];
  // The tutorial's animated Plain: a position flight, gated by a static
  // linear field so each letter flies a different distance.
  const flying = {
    kind: "plain",
    props: keyedProps({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: (frame) => [Math.max(0, frame) * 10, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 1,
      plainFieldPosition: [0, 0, 0],
      plainFieldScale: [100, 100, 100],
    }),
  };
  const delayLayer = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 0,
      delayField: 0,
    }),
  };
  const stack = [flying, delayLayer];
  const at = (frame, index) =>
    T.evaluateStack(stack, containerProps, frame, index, list, bases[index]);
  // Linear field weights across the line: 0.2, 0.4, 0.6, 0.8.
  // Even tracks gentle motion exactly, so every letter rides its own
  // field-weighted flight; the trail only shows on fast moves.
  assert.ok(
    Math.abs(at(10, 0).position[0] - 20) < 1e-6,
    "first letter mid-flight"
  );
  assert.ok(
    Math.abs(at(10, 3).position[0] - 80) < 1e-6,
    "last letter rides its own steeper flight"
  );
  assert.ok(
    Math.abs(at(30, 1).position[0] - 120) < 1e-6,
    "second letter replays its own flight, delayed"
  );
  assert.ok(
    Math.abs(at(30, 3).position[0] - 240) < 1e-6,
    "last letter replays its own flight, delayed"
  );
  assert.deepEqual(at(30, 1).scale, [1, 1, 1], "cascade never scales");
});

test("delay link params gate letters like the c4d selection", () => {
  const list = { order: [0, 1, 2], total: 3 };
  const base = [0, 0, 0];
  const mk = (extra) =>
    props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 0,
      delayField: 0,
      ...extra,
    });
  const st0 = T.delayLinkParams(mk(), 0, 0, list, base, []);
  assert.equal(st0.strength, 1, "strength counts 0..1");
  assert.equal(st0.mode, 0, "mode carried");
  assert.equal(st0.position, true, "position delayed by default");
  assert.equal(st0.scale, true, "scale delayed by default");
  assert.equal(st0.rotation, true, "rotation delayed by default");
  assert.equal(
    T.delayLinkParams(mk({ delayEnable: 0 }), 0, 0, list, base, []),
    null,
    "disabled bypasses"
  );
  assert.equal(
    T.delayLinkParams(mk({ delayLetters: "1" }), 0, 1, list, base, []),
    null,
    "unselected bypasses"
  );
  assert.equal(
    T.delayLinkParams(mk({ delayStrength: 0 }), 0, 0, list, base, []),
    null,
    "zero strength bypasses"
  );
  assert.equal(
    T.delayLinkParams(mk({ delayField: 2, delayFieldPosition: [100, 0, 0] }), 0, 0, list, base, []),
    null,
    "outside field bypasses"
  );
  const spring = T.delayLinkParams(mk({ delayMode: 2 }), 0, 0, list, base, []);
  assert.equal(spring.mode, 2, "spring mode carried");
  assert.equal(spring.strength, 1, "spring fully on at strength 100");
  const off = T.delayLinkParams(mk({ delayPosition: 0 }), 0, 0, list, base, []);
  assert.equal(off.position, false, "position toggle respected");
  assert.equal(off.rotation, true, "other channels unaffected");
  // plain-N selection tokens resolve against the stack's plain lists.
  assert.ok(
    T.delayLinkParams(mk({ delayLetters: "plain-2" }), 0, 1, list, base, ["1", "2"]) !== null,
    "plain-2 selects letter 1"
  );
  assert.equal(
    T.delayLinkParams(mk({ delayLetters: "plain-2" }), 0, 0, list, base, ["1", "2"]),
    null,
    "plain-2 skips letter 0"
  );
});

test("keyframed stacks trail per letter behind the motion", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const list = { order: [0, 1], total: 2 };
  const base = [0, 0, 0];
  const moving = {
    kind: "plain",
    props: keyedProps({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: (frame) => [frame, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const delayLayer = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 2,
      delayField: 0,
    }),
  };
  const stack = [moving, delayLayer];
  const at = (frame, index) =>
    T.evaluateStack(stack, containerProps, frame, index, list, base);
  // Spring trails the motion start instead of jumping onto it.
  const start42 = at(4, 0).position[0];
  assert.ok(start42 > 0 && start42 < 4, "spring trails the start");
  assert.deepEqual(at(4, 0).scale, [1, 1, 1], "no scale tricks, ever");
  // Same target, same trail: with no field to stagger them, both
  // letters chase the identical motion identically (the cascade comes
  // from the field sweep, never from the letter index).
  assert.deepEqual(at(14, 1).position, at(14, 0).position, "identical motion trails identically");
  assert.ok(at(14, 1).position[0] > 0, "letter 1 is already moving");
  assert.deepEqual(at(14, 1).scale, [1, 1, 1], "trailing never scales");
  // Even replays the keyframes shifted but untouched (no smoothing at all).
  const evenStack = [
    moving,
    {
      kind: "delay",
      props: props({
        delayEnable: 1,
        delayLetters: "",
        delayStrength: 100,
        delayMode: 0,
        delayField: 0,
      }),
    },
  ];
  assert.deepEqual(
    T.evaluateStack(evenStack, containerProps, 9, 0, list, base).position,
    [9, 0, 0],
    "even replays untouched"
  );
  assert.deepEqual(
    T.evaluateStack(evenStack, containerProps, 9, 0, list, base).scale,
    [1, 1, 1],
    "even never touches scale"
  );
  assert.deepEqual(
    T.evaluateStack(evenStack, containerProps, 14, 1, list, base).position,
    [14, 0, 0],
    "even letter 1 rides its own target too"
  );
  // Static poses still get the spring entrance (no time variation to replay).
  const still = {
    kind: "plain",
    props: props({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: [10, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const staticDelay = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 0,
      delayField: 0,
    }),
  };
  const staticStack = [still, staticDelay];
  assert.deepEqual(
    T.evaluateStack(staticStack, containerProps, 5, 0, list, base).position,
    [10, 0, 0],
    "static pose holds (no fade tricks)"
  );
  assert.deepEqual(
    T.evaluateStack(staticStack, containerProps, 1, 0, list, base).position,
    [10, 0, 0],
    "static pose holds from the first frame"
  );
});

test("delay animates the whole stack wherever it sits", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const list = { order: [0, 1], total: 2 };
  const base = [0, 0, 0];
  const delayLayer = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 0,
      delayField: 0,
    }),
  };
  const plainLayer = {
    kind: "plain",
    props: props({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: [10, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const at = (layers, frame, index) =>
    T.evaluateStack(layers, containerProps, frame, index, list, base);
  // Delay first or last: static stacks simply hold their pose.
  for (const stack of [[delayLayer, plainLayer], [plainLayer, delayLayer]]) {
    assert.deepEqual(at(stack, 0, 0).position, [10, 0, 0], "static holds from frame 0");
    assert.deepEqual(at(stack, 5, 0).position, [10, 0, 0], "static holds mid-window");
    assert.deepEqual(at(stack, 10, 0).position, [10, 0, 0], "settled on pose");
    assert.deepEqual(at(stack, 0, 1).position, [10, 0, 0], "static holds before its start");
    assert.deepEqual(at(stack, 20, 1).position, [10, 0, 0], "second letter settles last");
  }
  // Parent scale follows the fade, then holds the pose scale.
  const scaleLayer = {
    kind: "plain",
    props: props({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: [0, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [3, 3, 3],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  // Parent scale is untouched by the delay: static holds the pose scale.
  assert.deepEqual(at([delayLayer, scaleLayer], 1, 0).scale, [3, 3, 3], "scale holds");
  assert.deepEqual(at([delayLayer, scaleLayer], 5, 0).scale, [3, 3, 3], "scale holds");
  // No delay layer: the pose is immediate.
  assert.deepEqual(at([plainLayer], 0, 0).position, [10, 0, 0], "no delay is instant");
});

test("delay reads a plain section selection for its letters", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const list = { order: [0, 1, 2], total: 3 };
  const base = [0, 0, 0];
  const plainA = {
    kind: "plain",
    props: props({
      plainEnable: 1,
      plainLetters: "1",
      plainStrength: 100,
      plainPosition: [10, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const plainB = {
    kind: "plain",
    props: props({
      plainEnable: 1,
      plainLetters: "2-3",
      plainStrength: 100,
      plainPosition: [10, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const delayLayer = {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "plain-2",
      delayStrength: 100,
      delayMode: 0,
      delayField: 0,
    }),
  };
  const stack = [plainA, plainB, delayLayer];
  const at = (frame, index) =>
    T.evaluateStack(stack, containerProps, frame, index, list, base);
  assert.deepEqual(at(0, 0).position, [10, 0, 0], "unselected letter is posed at once");
  assert.deepEqual(at(0, 1).position, [10, 0, 0], "static pose holds (no fade tricks)");
  assert.deepEqual(at(5, 1).position, [10, 0, 0], "first selected letter holds");
  assert.deepEqual(at(0, 2).position, [10, 0, 0], "static pose holds before its start");
  assert.deepEqual(at(20, 2).position, [10, 0, 0], "second selected letter settles");
});

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

test("spline arranges letters along built-in paths", () => {
  const list = { order: [0, 1, 2, 3], total: 4 };
  const bases = [
    [-30, 0, 0],
    [-10, 0, 0],
    [10, 0, 0],
    [30, 0, 0],
  ];
  const aux = { extent: { lo: -30, hi: 30 } };
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const spl = (extra) => ({
    kind: "spline",
    props: props({
      splineEnable: 1,
      splineLetters: "",
      splineStrength: 100,
      splineMode: 0,
      splineTransform: 0,
      splinePath: 0,
      splineLength: 100,
      splineRadius: 50,
      splineRadiusEnd: 50,
      splineHeight: 100,
      splineTurns: 1,
      splinePlane: 0,
      splineReverse: 0,
      splineOffset: 0,
      splineStart: 0,
      splineEnd: 100,
      splineClamp: 1,
      splinePosition: 1,
      splineRotation: 1,
      splineHeading: 0,
      splinePitch: 0,
      splineBank: 0,
      splineDelay: 0,
      splineDelayOrder: 0,
      splineField: 0,
      ...extra,
    }),
  });
  const anchor = (frame, index, extra, a) => {
    const out = T.evaluateStack([spl(extra)], containerProps, frame, index, list, bases[index], a);
    return [
      bases[index][0] + out.position[0],
      bases[index][1] + out.position[1],
      bases[index][2] + out.position[2],
    ];
  };
  const near = (v, target, msg) => assert.ok(Math.abs(v - target) < 1e-6, `${msg} (got ${v})`);
  // Line Step: letters land evenly across the length.
  const lineXs = [0, 1, 2, 3].map((i) => anchor(0, i)[0]);
  assert.deepEqual(
    lineXs.map((v) => Math.round(v * 100) / 100),
    [-50, -16.67, 16.67, 50],
    "line spreads evenly"
  );
  // Circle: every anchor sits on the radius, turned to the tangent.
  for (let index = 0; index < 4; index += 1) {
    const p = anchor(0, index, { splinePath: 1 });
    near(Math.hypot(p[0], p[1]), 50, `letter ${index} on the ring`);
  }
  const tangent = T.evaluateStack([spl({ splinePath: 1 })], containerProps, 0, 0, list, bases[0], aux);
  near(tangent.rotation[2], Math.PI / 2, "head letter faces the tangent");
  // Helix rises one turn from [50,0,0] to [50,100,0].
  const h0 = anchor(0, 0, { splinePath: 2 });
  const h3 = anchor(0, 3, { splinePath: 2 });
  assert.deepEqual(h0.map((v) => Math.round(v * 1e9) / 1e9), [50, 0, 0], "helix starts on +X");
  near(h3[0], 50, "helix ends above the start");
  near(h3[1], 100, "helix climbs the height");
  near(Math.abs(h3[2]), 0, "helix closes the turn");
  // Start/End fence the arranged area.
  const fenced = [0, 1, 2, 3].map((i) => anchor(0, i, { splineStart: 25, splineEnd: 75 })[0]);
  assert.deepEqual(
    fenced.map((v) => Math.round(v * 100) / 100),
    [-25, -8.33, 8.33, 25],
    "start/end fence the area"
  );
  // Offset wanders; Clamp piles at the end, wrap appears mid-path.
  near(anchor(0, 0, { splineOffset: 10 })[0], -40, "offset wanders");
  near(anchor(0, 3, { splineOffset: 150 })[0], 50, "clamp piles at the end");
  near(anchor(0, 3, { splineOffset: 150, splineClamp: 0 })[0], 0, "wrap appears mid-path");
  near(anchor(0, 0, { splineReverse: 1 })[0], 50, "reverse mirrors to the end");
  // Relative keeps the layout and slides every letter by the same shift.
  const shifts = [0, 1, 2, 3].map(
    (i) => T.evaluateStack([spl({ splineTransform: 1, splineOffset: 10 })], containerProps, 0, i, list, bases[i], aux).position[0]
  );
  assert.deepEqual(shifts, [10, 10, 10, 10], "relative shifts rigidly");
  // Strength blends the distance to the path.
  near(anchor(0, 3, { splineStrength: 50 })[0], 40, "half strength lands halfway");
  assert.deepEqual(anchor(0, 3, { splineStrength: 0 })[0], 30, "zero strength is identity");
  near(anchor(0, 3, { splineStrength: -100 })[0], 10, "negative mirrors across the path");
  // Falloff mode positions letters by their field weight.
  const graded = [0, 1, 2, 3].map(
    (i) =>
      anchor(0, i, {
        splineMode: 1,
        splineField: 1,
        splineFieldPosition: [0, 0, 0],
        splineFieldScale: [100, 100, 100],
      })[0]
  );
  assert.deepEqual(
    graded.map((v) => Math.round(v * 100) / 100),
    [-30, -10, 10, 30],
    "falloff maps weight to path"
  );
  // Rotation toggle, bank, and position toggle compose independently.
  const norot = T.evaluateStack([spl({ splinePath: 1, splineRotation: 0 })], containerProps, 0, 1, list, bases[1], aux);
  assert.deepEqual(norot.rotation, [0, 0, 0], "rotation toggle holds orientation");
  const banked = T.evaluateStack(
    [spl({ splinePath: 1, splineBank: Math.PI / 4 })],
    containerProps,
    0,
    1,
    list,
    bases[1],
    aux
  );
  near(banked.rotation[2], Math.atan2(Math.cos((2 * Math.PI) / 3), -Math.sin((2 * Math.PI) / 3)) + Math.PI / 4, "bank rolls on top of the tangent");
  const placed = T.evaluateStack(
    [spl({ splinePath: 1, splinePosition: 0 })],
    containerProps,
    0,
    1,
    list,
    bases[1],
    aux
  );
  assert.deepEqual(placed.position, [0, 0, 0], "position toggle holds the layout");
  assert.ok(Math.abs(placed.rotation[2]) > 0.1, "orientation still aligns");
  // Bypass paths stay identity: disabled, unselected, outside the field.
  assert.deepEqual(anchor(0, 0, { splineEnable: 0 })[0], -30, "disabled holds");
  assert.deepEqual(anchor(0, 1, { splineLetters: "1" })[0], -10, "unselected holds");
  const outside = anchor(0, 0, { splineField: 2, splineFieldPosition: [100, 0, 0] })[0];
  assert.deepEqual(outside, -30, "outside the field holds");
  // Relative without shared extents counts evenly like Step.
  const noAux = [0, 1, 2, 3].map((i) => {
    const out = T.evaluateStack([spl({ splineMode: 2 })], containerProps, 0, i, list, bases[i]);
    return bases[i][0] + out.position[0];
  });
  assert.deepEqual(
    noAux.map((v) => Math.round(v * 100) / 100),
    [-50, -16.67, 16.67, 50],
    "relative falls back to step without extents"
  );
  // Delay composes: a static path is chased exactly.
  const delayed = [0, 1, 2, 3].map((i) => {
    const stack = [
      spl({}),
      { kind: "delay", props: props({ delayEnable: 1, delayLetters: "", delayStrength: 100, delayMode: 0, delayField: 0 }) },
    ];
    const out = T.evaluateStack(stack, containerProps, 10, i, list, bases[i], aux);
    return bases[i][0] + out.position[0];
  });
  assert.deepEqual(
    delayed.map((v) => Math.round(v * 100) / 100),
    [-50, -16.67, 16.67, 50],
    "delay holds the static path"
  );
  // Tilt orients the whole path: a circle pitched 90 degrees about X lies
  // flat in XZ, radius preserved on every letter.
  const flat = [0, 1, 2, 3].map((i) => anchor(0, i, { splinePath: 1, splineTilt: [Math.PI / 2, 0, 0] }));
  for (let index = 0; index < 4; index += 1) {
    near(flat[index][1], 0, `tilted letter ${index} has no height`);
    near(Math.hypot(flat[index][0], flat[index][2]), 50, `tilted letter ${index} keeps the radius`);
  }
  // Orientation composes exactly: tilting 30 degrees about Z shifts every
  // tangent angle by exactly pi/6.
  for (const index of [0, 2]) {
    const plain = T.evaluateStack([spl({})], containerProps, 0, index, list, bases[index], aux).rotation[2];
    const tilted = T.evaluateStack(
      [spl({ splineTilt: [0, 0, Math.PI / 6] })],
      containerProps,
      0,
      index,
      list,
      bases[index],
      aux
    ).rotation[2];
    near(tilted - plain, Math.PI / 6, `letter ${index} orientation follows the tilt`);
  }
  // A line tilted 90 degrees about Z stands vertical.
  const standing = [0, 1, 2, 3].map((i) => anchor(0, i, { splineTilt: [0, 0, Math.PI / 2] }));
  assert.deepEqual(
    standing.map((p) => [Math.round(p[0] * 100) / 100 + 0, Math.round(p[1] * 100) / 100 + 0]),
    [
      [0, -50],
      [0, -16.67],
      [0, 16.67],
      [0, 50],
    ],
    "tilted line stands vertical"
  );
});

test("orbit revolves selected letters about their own center", () => {
  const list = { order: [0, 1, 2, 3], total: 4 };
  const bases = [
    [-30, 0, 0],
    [-10, 0, 0],
    [10, 0, 0],
    [30, 0, 0],
  ];
  const aux = { bases };
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const orb = (extra) => ({
    kind: "orbit",
    props: props({
      orbitEnable: 1,
      orbitLetters: "1-2",
      orbitStrength: 100,
      orbitAngle: [0, 0, Math.PI],
      orbitRadius: 100,
      orbitDelay: 0,
      orbitDelayOrder: 0,
      orbitField: 0,
      ...extra,
    }),
  });
  const anchor = (frame, index, extra, a) => {
    const out = T.evaluateStack([orb(extra)], containerProps, frame, index, list, bases[index], a === undefined ? aux : a);
    return [
      bases[index][0] + out.position[0],
      bases[index][1] + out.position[1],
      bases[index][2] + out.position[2],
    ];
  };
  const near = (v, target, msg) => assert.ok(Math.abs(v - target) < 1e-6, `${msg} (got ${v})`);
  // Half turn swaps the pair about their midpoint (-20): T lands on E.
  const x0 = anchor(0, 0)[0];
  const x1 = anchor(0, 1)[0];
  near(x0, -10, "first letter lands on the second slot");
  near(x1, -30, "second letter lands on the first slot");
  // Glyphs turn with the orbit (rigid revolution).
  const r0 = T.evaluateStack([orb()], containerProps, 0, 0, list, bases[0], aux).rotation[2];
  near(r0, Math.PI, "glyphs spin with the orbit");
  // Unselected letters stay put and upright.
  near(anchor(0, 2)[0], 10, "unselected holds its slot");
  const r2 = T.evaluateStack([orb()], containerProps, 0, 2, list, bases[2], aux).rotation[2];
  near(r2, 0, "unselected stays upright");
  // Quarter turn drops the first letter below the midpoint.
  const q = anchor(0, 0, { orbitAngle: [0, 0, Math.PI / 2] });
  near(q[0], -20, "quarter turn centers horizontally");
  near(q[1], -10, "quarter turn drops below");
  // Radius scales the orbit around the center: half radius lands halfway
  // between the center (-20) and the full swap (-10).
  near(anchor(0, 0, { orbitRadius: 50 })[0], -15, "half radius halves the orbit");
  // Zero radius collapses to the center; zero angle is the identity.
  near(anchor(0, 0, { orbitRadius: 0 })[0], -20, "zero radius gathers at the center");
  // Per-axis tumbles: X flips the pair in place along the line, Y swaps
  // with a yaw. Same slots out, different glyph turns.
  const flipX = T.evaluateStack(
    [orb({ orbitAngle: [Math.PI, 0, 0] })],
    containerProps,
    0,
    0,
    list,
    bases[0],
    aux
  );
  near(bases[0][0] + flipX.position[0], -30, "X orbit holds the slot");
  near(flipX.rotation[0], Math.PI, "X orbit turns the glyph");
  near(flipX.rotation[2], 0, "X orbit leaves Z alone");
  const yawY = T.evaluateStack(
    [orb({ orbitAngle: [0, Math.PI, 0] })],
    containerProps,
    0,
    0,
    list,
    bases[0],
    aux
  );
  near(bases[0][0] + yawY.position[0], -10, "Y orbit swaps the pair too");
  near(yawY.rotation[1], Math.PI, "Y orbit yaws the glyph");
  near(anchor(0, 0, { orbitAngle: [0, 0, 0] })[0], -30, "zero angle holds the slot");
  // Strength blends the revolution in.
  near(anchor(0, 0, { orbitStrength: 50 })[0], -20, "half strength lands halfway");
  // A lone letter spins in place: nowhere to travel, still turns.
  const solo = T.evaluateStack(
    [orb({ orbitLetters: "2" })],
    containerProps,
    0,
    1,
    list,
    bases[1],
    aux
  );
  near(bases[1][0] + solo.position[0], -10, "lone letter holds its slot");
  near(solo.rotation[2], Math.PI, "lone letter still turns");
  // Bypass paths stay identity: disabled, empty selection, outside field.
  near(anchor(0, 0, { orbitEnable: 0 })[0], -30, "disabled holds");
  near(anchor(0, 0, { orbitLetters: "4" })[0], -30, "outside the selection holds");
  near(anchor(0, 0, { orbitField: 2, orbitFieldPosition: [100, 0, 0] })[0], -30, "outside the field holds");
  // Without shared bases the letter holds its slot (glyph still spins).
  const blind = T.evaluateStack([orb()], containerProps, 0, 0, list, bases[0]);
  near(blind.position[0], 0, "no shared layout holds position");
  near(blind.rotation[2], Math.PI, "no shared layout still turns");
});

test("twist twirls the line around its middle", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const list = { order: [0, 1, 2, 3], total: 4 };
  const base = [0, 0, 0];
  const tw = (extra) => ({
    kind: "twist",
    props: props({
      twistEnable: 1,
      twistLetters: "",
      twistStrength: 100,
      twistAngle: Math.PI,
      twistAxis: 2,
      twistDelay: 0,
      twistDelayOrder: 0,
      twistField: 0,
      ...extra,
    }),
  });
  const at = (frame, index, extra) =>
    T.evaluateStack([tw(extra)], containerProps, frame, index, list, base);
  // 180 end-to-end: outer letters counter-rotate 90 degrees.
  const rots = [0, 1, 2, 3].map((i) => at(0, i).rotation[2]);
  assert.deepEqual(
    rots.map((v) => Math.round(v * 1000) / 1000 + 0),
    [-1.571, -0.524, 0.524, 1.571],
    "centered twirl"
  );
  // Other axes take the same twirl.
  const round3 = (v) => Math.round(v * 1000) / 1000 + 0;
  assert.equal(round3(at(0, 0, { twistAxis: 0 }).rotation[0]), round3(rots[0]), "X axis carries it");
  assert.equal(round3(at(0, 0, { twistAxis: 1 }).rotation[1]), round3(rots[0]), "Y axis carries it");
  // A lone letter holds (no line to twist across); unselected stay still.
  const solo = T.evaluateStack([tw({})], containerProps, 0, 0, { order: [0], total: 1 }, base);
  assert.deepEqual(solo.rotation, [0, 0, 0], "lone letter holds");
  assert.deepEqual(solo.position, [0, 0, 0], "twist never moves");
  assert.deepEqual(at(0, 0, { twistLetters: "2" }).rotation, [0, 0, 0], "unselected still");
  assert.deepEqual(at(0, 0, { twistStrength: 0 }).rotation, [0, 0, 0], "zero strength rests");
  assert.deepEqual(at(0, 0, { twistEnable: 0 }).rotation, [0, 0, 0], "disabled rests");
});

test("wrap ripples the line upright", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const list = { order: [0, 1, 2, 3], total: 4 };
  const base = [0, 0, 0];
  const wr = (extra) => ({
    kind: "wrap",
    props: props({
      wrapEnable: 1,
      wrapLetters: "",
      wrapStrength: 100,
      wrapAmplitude: 10,
      wrapFrequency: 1,
      wrapPhase: 0,
      wrapDirection: 1,
      wrapDelay: 0,
      wrapDelayOrder: 0,
      wrapField: 0,
      ...extra,
    }),
  });
  const at = (frame, index, extra) =>
    T.evaluateStack([wr(extra)], containerProps, frame, index, list, base);
  // One full sine across the run: [0, +8.66, -8.66, 0].
  const ys = [0, 1, 2, 3].map((i) => Math.round(at(0, i).position[1] * 100) / 100 + 0);
  assert.deepEqual(ys, [0, 8.66, -8.66, 0], "flag wave");
  // Direction picks the displacement axis; letters never turn.
  assert.equal(Math.round(at(0, 1, { wrapDirection: 0 }).position[0] * 100) / 100 + 0, ys[1], "X carries the wave");
  assert.deepEqual(at(0, 1).rotation, [0, 0, 0], "upright letters");
  // Frequency packs cycles; phase travels the wave.
  const two = [0, 1, 2, 3].map((i) => Math.round(at(0, i, { wrapFrequency: 2 }).position[1] * 100) / 100 + 0);
  assert.deepEqual(two, [0, -8.66, 8.66, 0], "two cycles mirror");
  const shifted = at(0, 0, { wrapPhase: Math.PI / 2 }).position[1];
  assert.ok(Math.abs(shifted - 10) < 1e-9, "phase lifts the head");
  // A lone letter bobs rigidly; amplitude 0 is the identity.
  const solo = T.evaluateStack([wr({})], containerProps, 0, 0, { order: [0], total: 1 }, base);
  assert.equal(solo.position[1], 0, "lone letter rests at phase zero");
  assert.deepEqual(at(0, 1, { wrapAmplitude: 0 }).position, [0, 0, 0], "no amplitude rests");
  assert.deepEqual(at(0, 1, { wrapEnable: 0 }).position, [0, 0, 0], "disabled rests");
});

test("voronoi cells partition triangles deterministically", () => {
  // Two triangles side by side: two sites split them left/right.
  const pos = [0, 0, 0, 10, 0, 0, 0, 10, 0, 20, 0, 0, 30, 0, 0, 20, 10, 0];
  const cells = T.splitVoronoiCells(pos, [], [], 2, 1);
  assert.equal(cells.length, 2, "two nonempty cells");
  assert.deepEqual(
    cells.map((c) => c.position.length / 9),
    [1, 1],
    "one triangle each"
  );
  assert.deepEqual(T.splitVoronoiCells(pos, [], [], 2, 1).map((c) => c.center[0]), cells.map((c) => c.center[0]), "repeats");
  // Every triangle lands somewhere: counts cover the mesh.
  const many = [];
  for (let i = 0; i < 12; i += 1) many.push(0, 0, 0, 1, 0, 0, 0, 1, 0);
  const sum = T.splitVoronoiCells(many, [], [], 4, 3).reduce((n, c) => n + c.position.length / 9, 0);
  assert.equal(sum, 12, "partition covers all triangles");
  // Sites cap at the triangle count; empty input is safe.
  assert.ok(T.splitVoronoiCells(pos, [], [], 99, 1).length <= 2, "sites cap at triangles");
  assert.deepEqual(T.splitVoronoiCells([], [], [], 4, 1), [], "empty is safe");
  assert.deepEqual(T.splitVoronoiCells(null, null, null, 4, 1), [], "null is safe");
  // Live geometry hands typed arrays (Float32Array), not plain arrays.
  const typedCells = T.splitVoronoiCells(new Float32Array(pos), new Float32Array(pos.length), new Float32Array(12), 2, 1);
  assert.equal(typedCells.length, 2, "typed arrays partition too");
  assert.equal(typedCells.reduce((n, c) => n + c.position.length / 9, 0), 2, "typed triangles all land");
  // Chunk pose: offset along the center direction, signed spin.
  assert.deepEqual(
    T.voronoiChunkPose([10, 0, 0], [0, 0, 0], 5, [2, 4, 1], [1, -1, 1]),
    { offset: [5, 0, 0], rotation: [2, -4, 1] },
    "explode pushes outward, spin signs"
  );
  assert.deepEqual(
    T.voronoiChunkPose([0, 0, 0], [0, 0, 0], 5, [1, 1, 1], [1, 1, 1]),
    { offset: [0, 5, 0], rotation: [1, 1, 1] },
    "centered chunks rise"
  );
});

test("legacy r91 geometry converts to triangle arrays", () => {
  // Live letters are legacy Geometry: vertices/faces/faceVertexUvs.
  const legacy = {
    vertices: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 0, y: 10, z: 0 },
    ],
    faces: [
      {
        a: 0,
        b: 1,
        c: 2,
        normal: { x: 0, y: 0, z: 1 },
        vertexNormals: [{ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }],
      },
    ],
    faceVertexUvs: [[[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }]]],
  };
  const tri = T.geometryTriangleArrays(legacy);
  assert.deepEqual(tri.positions, [0, 0, 0, 10, 0, 0, 0, 10, 0], "flat positions");
  assert.deepEqual(tri.uvs, [0, 0, 1, 0, 0, 1], "flat uvs");
  assert.equal(tri.normals.length, 9, "per-vertex normals");
  assert.equal(T.splitVoronoiCells(tri.positions, tri.normals, tri.uvs, 1, 1).length, 1, "splitter takes it");
  // BufferGeometry attributes pass through as-is.
  const buffer = {
    attributes: {
      position: { array: [1, 2, 3] },
      normal: { array: [4, 5, 6] },
      uv: { array: [7, 8] },
    },
  };
  assert.equal(T.geometryTriangleArrays(buffer).positions, buffer.attributes.position.array, "buffer arrays pass through");
  assert.equal(T.geometryTriangleArrays(null), null, "null is safe");
  assert.equal(T.geometryTriangleArrays({}), null, "empty is safe");
});

test("euler parts read live and fake rotations", () => {
  assert.deepEqual(T.eulerParts({ x: 1, y: 2, z: 3, order: "YZX" }), [1, 2, 3, "YZX"], "live euler");
  assert.deepEqual(T.eulerParts({ args: [4, 5, 6, "ZYX"] }), [4, 5, 6, "ZYX"], "test fake");
  assert.deepEqual(T.eulerParts(null), [0, 0, 0, "XYZ"], "missing euler rests");
});

test("repeater specs count ghosts per layer", () => {
  const layers = [
    { kind: "plain", props: props({ plainEnable: 1 }) },
    {
      kind: "repeater",
      props: props({ repeaterEnable: 1, repeaterCopies: 3, repeaterMode: 1 }),
    },
    { kind: "repeater", props: props({ repeaterEnable: 0, repeaterCopies: 5 }) },
  ];
  const specs = T.repeaterSpecsFor(layers, 0);
  assert.equal(specs.length, 2, "both repeater layers found");
  assert.equal(specs[0].copies, 3, "copies read");
  assert.equal(specs[0].mode, 1, "mode read");
  assert.equal(specs[1].copies, 0, "disabled allocates nothing");
  const capped = T.repeaterSpecsFor(
    [{ kind: "repeater", props: props({ repeaterEnable: 1, repeaterCopies: 9999 }) }],
    0
  );
  assert.equal(capped[0].copies, 64, "copies stay bounded");
  const floored = T.repeaterSpecsFor(
    [{ kind: "repeater", props: props({ repeaterEnable: 1, repeaterCopies: 2.9 }) }],
    0
  );
  assert.equal(floored[0].copies, 2, "fractions floor");
  assert.deepEqual(T.repeaterSpecsFor([{ kind: "plain", props: props({}) }], 0), [], "no repeater, no specs");
});

test("repeater offsets trail per mode", () => {
  const lin = { mode: 0, offset: [10, 0, 0], rangeMin: [0, 0, 0], rangeMax: [0, 0, 0], seed: 7, lag: 2, fade: 0.5, copies: 3 };
  assert.deepEqual(T.repeaterCopyOffset(lin, 0, 1), [10, 0, 0], "linear steps per slot");
  assert.deepEqual(T.repeaterCopyOffset(lin, 0, 3), [30, 0, 0], "linear reaches slot 3");
  const rnd = { ...lin, mode: 1, rangeMin: [-10, -10, -10], rangeMax: [10, 10, 10] };
  const r1 = T.repeaterCopyOffset(rnd, 0, 1);
  const r1again = T.repeaterCopyOffset(rnd, 0, 1);
  assert.deepEqual(r1, r1again, "random repeats");
  assert.ok(r1.every((v) => v >= -10 && v <= 10), "random stays in range");
  assert.ok(
    JSON.stringify(T.repeaterCopyOffset(rnd, 0, 2)) !== JSON.stringify(r1) ||
      JSON.stringify(T.repeaterCopyOffset(rnd, 1, 1)) !== JSON.stringify(r1),
    "random spreads slots and letters"
  );
  const echo = { ...lin, mode: 2 };
  assert.deepEqual(
    T.repeaterCopyOffset(echo, 0, 2, [0, 0, 0]).map((v) => v + 0),
    [0, 0, 0],
    "still letters show no echo"
  );
  assert.deepEqual(
    T.repeaterCopyOffset(echo, 0, 2, null).map((v) => v + 0),
    [0, 0, 0],
    "missing velocity is safe"
  );
  assert.equal(T.repeaterCopyOpacity({ fade: 0.5, copies: 3 }, 1), 0.8333333333333334, "first ghost barely fades");
  assert.equal(T.repeaterCopyOpacity({ fade: 0.5, copies: 3 }, 3), 0.5, "last ghost halves");
  assert.equal(T.repeaterCopyOpacity({ fade: 0, copies: 3 }, 3), 1, "no fade stays solid");
  assert.equal(T.repeaterCopyOpacity({ fade: 1, copies: 0 }, 1), 1, "no copies stays lit");
});

test("repeater leaves letter controls untouched", () => {
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const list = { order: [0], total: 1 };
  const plain = {
    kind: "plain",
    props: props({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: [10, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const repeater = {
    kind: "repeater",
    props: props({ repeaterEnable: 1, repeaterCopies: 3, repeaterMode: 0 }),
  };
  const withGhosts = T.evaluateStack([plain, repeater], containerProps, 0, 0, list, [0, 0, 0]);
  assert.deepEqual(withGhosts.position, [10, 0, 0], "ghosts add no pose");
});

test("disabled stack is the identity", () => {
  const list = { order: [0, 1], total: 2 };
  const out = T.evaluateLetter(
    props({ shakeEnable: 0, plainEnable: 0, delayEnable: 0, randomEnable: 0, rotationOrder: "XYZ" }),
    12,
    0,
    list,
    [3, 4, 5]
  );
  assert.deepEqual(out.position, [0, 0, 0]);
  assert.deepEqual(out.rotation, [0, 0, 0]);
  assert.deepEqual(out.scale, [1, 1, 1]);
  assert.equal(out.eulerOrder, "XYZ");
});

test("unreadable rows fall back instead of killing the frame", () => {
  const throwing = () => {
    throw new Error("empty keyframes");
  };
  // get() throws -> definition value -> fallback, never propagates.
  assert.equal(T.readProp({ get: () => ({ get: throwing, definition: { value: 7 } }) }, "k", 0, 9), 7);
  assert.equal(T.readProp({ get: () => ({ get: throwing, value: 8 }) }, "k", 0, 9), 8);
  assert.equal(T.readProp({ get: () => ({ get: throwing }) }, "k", 0, 9), 9);
  assert.equal(T.readProp(null, "k", 0, 9), 9);
  assert.equal(T.readProp({}, "k", 0, 9), 9);
  // Fresh live rows report null until seeded: skip null, take the def.
  assert.equal(
    T.readProp(
      { get: () => ({ get: throwing, value: null, definition: { value: 100 } }) },
      "k",
      0,
      50
    ),
    100,
    "null value falls through to the definition"
  );
  assert.equal(T.readProp({ get: () => ({ get: () => null }) }, "k", 0, 9), 9, "null get falls through");
});

test("property schema carries the container plus eleven effectors", () => {
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    object3d: { eulerOrders: "XYZ;XZY;YXZ;YZX;ZXY;ZYX" },
  };
  // The container owns tracking only: rotation order plus the stock
  // Custom properties row (whose + dialog is scoped to effectors).
  const container = T.createContainerPropertyDefinitions(PZ);
  assert.deepEqual(Object.keys(container), ["rotationOrder"]);
  assert.equal(container.rotationOrder.value, "XYZ", "container owns the rotation order");
  const builders = {
    shake: T.createShakePropertyDefinitions,
    plain: T.createPlainPropertyDefinitions,
    random: T.createRandomPropertyDefinitions,
    formula: T.createFormulaPropertyDefinitions,
    spline: T.createSplinePropertyDefinitions,
    orbit: T.createOrbitPropertyDefinitions,
    repeater: T.createRepeaterPropertyDefinitions,
    twist: T.createTwistPropertyDefinitions,
    wrap: T.createWrapPropertyDefinitions,
    voronoi: T.createVoronoiPropertyDefinitions,
    delay: T.createDelayPropertyDefinitions,
  };
  for (const section of Object.keys(builders)) {
    const defs = builders[section](PZ);
    assert.equal(defs[`${section}Enable`].items, "off;on", `${section} enable`);
    assert.equal(defs[`${section}Letters`].type, 3, `${section} letters text`);
    assert.equal(defs[`${section}Strength`].value, 100, `${section} strength default`);
    // Random, Formula and Spline strengths enter freely (the manual
    // allows below 0% and above 100%); every other effector caps at 100%.
    if (section !== "random" && section !== "formula" && section !== "spline") {
      assert.equal(defs[`${section}Strength`].max, 100);
    }
    assert.equal(defs[`${section}Field`].items, "Infinite;Linear;Box;Sphere", `${section} field`);
  }
  assert.equal(T.EXPRESS_TEXT_TYPE, "zoidium:expresstext-plus/expresstext");
  assert.equal(T.EXPRESS_SHAKE_TYPE, "zoidium:expresstext-plus/shake");
  assert.equal(T.EXPRESS_PLAIN_TYPE, "zoidium:expresstext-plus/plain");
  assert.equal(T.EXPRESS_RANDOM_TYPE, "zoidium:expresstext-plus/random");
  assert.equal(T.EXPRESS_FORMULA_TYPE, "zoidium:expresstext-plus/formula");
  assert.equal(T.EXPRESS_DELAY_TYPE, "zoidium:expresstext-plus/delay");
  for (const section of ["shake", "plain"]) {
    const defs = builders[section](PZ);
    assert.equal(defs[`${section}Position`].type, 5, `${section} XYZ position`);
    assert.equal(defs[`${section}Rotation`].type, 5, `${section} XYZ rotation`);
    assert.equal(defs[`${section}Scale`].type, 5, `${section} XYZ scale`);
  }
  const delayDefs = builders.delay(PZ);
  assert.equal(delayDefs.delayMode.items, "Even;Blend;Spring", "delay modes");
  assert.ok(!("delayAmount" in delayDefs), "no duration row: strength paces the trail");
  assert.ok(!("delayOrder" in delayDefs), "no order row: the trail runs in letter order");
  assert.ok(!("delaySeed" in delayDefs), "no seed row without randomness");
  for (const toggle of ["delayPosition", "delayScale", "delayRotation"]) {
    assert.equal(delayDefs[toggle].items, "off;on", `${toggle} toggle`);
    assert.equal(delayDefs[toggle].value, 1, `${toggle} delayed by default`);
  }
  for (const def of Object.values(delayDefs)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("delay") === 0, "delay rows stamped");
  }
  const plainDefs = builders.plain(PZ);
  assert.equal(plainDefs.plainInvertOdd.items, "off;on", "invert odd toggle");
  assert.equal(plainDefs.plainInvertOdd.value, 0, "invert odd defaults off");
  const rnd = builders.random(PZ);
  assert.equal(rnd.randomPositionMin.type, 5, "random XYZ min position");
  assert.equal(rnd.randomPositionMax.type, 5, "random XYZ max position");
  assert.equal(rnd.randomRotationMin.type, 5, "random XYZ min rotation");
  assert.equal(rnd.randomRotationMax.type, 5, "random XYZ max rotation");
  assert.equal(rnd.randomScaleMin.type, 5, "random XYZ min scale");
  assert.equal(rnd.randomScaleMax.type, 5, "random XYZ max scale");
  assert.equal(rnd.randomMode.items, "Random;Gaussian;Noise;Turbulence;Sorted", "random modes");
  assert.equal(rnd.randomMode.value, 0, "uniform random by default");
  assert.equal(rnd.randomMinimum.value, 0, "range starts at 0%");
  assert.equal(rnd.randomMaximum.value, 100, "range ends at 100%");
  assert.ok(rnd.randomMinimum.max === undefined && rnd.randomStrength.max === undefined, "range and strength enter freely");
  assert.equal(rnd.randomSynchronized.items, "off;on", "synchronized toggle");
  assert.equal(rnd.randomSynchronized.value, 0, "split groups by default");
  assert.equal(rnd.randomIndexed.items, "off;on", "indexed toggle");
  assert.equal(rnd.randomIndexed.value, 1, "split noise axes by default");
  assert.equal(rnd.randomSpace.items, "Global;UV", "noise space");
  assert.equal(rnd.randomAnimationSpeed.value, 0, "still noise by default");
  assert.equal(rnd.randomNoiseScale.value, 100, "full noise scale by default");
  const fml = builders.formula(PZ);
  assert.equal(fml.formulaExpression.type, 3, "formula expression text");
  assert.equal(fml.formulaExpression.value, "sin(u*360*f+t*90)", "live wave by default");
  assert.equal(fml.formulaTime.value, 1, "time flows by default");
  assert.equal(fml.formulaFrequency.value, 1, "unit frequency by default");
  assert.equal(fml.formulaMinimum.value, 0, "range starts at 0%");
  assert.equal(fml.formulaMaximum.value, 100, "range ends at 100%");
  assert.ok(fml.formulaMinimum.max === undefined && fml.formulaStrength.max === undefined, "range and strength enter freely");
  assert.equal(fml.formulaPosition.type, 5, "formula XYZ position");
  assert.equal(fml.formulaRotation.type, 5, "formula XYZ rotation");
  assert.equal(fml.formulaScale.type, 5, "formula XYZ scale");
  for (const def of Object.values(fml)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("formula") === 0, "formula rows stamped");
  }
  const spl = builders.spline(PZ);
  assert.equal(spl.splineMode.items, "Step;Falloff;Relative", "spline modes");
  assert.equal(spl.splinePath.items, "Line;Circle;Helix", "built-in paths");
  assert.equal(spl.splinePlane.items, "XY;XZ;YZ", "ring planes");
  assert.equal(spl.splineTilt.type, 5, "tilt vector");
  assert.equal(spl.splineTransform.items, "Absolute;Relative", "transform modes");
  assert.equal(spl.splineLength.value, 100, "default line length");
  assert.equal(spl.splineRadius.value, 50, "default radius");
  assert.equal(spl.splineRadiusEnd.value, 50, "cylinder by default");
  assert.equal(spl.splineHeight.value, 100, "default helix height");
  assert.equal(spl.splineTurns.value, 1, "single turn by default");
  assert.equal(spl.splineOffset.value, 0, "no wander by default");
  assert.equal(spl.splineStart.value, 0, "path starts at 0%");
  assert.equal(spl.splineEnd.value, 100, "path ends at 100%");
  assert.equal(spl.splineClamp.value, 1, "clamped ends by default");
  assert.equal(spl.splinePosition.value, 1, "position varies by default");
  assert.equal(spl.splineRotation.value, 1, "rotation varies by default");
  assert.ok(spl.splineStrength.max === undefined, "strength enters freely");
  assert.ok(!("splineSeed" in spl), "no seed row: single paths have no segments");
  for (const def of Object.values(spl)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("spline") === 0, "spline rows stamped");
  }
  const orb = builders.orbit(PZ);
  assert.deepEqual(orb.orbitAngle.value, [0, 0, 0], "rest angle by default");
  assert.equal(orb.orbitRadius.value, 100, "full radius by default");
  assert.ok(orb.orbitAngle.max === undefined, "angle enters freely");
  assert.ok(!("orbitSeed" in orb), "no seed row");
  assert.ok(!("orbitPosition" in orb), "no XYZ rows: the orbit is the transform");
  for (const def of Object.values(orb)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("orbit") === 0, "orbit rows stamped");
  }
  const rep = builders.repeater(PZ);
  assert.equal(rep.repeaterMode.items, "Linear;Random;Echo", "repeater modes");
  assert.equal(rep.repeaterMode.value, 0, "linear by default");
  assert.equal(rep.repeaterCopies.value, 3, "three ghosts by default");
  assert.equal(rep.repeaterCopies.min, 0, "copies switch off");
  assert.equal(rep.repeaterCopies.max, 64, "copies stay bounded");
  assert.deepEqual(rep.repeaterOffset.value, [10, 0, 0], "default step");
  assert.equal(rep.repeaterLag.value, 2, "two-frame echo lag by default");
  assert.equal(rep.repeaterFade.value, 50, "half fade by default");
  for (const def of Object.values(rep)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("repeater") === 0, "repeater rows stamped");
  }
  const tws = builders.twist(PZ);
  assert.equal(tws.twistAxis.items, "X;Y;Z", "twist axes");
  assert.equal(tws.twistAxis.value, 2, "twirls in screen plane by default");
  assert.equal(tws.twistAngle.value, 0, "rest angle by default");
  for (const def of Object.values(tws)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("twist") === 0, "twist rows stamped");
  }
  const wrp = builders.wrap(PZ);
  assert.equal(wrp.wrapDirection.items, "X;Y;Z", "wave directions");
  assert.equal(wrp.wrapDirection.value, 1, "flag wave by default");
  assert.equal(wrp.wrapFrequency.value, 1, "single cycle by default");
  for (const def of Object.values(wrp)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("wrap") === 0, "wrap rows stamped");
  }
  const vor = builders.voronoi(PZ);
  assert.equal(vor.voronoiChunks.value, 8, "eight chunks by default");
  assert.equal(vor.voronoiChunks.min, 1, "at least one chunk");
  assert.equal(vor.voronoiChunks.max, 64, "chunks stay bounded");
  assert.equal(vor.voronoiExplode.value, 0, "assembled by default");
  for (const def of Object.values(vor)) {
    assert.ok(def.effectorKey && def.effectorKey.indexOf("voronoi") === 0, "voronoi rows stamped");
  }
});

test("layered stack composes ancestor effectors in order", () => {
  const list = { order: [0, 1, 2], total: 3 };
  const base = [0, 0, 0];
  const containerProps = props({ rotationOrder: "XYZ" });
  const shakeOnly = T.evaluateStack(
    [
      {
        kind: "shake",
        props: props({
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
        }),
      },
    ],
    containerProps,
    0,
    0,
    list,
    base
  );
  assert.ok(Math.abs(shakeOnly.position[0] - 4) < 1e-9, "shake layer applies");
  const both = T.evaluateStack(
    [
      {
        kind: "plain",
        props: props({
          plainEnable: 1,
          plainLetters: "",
          plainStrength: 100,
          plainPosition: [10, 0, 0],
          plainRotation: [0, 0, 0],
          plainScale: [1, 1, 1],
          plainDelay: 0,
          plainDelayOrder: 0,
          plainField: 0,
        }),
      },
      {
        kind: "shake",
        props: props({
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
        }),
      },
      { kind: "future-effector", props: props({}) },
    ],
    containerProps,
    0,
    0,
    list,
    base
  );
  assert.ok(Math.abs(both.position[0] - 14) < 1e-9, "layers add, unknown kinds ignored");
  assert.equal(both.eulerOrder, "XYZ", "order comes from the container");
  const empty = T.evaluateStack([], containerProps, 0, 0, list, base);
  assert.deepEqual(empty.position, [0, 0, 0], "no layers is identity");
});

test("layer collection finds the container plus effectors, outermost first", () => {
  const container = { zoidiumExpressTextObject: true, parentObject: null };
  const shake = { zoidiumExpressEffector: "shake", parentObject: container };
  const textObject = { parentObject: shake };
  container.parentObject = null;
  const layers = T.collectExpressObjects(textObject);
  assert.deepEqual(layers, [container, shake], "outermost first");
  assert.equal(T.expressContainerOf(layers), container);
  assert.deepEqual(
    T.expressStackOf(layers).map((l) => l.kind),
    ["shake"]
  );
  const plus = { zoidiumTextPlusObject: true, parentObject: null };
  const owned = { parentObject: plus };
  assert.deepEqual(T.collectExpressObjects(owned), [], "defers to Text+");
});

test("activate registers only the container; effectors come from the factory map", () => {  const registered = [];
  class FakeDynamic {}
  class FakeList {
    constructor(owner, itemClass) {
      this.owner = owner;
      this.itemClass = itemClass;
      this.length = 0;
    }
  }
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
      this.customProperties = { __custom: true, name: "Custom properties" };
      this.children.push(this.customProperties);
    }
  }
  class FakePropertyList {
    constructor(definitions, owner) {
      this.definitions = definitions;
      this.owner = owner;
    }
    load() {}
  }
  const PZ = {
    property: {
      type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 },
      dynamic: FakeDynamic,
    },
    propertyList: FakePropertyList,
    objectList: FakeList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
    ui: { objectTypes: new Map() },
  };
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const context = {
    PZ,
    editor: null,
    window: { THREE: { TextGeometry: function () {} } },
    object3d: {
      registerClass(def) {
        registered.push(def);
        return () => {};
      },
    },
  };
  mod.activate(context);
  try {
    // Only the container is globally registered: effectors live inside the
    // one single group, built from the factory map, never picker-listed.
    const types = registered.map((r) => r.type);
    assert.deepEqual(types, ["zoidium:expresstext-plus/expresstext"]);
    for (const def of registered) {
      assert.equal(typeof def.factory, "function");
      const inst = def.factory();
      assert.equal(inst.type, def.type, `${def.type} stamps its type`);
    }
    for (const kind of ["shake", "plain", "random", "formula", "delay", "spline", "orbit", "repeater", "twist", "wrap", "voronoi"]) {
      const inst = T.newEffectorInstance(T.EFFECTOR_TYPES[kind]);
      assert.ok(inst, `${kind} factory builds`);
      assert.equal(inst.zoidiumExpressEffector, kind, "effector flag");
      assert.equal(inst.objects.name, "Modifiers");
    }
    assert.equal(T.newEffectorInstance("zoidium:expresstext-plus/nope"), null);
    const box = registered.find((r) => r.type === T.EXPRESS_TEXT_TYPE);
    const boxInst = box.factory();
    assert.ok(
      boxInst.customProperties instanceof FakeList,
      "container customs scoped to effectors"
    );
    assert.equal(boxInst.customProperties.name, "Custom properties");
    assert.ok(!boxInst.children.some((c) => c && c.__custom), "generic list replaced");
    // The stock + dialog on those containers offers only effectors.
    const scopedKey = [...PZ.ui.objectTypes.keys()].find((k) => typeof k === "function");
    assert.ok(scopedKey, "scoped registry key installed");
    const scoped = PZ.ui.objectTypes.get(scopedKey);
    assert.deepEqual(
      scoped.map((e) => e.name),
      ["Shake", "Plain", "Random", "Formula", "Delay", "Spline", "Orbit", "Repeater", "Twist", "Wrap", "Voronoi"],
      "effectors only, never the stock five"
    );
    assert.ok(
      scoped.every((e) => e.type && e.type.group && e.type.dynamic && e.type.custom),
      "entries carry group defs"
    );
  } finally {
    mod.deactivate();
  }
});

test("container load revives effector children locally, drops nothing", () => {
  class FakeGroup {
    constructor() {
      this.objects = { name: "", pushed: [], push(c) { this.pushed.push(c); } };
      this.children = [];
    }
    load(data) { this.loadedData = data; }
  }
  class FakePropertyList {
    constructor(definitions) { this.definitions = definitions; }
    load() {}
  }
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, eulerOrders: "XYZ" },
  };
  const defs = T.getExpressDefinitions();
  const containerDef = defs.find((d) => d.type === T.EXPRESS_TEXT_TYPE);
  const Cls = T.createExpressObjectClass(PZ, containerDef);
  // Factory map needs activation: register the container globally first.
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const fullPZ = {
    ...PZ,
    object3d: { ...PZ.object3d, text: TextObject },
  };
  mod.activate({
    PZ: fullPZ,
    editor: null,
    window: { THREE: { TextGeometry: function () {} } },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const inst = new Cls();
    inst.load({
      type: T.EXPRESS_TEXT_TYPE,
      properties: { name: "Box" },
      objects: [
        {
          type: T.EFFECTOR_TYPES.shake,
          properties: { name: "Old Shake" },
          objects: [],
          expressProperties: {},
        },
        { type: 5, properties: { name: "Text" } },
      ],
      expressProperties: {},
    });
    assert.equal(inst.objects.pushed.length, 1, "one effector revived");
    assert.equal(inst.objects.pushed[0].zoidiumExpressEffector, "shake");
    assert.equal(
      inst.objects.pushed[0].loadedData.properties.name,
      "Old Shake",
      "effector name preserved"
    );
    assert.deepEqual(
      inst.loadedData.objects.map((o) => o.type),
      [5],
      "only the plain child takes the generic path"
    );
  } finally {
    mod.deactivate();
  }
});

function fakePZ() {
  return {
    property: {
      type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 },
      dynamic: class FakeDynamic {},
    },
    object3d: { eulerOrders: "XYZ;XZY;YXZ;YZX;ZXY;ZYX" },
    ui: { objectTypes: new Map() },
  };
}

// Fake custom-prop row + section group mirroring the live shape:
// identity via definition (name for groups, effectorKey for rows).
function fakeRow(key, value) {
  return { definition: { name: `${key}-label`, effectorKey: key }, get: () => value };
}

function fakeSection(displayName, rows) {
  return {
    definition: { name: displayName },
    objects: Object.entries(rows).map(([k, v]) => fakeRow(k, v)),
  };
}

test("every section row is dynamic (host group rule)", () => {
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    object3d: { eulerOrders: "XYZ" },
  };
  const check = (def, trail) => {
    assert.equal(def.dynamic, true, `${trail} is dynamic`);
    for (const child of def.objects || []) check(child, `${trail}.${child.name}`);
  };
  for (const build of [
    T.createShakePropertyDefinitions,
    T.createPlainPropertyDefinitions,
    T.createRandomPropertyDefinitions,
    T.createFormulaPropertyDefinitions,
    T.createSplinePropertyDefinitions,
    T.createOrbitPropertyDefinitions,
    T.createRepeaterPropertyDefinitions,
    T.createDelayPropertyDefinitions,
  ]) {
    for (const def of Object.values(build(PZ))) check(def, def.name);
  }
});

test("effector entries register scoped to the subclass key", () => {
  const PZ = fakePZ();
  const defs = T.effectorEntryDefs(PZ);
  assert.deepEqual(defs.map((d) => d.name), ["Shake", "Plain", "Random", "Formula", "Delay", "Spline", "Orbit", "Repeater", "Twist", "Wrap", "Voronoi"]);
  for (const entry of defs) {
    assert.ok(entry.desc, `${entry.name} filterable description`);
    assert.equal(entry.type.custom, true);
    assert.equal(entry.type.group, true);
    assert.equal(entry.type.dynamic, true);
    assert.equal(entry.type.name, entry.name, "name lives inside the type (save-safe)");
    // VECTOR3 routes group rows through the stock vector editor, never
    // through generateInput (which reads keyframes fresh groups lack).
    assert.equal(entry.type.type, 5, "vector path for group rows");
    assert.ok(entry.type.objects.length >= 9, `${entry.name} carries its rows`);
  }
  const shake = defs[0].type.objects;
  assert.ok(shake.some((d) => d.effectorKey === "shakeEnable"), "stamped keys survive");
  assert.ok(shake.some((d) => d.effectorKey === "shakePosition"), "XYZ stamped");
  assert.ok(T.registerEffectorEntries(PZ), "registered");
  const scoped = PZ.ui.objectTypes.get(
    [...PZ.ui.objectTypes.keys()].find((k) => typeof k === "function")
  );
  assert.equal(scoped.length, 11, "eleven effectors, never the stock five");
  assert.ok(!scoped.some((e) => e.name === "Number"), "no generic types leak in");
  assert.ok(scoped.some((e) => e.name === "Formula"), "formula offered in the dialog");
});

test("sections are found by display name, rows by stamped key", () => {  const container = {
    customProperties: [
      fakeSection("Plain", { plainEnable: 1, plainPosition: [10, 0, 0] }),
      fakeSection("Shake", { shakeEnable: 0 }),
    ],
  };
  container.customProperties.length = 2;
  assert.equal(T.sectionGroupOf(container, "Plain").definition.name, "Plain");
  assert.equal(T.sectionGroupOf(container, "Delay"), null, "absent section");
  assert.equal(T.sectionGroupOf(null, "Plain"), null);
  assert.equal(T.sectionGroupOf({}, "Plain"), null, "no customs list");
  const reader = T.groupReader(T.sectionGroupOf(container, "Plain"));
  assert.equal(reader.get("plainEnable").get(), 1);
  assert.deepEqual(reader.get("plainPosition").get(), [10, 0, 0]);
  assert.equal(reader.get("plainNope"), undefined, "missing row");
  assert.equal(T.groupReader(null).get("x"), undefined);
});

test("copies are found by stamped keys and stack with own values", () => {
  assert.equal(T.kindOfKey("shakeEnable"), "shake");
  assert.equal(T.kindOfKey("shakeFieldPosition"), "shake");
  assert.equal(T.kindOfKey("plainLetters"), "plain");
  assert.equal(T.kindOfKey("formulaExpression"), "formula");
  assert.equal(T.kindOfKey("formulaFieldScale"), "formula");
  assert.equal(T.kindOfKey("splineEnable"), "spline");
  assert.equal(T.kindOfKey("splineRadiusEnd"), "spline");
  assert.equal(T.kindOfKey("splineFieldPosition"), "spline");
  assert.equal(T.kindOfKey("orbitEnable"), "orbit");
  assert.equal(T.kindOfKey("orbitAngle"), "orbit");
  assert.equal(T.kindOfKey("orbitFieldScale"), "orbit");
  assert.equal(T.kindOfKey("repeaterEnable"), "repeater");
  assert.equal(T.kindOfKey("repeaterCopies"), "repeater");
  assert.equal(T.kindOfKey("repeaterFieldPosition"), "repeater");
  assert.equal(T.kindOfKey("twistAngle"), "twist");
  assert.equal(T.kindOfKey("twistAxis"), "twist");
  assert.equal(T.kindOfKey("wrapAmplitude"), "wrap");
  assert.equal(T.kindOfKey("wrapDirection"), "wrap");
  assert.equal(T.kindOfKey("voronoiChunks"), "voronoi");
  assert.equal(T.kindOfKey("voronoiSpin"), "voronoi");
  assert.equal(T.kindOfKey("nope"), null);
  assert.equal(T.kindOfKey(""), null);
  assert.equal(T.kindOfKey(null), null);
  const renamed = fakeSection("Shake 2", { shakeEnable: 1 });
  assert.equal(T.kindOfGroup(renamed), "shake", "renamed copy still resolves");
  assert.equal(T.kindOfGroup(fakeSection("Noise", {})), null, "unstamped ignored");
  assert.equal(T.kindOfGroup(null), null);
  // Two copies of Plain each contribute: +10 then +20.
  const mk = (pos) =>
    fakeSection("Plain", {
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: pos,
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    });
  const container = { customProperties: [mk([10, 0, 0]), mk([20, 0, 0])] };
  container.customProperties.length = 2;
  const stack = T.stackLayersFor(container, []);
  assert.deepEqual(stack.map((l) => l.kind), ["plain", "plain"], "both copies stack");
  const list = { order: [0], total: 1 };
  const out = T.evaluateStack(stack, T.staticProps({ rotationOrder: "XYZ" }), 0, 0, list, [0, 0, 0]);
  assert.deepEqual(out.position, [30, 0, 0], "copies add up");
});

test("stack reads customs sections first, legacy objects after", () => {
  const container = {
    customProperties: [
      fakeSection("Plain", {
        plainEnable: 1,
        plainLetters: "",
        plainStrength: 100,
        plainPosition: [10, 0, 0],
        plainRotation: [0, 0, 0],
        plainScale: [1, 1, 1],
        plainDelay: 0,
        plainDelayOrder: 0,
        plainField: 0,
      }),
    ],
  };
  container.customProperties.length = 1;
  const legacy = {
    zoidiumExpressEffector: "shake",
    expressProperties: T.staticProps({ shakeEnable: 1 }),
  };
  const stack = T.stackLayersFor(container, [legacy]);
  assert.deepEqual(stack.map((l) => l.kind), ["plain", "shake"], "sections first");
  assert.equal(typeof stack[0].props.get, "function", "section props are readers");
  assert.deepEqual(T.stackLayersFor(null, [legacy]).map((l) => l.kind), ["shake"]);
  assert.deepEqual(T.stackLayersFor(container, []).map((l) => l.kind), ["plain"]);
  // End to end through the customs section: letter 2 moves +10.
  const list = { order: [0, 1, 2, 3, 4], total: 5 };
  const out = T.evaluateStack(stack, T.staticProps({ rotationOrder: "XYZ" }), 0, 1, list, [0, 0, 0]);
  assert.deepEqual(out.position, [10, 0, 0]);
});

test("reattach restores identities stripped by stock revive", () => {  const live = {
    length: 1,
    0: {
      definition: {},
      objects: [{ definition: {}, get: () => 50 }],
    },
  };
  const raw = [
    {
      type: {
        name: "Shake",
        objects: [{ name: "Shake strength", effectorKey: "shakeStrength" }],
      },
      objects: [{ animated: false, keyframes: [{ value: 50, frame: 0 }] }],
    },
  ];
  T.reattachCustomDefinitions(live, raw);
  assert.equal(live[0].definition.name, "Shake");
  assert.equal(live[0].objects[0].definition.effectorKey, "shakeStrength");
  const healthy = { length: 1, 0: { definition: { name: "Plain" }, objects: [] } };
  T.reattachCustomDefinitions(healthy, raw);
  assert.equal(healthy[0].definition.name, "Plain", "healthy trees untouched");
  assert.doesNotThrow(() => T.reattachCustomDefinitions(null, null));
  assert.doesNotThrow(() => T.reattachCustomDefinitions({}, []));
  // Saved lists serialize as objects with numeric keys, not arrays.
  const rawLike = {
    0: {
      type: { name: "Plain", objects: [{ name: "x", effectorKey: "plainEnable" }] },
      objects: [{}],
    },
    length: 1,
  };
  const liveLike = { length: 1, 0: { definition: {}, objects: [{ definition: {} }] } };
  T.reattachCustomDefinitions(liveLike, rawLike);
  assert.equal(liveLike[0].definition.name, "Plain", "array-like raw works");
  assert.equal(liveLike[0].objects[0].definition.effectorKey, "plainEnable");
});

test("saved-list shapes normalize for iteration", () => {
  assert.deepEqual(T.rawArray([1, 2]), [1, 2], "arrays pass through");
  assert.deepEqual(T.rawArray({ 0: "a", 1: "b", length: 2 }), ["a", "b"], "array-likes convert");
  assert.deepEqual(T.rawArray(null), []);
  assert.deepEqual(T.rawArray(undefined), []);
  assert.deepEqual(T.rawArray({}), []);
  assert.deepEqual(T.rawArray("nope"), []);
});

test("constructor-installed load wraps the stock own load", () => {
  const seen = [];
  class FakeGroup {
    constructor() {
      this.objects = { name: "", pushed: [], push(c) { this.pushed.push(c); } };
      this.children = [];
      this.customProperties = { length: 0 };
      this.load = (data) => { seen.push(data); };
    }
  }
  class FakePropertyList {
    constructor(definitions) { this.definitions = definitions; }
    load() {}
  }
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, eulerOrders: "XYZ" },
  };
  const defs = T.getExpressDefinitions();
  const Cls = T.createExpressObjectClass(PZ, defs[0]);
  const inst = new Cls();
  assert.equal(typeof inst.load, "function");
  assert.notEqual(inst.load, FakeGroup.prototype.load, "instance shadows the stock load");
  // Stock-shaped live list, definitions stripped, raw carrying full defs.
  inst.customProperties = { length: 1, 0: { definition: {}, objects: [{ definition: {} }] } };
  const rawLike = {
    0: { type: { name: "Shake", objects: [{ effectorKey: "s" }] }, objects: [{}] },
    length: 1,
  };
  inst.load({ objects: [], expressProperties: {}, customProperties: rawLike });
  assert.equal(seen.length, 1, "stock load still runs");
  assert.equal(inst.customProperties[0].definition.name, "Shake", "reattach ran in the wrapper");
});

test("children effectors join the stack in list order", () => {  const shakeProps = T.staticProps({ shakeEnable: 1 });
  const child = { zoidiumExpressEffector: "shake", expressProperties: shakeProps };
  const container = {
    zoidiumExpressTextObject: true,
    parentObject: null,
    objects: [child],
  };
  const layers = [container];
  assert.equal(T.expressContainerOf(layers), container);
  const stack = T.expressStackOf(layers);
  assert.equal(stack.length, 1);
  assert.equal(stack[0].kind, "shake");
  assert.equal(stack[0].props, shakeProps);
});

test("container customs list carries the scoped item class", () => {
  class FakeDynamic {}
  class FakeList {
    constructor(owner, itemClass) {
      this.owner = owner;
      this.itemClass = itemClass;
      this.length = 0;
    }
  }
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
      this.customProperties = { __custom: true, name: "Custom properties" };
      this.children.push(this.customProperties);
    }
  }
  class FakePropertyList {
    constructor(definitions) { this.definitions = definitions; }
    load() {}
  }
  const PZ = {
    property: {
      type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 },
      dynamic: FakeDynamic,
    },
    objectList: FakeList,
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, eulerOrders: "XYZ" },
    ui: { objectTypes: new Map() },
  };
  const defs = T.getExpressDefinitions();
  const containerDef = defs.find((d) => d.type === T.EXPRESS_TEXT_TYPE);
  const Cls = T.createExpressObjectClass(PZ, containerDef);
  // Deterministic cache: (re)register with this PZ first, like activate does.
  T.unregisterEffectorEntries();
  assert.equal(T.registerEffectorEntries(PZ), true);
  const inst = new Cls();
  assert.ok(inst.customProperties instanceof FakeList, "list swapped, not detached");
  assert.equal(inst.customProperties.name, "Custom properties", "stock row label kept");
  assert.ok(
    inst.customProperties.itemClass !== FakeDynamic,
    "scoped subclass, not the generic dynamic class"
  );
  assert.ok(
    inst.customProperties.itemClass.prototype instanceof FakeDynamic,
    "subclass extends the dynamic prop"
  );
  assert.ok(!inst.children.some((c) => c && c.__custom), "generic list replaced");
});

test("center offsets follow the native anchor modes", () => {
  const bounds = { min: [0, 0, 0], max: [20, 10, 2] };
  assert.deepEqual(T.getExpressCenterOffset(bounds, 0), [-10, -5, -1], "centered");
  assert.deepEqual(T.getExpressCenterOffset(bounds, 1)[0], 0, "mode 1 keeps X");
  assert.deepEqual(T.getExpressCenterOffset(bounds, 2)[0], -20, "mode 2 doubles X");
  assert.deepEqual(T.getExpressCenterOffset(bounds, 4)[1], 0, "mode 4 keeps Y");
  assert.deepEqual(T.getExpressCenterOffset(null, 0), [0, 0, 0], "no bounds");
  assert.deepEqual(T.getExpressTextCenter(bounds, [-10, -5, -1]), [0, 0, 0]);
});

function fakeThree(boxes, captured) {
  const pos = () => ({
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; },
  });
  function Obj() {
    this.position = pos();
    this.kids = [];
  }
  Obj.prototype.add = function (c) { this.kids.push(c); };
  function Mesh(geo, mat) {
    this.geometry = geo;
    this.material = mat;
    this.position = pos();
  }
  function Extrude(shapes, options) {
    captured.push({ shapes, options });
    const box = boxes.shift() || { min: [0, 0, 0], max: [10, 10, 2] };
    this.boundingBox = {
      min: { x: box.min[0], y: box.min[1], z: box.min[2] },
      max: { x: box.max[0], y: box.max[1], z: box.max[2] },
    };
    this.dispose = () => {};
  }
  Extrude.prototype.computeBoundingBox = function () {};
  function Buffer() {}
  function TextGeometry() {}
  function ShapePath() {}
  ShapePath.prototype.moveTo = function () {};
  ShapePath.prototype.lineTo = function () {};
  ShapePath.prototype.quadraticCurveTo = function () {};
  ShapePath.prototype.bezierCurveTo = function () {};
  ShapePath.prototype.toShapes = function () { return [{}]; };
  return { Object3D: Obj, Mesh, ExtrudeGeometry: Extrude, BufferGeometry: Buffer, TextGeometry, ShapePath };
}

test("letters build centered with the source extrusion", () => {
  const captured = [];
  const boxes = [
    { min: [0, 0, 0], max: [10, 10, 2] },
    { min: [0, 0, 0], max: [10, 10, 2] },
  ];
  const THREE = fakeThree(boxes, captured);
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
      B: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
    },
  };
  const added = [];
  const sourceMesh = {
    material: "mat",
    geometry: { parameters: { options: { depth: 5, bevelEnabled: true, curveSegments: 4 } } },
    parent: { add: (r) => added.push(r) },
  };
  const textObject = {
    threeObj: sourceMesh,
    font: { font3d: { data: fontData, generateShapes: (ch) => [{ shape: ch }] } },
    properties: {
      text: { get: () => "AB" },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      positionMode: { get: () => 0 },
    },
  };
  // Activate with the fake THREE so the module state sees it.
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
    }
  }
  class FakePropertyList {
    constructor(definitions) { this.definitions = definitions; }
    load() {}
  }
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
  };
  mod.activate({
    PZ,
    editor: null,
    window: { THREE },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const splitState = T.getSplitState(textObject);
    assert.equal(T.buildExpressRendering(textObject, splitState), true);
    assert.equal(splitState.entries.length, 2);
    // Source extrusion reused, not the hardcoded fallback.
    assert.deepEqual(captured[0].options, { amount: 3, depth: 5, bevelEnabled: true, curveSegments: 4 });
    // Two 10-wide letters at x=0/10, centered on the origin.
    const xs = splitState.entries.map((e) => e.anchor.position.x).sort((a, b) => a - b);
    assert.deepEqual(xs, [-5, 5], "anchors carry the native centering");
    // Source mesh hidden by the empty-geometry swap, restorable.
    assert.ok(splitState.fullGeometry, "original geometry kept");
    assert.equal(sourceMesh.geometry, splitState.emptyGeometry, "source swapped out");
    T.restoreExpressRendering(textObject);
    assert.equal(added.length, 1, "render root parented once");
  } finally {
    mod.deactivate();
  }
});

test("rebuilds keep the source extrusion instead of falling back", () => {
  const captured = [];
  const boxes = [
    { min: [0, 0, 0], max: [10, 10, 2] },
    { min: [0, 0, 0], max: [10, 10, 2] },
    { min: [0, 0, 0], max: [10, 10, 2] },
    { min: [0, 0, 0], max: [10, 10, 2] },
  ];
  const THREE = fakeThree(boxes, captured);
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
      B: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
    },
  };
  const added = [];
  const sourceMesh = {
    material: "mat",
    geometry: { parameters: { options: { depth: 5, bevelEnabled: true, curveSegments: 4 } } },
    parent: { add: (r) => added.push(r) },
  };
  const textObject = {
    threeObj: sourceMesh,
    font: { font3d: { data: fontData, generateShapes: (ch) => [{ shape: ch }] } },
    properties: {
      text: { get: () => "AB" },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      positionMode: { get: () => 0 },
    },
  };
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
    }
  }
  class FakePropertyList {
    constructor(definitions) { this.definitions = definitions; }
    load() {}
  }
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
  };
  mod.activate({
    PZ,
    editor: null,
    window: { THREE },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const splitState = T.getSplitState(textObject);
    assert.equal(T.buildExpressRendering(textObject, splitState), true);
    assert.deepEqual(
      { amount: captured[0].options.amount, depth: captured[0].options.depth, bevel: captured[0].options.bevelEnabled, curve: captured[0].options.curveSegments },
      { amount: 3, depth: 5, bevel: true, curve: 4 },
      "first build inherits the source extrusion"
    );
    // The first build swaps the source mesh to the empty geometry (no
    // parameters). A rebuild must reuse the preserved original, never
    // the plain fallback (which would silently drop bevels).
    assert.equal(T.buildExpressRendering(textObject, splitState), true);
    assert.deepEqual(
      { amount: captured[2].options.amount, depth: captured[2].options.depth, bevel: captured[2].options.bevelEnabled, curve: captured[2].options.curveSegments },
      { amount: 3, depth: 5, bevel: true, curve: 4 },
      "rebuild keeps the source extrusion"
    );
  } finally {
    mod.deactivate();
  }
});

test("extrusion options follow stock and Text+ geometry shapes", () => {
  // Text+ builds ExtrudeGeometry: the full bevel/cap suite rides
  // parameters.options (r91 extrudes by `amount`), junk stays out.
  const textPlus = {
    threeObj: {
      geometry: {
        parameters: {
          options: {
            size: 20,
            height: 3,
            amount: 3,
            curveSegments: 5,
            bevelEnabled: true,
            bevelThickness: 0.1,
            bevelSize: 0.5,
            bevelSizeInner: 0.5,
            bevelShift: 0,
            bevelSegments: 3,
            bevelRound: true,
            bevelProfile: 0.5,
            font: { huge: true },
            material: 0,
            extrudeMaterial: 1,
          },
        },
      },
    },
  };
  const picked = T.sourceExtrudeOptions(textPlus, null);
  assert.equal(picked.amount, 3, "r91 depth key carried");
  assert.equal(picked.bevelEnabled, true, "bevel carried");
  assert.equal(picked.bevelSegments, 3, "bevel segments carried");
  assert.equal(picked.bevelProfile, 0.5, "cap tension carried");
  assert.equal(picked.curveSegments, 5, "detail carried");
  assert.ok(!("font" in picked), "font stays out");
  assert.ok(!("material" in picked), "material slot stays out");
  // Stock TextGeometry nests its construction options one level deeper
  // and extrudes by `height`: map it onto `amount`.
  const stock = {
    threeObj: {
      geometry: {
        parameters: {
          text: "AB",
          parameters: {
            size: 20,
            height: 4,
            curveSegments: 5,
            bevelEnabled: true,
            bevelThickness: 2,
            bevelSize: 3,
            bevelSegments: 4,
            steps: 1,
          },
        },
      },
    },
  };
  const fromStock = T.sourceExtrudeOptions(stock, null);
  assert.equal(fromStock.amount, 4, "height maps to amount");
  assert.equal(fromStock.bevelThickness, 2, "stock bevel options carried");
  assert.deepEqual(T.sourceExtrudeOptions(null, null), {}, "null-safe");
  assert.deepEqual(T.sourceExtrudeOptions({ threeObj: null }, null), {}, "meshless-safe");
});

test("bevel changes rebuild the letters with the fresh options", () => {
  const captured = [];
  const THREE = recordingThree();
  // Store construction options like the real r91 ExtrudeGeometry.
  const baseExtrude = THREE.ExtrudeGeometry;
  THREE.ExtrudeGeometry = function (shapes, options) {
    const g = baseExtrude(shapes, options);
    captured.push({ shapes, options });
    g.parameters = { options };
    return g;
  };
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
      B: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
    },
  };
  const added = [];
  const flatGeometry = {
    parameters: { options: { amount: 4, bevelEnabled: false, curveSegments: 3 } },
  };
  const sourceMesh = {
    material: "mat",
    geometry: flatGeometry,
    parent: { add: (r) => added.push(r) },
  };
  const container = {
    zoidiumExpressTextObject: true,
    expressProperties: T.staticProps({ rotationOrder: "XYZ" }),
    customProperties: [fakeSection("Plain", { plainEnable: 1 })],
  };
  const textObject = {
    threeObj: sourceMesh,
    font: { font3d: { data: fontData } },
    properties: {
      text: { get: () => "AB" },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      positionMode: { get: () => 0 },
    },
    parentObject: container,
  };
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
    }
  }
  class FakePropertyList {
    constructor(definitions) { this.definitions = definitions; }
    load() {}
  }
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
  };
  mod.activate({
    PZ,
    editor: null,
    window: { THREE },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const layers = T.collectExpressObjects(textObject);
    const splitState = T.getSplitState(textObject);
    T.updateExpressRendering(textObject, splitState, layers, 0);
    assert.equal(captured[captured.length - 1].options.bevelEnabled, false, "flat letters first");
    assert.equal(captured[captured.length - 1].options.amount, 4, "r91 amount carried");
    const before = splitState.entries;
    T.updateExpressRendering(textObject, splitState, layers, 1);
    assert.equal(splitState.entries, before, "same options, no rebuild");
    // The stock pipeline rebuilds the source geometry when the user flips
    // bevel on: our letters must follow on the next frame.
    sourceMesh.geometry = {
      parameters: {
        options: {
          amount: 4,
          bevelEnabled: true,
          bevelThickness: 5,
          bevelSize: 2,
          bevelSegments: 3,
          curveSegments: 3,
        },
      },
    };
    T.updateExpressRendering(textObject, splitState, layers, 2);
    assert.notEqual(splitState.entries, before, "bevel change rebuilds");
    assert.equal(captured[captured.length - 1].options.bevelEnabled, true, "bevel lands in the letters");
    assert.equal(captured[captured.length - 1].options.bevelThickness, 5, "bevel size lands too");
    const settled = splitState.entries;
    T.updateExpressRendering(textObject, splitState, layers, 3);
    assert.equal(splitState.entries, settled, "stable afterwards");
  } finally {
    mod.deactivate();
  }
});

test("stock geometry rebuilds invalidate the split without swapping stale geometry", () => {
  const THREE = recordingThree();
  const baseExtrude = THREE.ExtrudeGeometry;
  THREE.ExtrudeGeometry = function (shapes, options) {
    const g = baseExtrude(shapes, options);
    g.parameters = { options };
    return g;
  };
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
    },
  };
  const sourceMesh = {
    material: "mat",
    geometry: { parameters: { options: { amount: 4, bevelEnabled: false, curveSegments: 3 } } },
    parent: { add: () => {} },
  };
  const freshGeometry = {
    parameters: { options: { amount: 4, bevelEnabled: true, bevelThickness: 5, curveSegments: 3 } },
  };
  const container = {
    zoidiumExpressTextObject: true,
    expressProperties: T.staticProps({ rotationOrder: "XYZ" }),
    customProperties: [fakeSection("Plain", { plainEnable: 1 })],
  };
  const textObject = {
    threeObj: sourceMesh,
    font: { font3d: { data: fontData } },
    properties: {
      text: { get: () => "A" },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      positionMode: { get: () => 0 },
    },
    parentObject: container,
  };
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
    }
  }
  class FakePropertyList {
    constructor(definitions) { this.definitions = definitions; }
    load() {}
  }
  function TextObject() {}
  TextObject.prototype.update = function () {};
  TextObject.prototype.updateGeometry = function () {
    this.threeObj.geometry = freshGeometry;
  };
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
  };
  mod.activate({
    PZ,
    editor: null,
    window: { THREE },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const layers = T.collectExpressObjects(textObject);
    const splitState = T.getSplitState(textObject);
    T.updateExpressRendering(textObject, splitState, layers, 0);
    assert.ok(splitState.renderRoot, "letters built");
    TextObject.prototype.updateGeometry.call(textObject);
    assert.equal(sourceMesh.geometry, freshGeometry, "fresh geometry stands, never swapped back");
    assert.equal(splitState.renderRoot, null, "split invalidated for rebuild");
    T.updateExpressRendering(textObject, splitState, layers, 1);
    assert.ok(splitState.renderRoot, "letters rebuild from the fresh geometry");
    assert.equal(splitState.entries.length, 1, "letter count preserved");
  } finally {
    mod.deactivate();
  }
});

// Recording THREE stubs: capture exactly what the renderer writes onto
// letter anchors (rotation/position/scale), with identity matrix math.
function recordingThree() {
  const vec = (x, y, z) => ({
    x: x || 0,
    y: y || 0,
    z: z || 0,
    set(nx, ny, nz) {
      this.x = nx;
      this.y = ny;
      this.z = nz;
      return this;
    },
    copy(v) {
      this.x = v.x;
      this.y = v.y;
      this.z = v.z;
      return this;
    },
    add(v) {
      this.x += v.x;
      this.y += v.y;
      this.z += v.z;
      return this;
    },
    applyMatrix4() {
      return this;
    },
  });
  function Obj() {
    this.position = vec();
    this.rotation = {
      args: null,
      set(...a) {
        this.args = a;
      },
      copy(v) {
        this.args = v.args ? v.args.slice() : [v.x, v.y, v.z];
      },
    };
    this.scale = {
      args: null,
      set(...a) {
        this.args = a;
      },
      copy(v) {
        this.args = v.args ? v.args.slice() : [v.x, v.y, v.z];
      },
    };
    this.children = [];
    this.matrixAutoUpdate = false;
  }
  Obj.prototype.add = function (c) {
    this.children.push(c);
  };
  function Mesh(geo, mat) {
    Obj.call(this);
    this.geometry = geo;
    this.material = mat;
  }
  Mesh.prototype = Object.create(Obj.prototype);
  function Euler(x, y, z, order) {
    this.args = [x, y, z, order];
  }
  function Matrix4() {}
  Matrix4.prototype.makeRotationFromEuler = function () {
    return this;
  };
  function Extrude() {
    return {
      computeBoundingBox() {},
      boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 10, z: 2 } },
      dispose() {},
    };
  }
  function Buffer() {}
  function TextGeometry() {}
  function ShapePath() {}
  ShapePath.prototype.moveTo = function () {};
  ShapePath.prototype.lineTo = function () {};
  ShapePath.prototype.toShapes = function () {
    return [{}];
  };
  return {
    Object3D: Obj,
    Mesh,
    Euler,
    Matrix4,
    ExtrudeGeometry: Extrude,
    BufferGeometry: Buffer,
    TextGeometry,
    ShapePath,
    Vector3: function (x, y, z) {
      return vec(x, y, z);
    },
  };
}

test("render path wires rows through to mesh transforms", () => {
  const THREE = recordingThree();
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
      B: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
    },
  };
  const added = [];
  const sourceMesh = {
    material: "mat",
    geometry: { parameters: { options: { depth: 4 } } },
    parent: { add: (r) => added.push(r) },
  };
  const container = {
    zoidiumExpressTextObject: true,
    expressProperties: T.staticProps({ rotationOrder: "XYZ" }),
    customProperties: [
      fakeSection("Plain", {
        plainEnable: 1,
        plainLetters: "",
        plainStrength: 100,
        plainPosition: [10, 0, 0],
        plainRotation: [2, 0, 0],
        plainScale: [1, 1, 1],
        plainDelay: 0,
        plainDelayOrder: 0,
        plainField: 0,
      }),
      fakeSection("Delay", {
        delayEnable: 1,
        delayLetters: "",
        delayStrength: 100,
        delayMode: 0,
        delayField: 0,
      }),
    ],
  };
  const textObject = {
    threeObj: sourceMesh,
    font: { font3d: { data: fontData } },
    properties: {
      text: { get: () => "AB" },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      positionMode: { get: () => 0 },
    },
    parentObject: container,
  };
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
    }
  }
  class FakePropertyList {
    constructor(definitions) {
      this.definitions = definitions;
    }
    load() {}
  }
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
  };
  mod.activate({
    PZ,
    editor: null,
    window: { THREE },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const layers = T.collectExpressObjects(textObject);
    assert.deepEqual(
      layers.map((l) => !!l.zoidiumExpressTextObject),
      [true],
      "container discovered through the parent chain"
    );
    const splitState = T.getSplitState(textObject);
    const at = (frame, index) => {
      T.updateExpressRendering(textObject, splitState, layers, frame);
      return splitState.entries[index].anchor;
    };
    // Mid-flight: letter 0 holds the full pose, letter 1 waits.
    const first = at(5, 0);
    const firstBase = splitState.entries[0].base;
    assert.deepEqual(
      [
        first.position.x - firstBase[0],
        first.position.y - firstBase[1],
        first.position.z - firstBase[2],
      ],
      [10, 0, 0],
      "position reaches the mesh"
    );
    assert.deepEqual(first.rotation.args, [2, 0, 0, "XYZ"], "rotation reaches the mesh");
    assert.deepEqual(first.scale.args, [1, 1, 1], "scale reaches the mesh");
    const second = at(5, 1);
    const secondBase = splitState.entries[1].base;
    assert.deepEqual(
      [
        second.position.x - secondBase[0],
        second.position.y - secondBase[1],
        second.position.z - secondBase[2],
      ],
      [10, 0, 0],
      "static pose holds before its start too"
    );
    assert.deepEqual(second.rotation.args, [2, 0, 0, "XYZ"], "second letter fully posed");
    assert.equal(added.length, 1, "render root parented once");
    assert.equal(splitState.entries.length, 2, "two letter anchors");
    // Settled: full pose on the first letter.
    const done = at(10, 0);
    assert.deepEqual(
      [
        done.position.x - firstBase[0],
        done.position.y - firstBase[1],
        done.position.z - firstBase[2],
      ],
      [10, 0, 0],
      "settled position"
    );
    assert.deepEqual(done.rotation.args, [2, 0, 0, "XYZ"], "settled rotation");
  } finally {
    mod.deactivate();
  }
});

test("letter rotation spins inside its position offset", () => {
  // Minimal real math (X rotation only): distinguishes orbiting the
  // offset from turning in place, which identity-matrix stubs cannot.
  const THREE = {
    Euler: function (x, y, z, order) {
      this.x = x;
      this.order = order;
    },
    Matrix4: function () {
      this.euler = null;
    },
    Vector3: function (x, y, z) {
      return {
        x,
        y,
        z,
        applyMatrix4(m) {
          const a = m.euler.x;
          const y1 = this.y * Math.cos(a) - this.z * Math.sin(a);
          const z1 = this.y * Math.sin(a) + this.z * Math.cos(a);
          this.y = y1;
          this.z = z1;
          return this;
        },
        set(nx, ny, nz) {
          this.x = nx;
          this.y = ny;
          this.z = nz;
          return this;
        },
        copy(v) {
          this.x = v.x;
          this.y = v.y;
          this.z = v.z;
          return this;
        },
      };
    },
  };
  THREE.Matrix4.prototype.makeRotationFromEuler = function (e) {
    this.euler = e;
    return this;
  };
  const node = () => ({
    matrixAutoUpdate: false,
    position: {
      x: 0,
      y: 0,
      z: 0,
      copy(v) {
        this.x = v.x;
        this.y = v.y;
        this.z = v.z;
      },
    },
    rotation: {
      args: null,
      set(...a) {
        this.args = a;
      },
    },
    scale: {
      args: null,
      set(...a) {
        this.args = a;
      },
    },
  });
  const controls = { position: [0, 10, 0], rotation: [Math.PI / 2, 0, 0], scale: [1, 1, 1] };
  // Character pivot: in place — the Y offset stays Y, nothing swings to Z.
  const inner = node();
  T.applyLetterTransform(THREE, inner, [0, 0, 0], controls, [0, 0, 0], "XYZ");
  assert.ok(Math.abs(inner.position.y - 10) < 1e-9, "offset stays on its axis");
  assert.ok(Math.abs(inner.position.z) < 1e-9, "rotation does not swing the offset");
  assert.deepEqual(inner.rotation.args.slice(0, 3), [Math.PI / 2, 0, 0], "letter still turns");
  // Text pivot: orbits about the string center, as before.
  const outer = node();
  T.applyLetterTransform(THREE, outer, [0, 0, 0], controls, [0, 0, 100], "XYZ");
  assert.ok(Math.abs(outer.position.y - 100) < 1e-9, "text pivot swings height");
  assert.ok(Math.abs(outer.position.z - 110) < 1e-9, "text pivot swings depth");
});

test("repeater ghosts ride letter anchors through the render path", () => {
  const THREE = recordingThree();
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
      B: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
    },
  };
  const added = [];
  const sourceMesh = {
    material: { clone: () => ({ transparent: false, opacity: 1 }) },
    geometry: { parameters: { options: { depth: 4 } } },
    parent: { add: (r) => added.push(r) },
  };
  let liveCopies = 2;
  const repeaterRows = () => ({
    repeaterEnable: 1,
    repeaterLetters: "",
    repeaterStrength: 100,
    repeaterMode: 0,
    repeaterCopies: liveCopies,
    repeaterOffset: [5, 0, 0],
    repeaterRangeMin: [-10, -10, -10],
    repeaterRangeMax: [10, 10, 10],
    repeaterSeed: 1,
    repeaterLag: 2,
    repeaterFade: 50,
    repeaterDelay: 0,
    repeaterDelayOrder: 0,
    repeaterField: 0,
  });
  const repeaterSection = () => ({
    definition: { name: "Repeater" },
    objects: Object.entries(repeaterRows()).map(([k, v]) =>
      k === "repeaterCopies"
        ? { definition: { name: `${k}-label`, effectorKey: k }, get: () => liveCopies }
        : fakeRow(k, v)
    ),
  });
  const container = {
    zoidiumExpressTextObject: true,
    expressProperties: T.staticProps({ rotationOrder: "XYZ" }),
    customProperties: [
      fakeSection("Plain", {
        plainEnable: 1,
        plainLetters: "",
        plainStrength: 100,
        plainPosition: [10, 0, 0],
        plainRotation: [0, 0, 0],
        plainScale: [1, 1, 1],
        plainDelay: 0,
        plainDelayOrder: 0,
        plainField: 0,
      }),
      repeaterSection(),
    ],
  };
  const textObject = {
    threeObj: sourceMesh,
    font: { font3d: { data: fontData } },
    properties: {
      text: { get: () => "AB" },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      positionMode: { get: () => 0 },
    },
    parentObject: container,
  };
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
    }
  }
  class FakePropertyList {
    constructor(definitions) {
      this.definitions = definitions;
    }
    load() {}
  }
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
  };
  mod.activate({
    PZ,
    editor: null,
    window: { THREE },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const layers = T.collectExpressObjects(textObject);
    const splitState = T.getSplitState(textObject);
    const update = (frame) => T.updateExpressRendering(textObject, splitState, layers, frame);
    update(5);
    assert.equal(splitState.entries.length, 2, "two letter anchors");
    const first = splitState.entries[0];
    const firstBase = first.base;
    assert.equal(first.copies.length, 2, "two ghosts built");
    assert.deepEqual(
      [first.copies[0].slot, first.copies[1].slot],
      [1, 2],
      "slots count from one"
    );
    // Letter at base+10; ghosts trail at +15/+20 with fading materials.
    const ghost = (i) => first.copies[i].node.position;
    assert.deepEqual(
      [ghost(0).x - firstBase[0], ghost(0).y - firstBase[1], ghost(0).z - firstBase[2]],
      [15, 0, 0],
      "first ghost trails the anchor"
    );
    assert.deepEqual(
      [ghost(1).x - firstBase[0], ghost(1).y - firstBase[1], ghost(1).z - firstBase[2]],
      [20, 0, 0],
      "second ghost trails further"
    );
    assert.ok(first.copies[0].node.visible, "ghosts visible");
    assert.deepEqual(first.copies[0].node.rotation.args, first.anchor.rotation.args, "ghosts copy orientation");
    assert.equal(first.copies[0].mesh.material.opacity, 0.75, "first ghost fades a quarter");
    assert.equal(first.copies[1].mesh.material.opacity, 0.5, "second ghost halves");
    assert.ok(first.copies[0].ownMaterial, "fade owns its material");
    // Stable across frames without row changes: no rebuild churn.
    const before = splitState.entries;
    update(6);
    assert.equal(splitState.entries, before, "same entries without row changes");
    assert.equal(first.copies.length, 2, "same ghosts without row changes");
    // Changing the count rebuilds ghosts.
    liveCopies = 3;
    update(7);
    assert.equal(splitState.entries[0].copies.length, 3, "count change rebuilds");
  } finally {
    mod.deactivate();
  }
});

test("voronoi chunks shatter the letter through the render path", () => {
  const THREE = recordingThree();
  // Letters carry real triangle attributes for the splitter; chunk
  // geometries receive attributes through the version-tolerant helper.
  const baseExtrude = THREE.ExtrudeGeometry;
  const tri = (ox) => [
    ox, 0, 0, ox + 10, 0, 0, ox, 10, 0,
    ox, 0, 0, ox, 10, 0, ox + 10, 0, 0,
  ];
  THREE.ExtrudeGeometry = function (shapes, options) {
    const g = baseExtrude(shapes, options);
    const pos = new Float32Array([...tri(0), ...tri(10), ...tri(20), ...tri(30)]);
    g.attributes = {
      position: { array: pos },
      normal: { array: new Float32Array(pos.length) },
      uv: { array: new Float32Array((pos.length / 3) * 2) },
    };
    return g;
  };
  THREE.BufferAttribute = function (array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
  };
  THREE.BufferGeometry = function () {
    this.attributes = {};
    this.setAttribute = (name, attr) => {
      this.attributes[name] = attr;
    };
    this.dispose = () => {};
  };
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
    },
  };
  const added = [];
  const sourceMesh = {
    material: "mat",
    geometry: { parameters: { options: { depth: 4 } } },
    parent: { add: (r) => added.push(r) },
  };
  const container = {
    zoidiumExpressTextObject: true,
    expressProperties: T.staticProps({ rotationOrder: "XYZ" }),
    customProperties: [
      fakeSection("Voronoi", {
        voronoiEnable: 1,
        voronoiLetters: "",
        voronoiStrength: 100,
        voronoiChunks: 4,
        voronoiExplode: 10,
        voronoiSpin: [0, 0, 0],
        voronoiSeed: 1,
        voronoiDelay: 0,
        voronoiDelayOrder: 0,
        voronoiField: 0,
      }),
    ],
  };
  const textObject = {
    threeObj: sourceMesh,
    font: { font3d: { data: fontData } },
    properties: {
      text: { get: () => "A" },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      positionMode: { get: () => 0 },
    },
    parentObject: container,
  };
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
    }
  }
  class FakePropertyList {
    constructor(definitions) {
      this.definitions = definitions;
    }
    load() {}
  }
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
  };
  mod.activate({
    PZ,
    editor: null,
    window: { THREE },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const layers = T.collectExpressObjects(textObject);
    const splitState = T.getSplitState(textObject);
    const update = (frame) => T.updateExpressRendering(textObject, splitState, layers, frame);
    update(0);
    const entry = splitState.entries[0];
    assert.ok(entry, "letter anchor built");
    assert.equal(entry.chunks.length, 4, "four chunk meshes built");
    // Base hides while shattered; every chunk rides its own offset.
    assert.equal(entry.mesh.visible, false, "base letter hides");
    for (const chunk of entry.chunks) {
      assert.equal(chunk.node.visible, true, "chunks visible");
      const dx = chunk.node.position.x - entry.anchor.position.x;
      const dy = chunk.node.position.y - entry.anchor.position.y;
      const dz = chunk.node.position.z - entry.anchor.position.z;
      assert.ok(Math.abs(Math.hypot(dx, dy, dz) - 10) < 1e-6, "chunk explodes a full 10");
      assert.ok(chunk.geometry.attributes.position, "chunk geometry carries positions");
    }
    // Weak strength re-assembles the letter: base returns, chunks hide.
    const weak = fakeSection("Voronoi", { voronoiEnable: 1, voronoiStrength: 0, voronoiChunks: 4 });
    container.customProperties = [weak];
    const weakLayers = T.collectExpressObjects(textObject);
    T.updateExpressRendering(textObject, splitState, weakLayers, 1);
    assert.equal(entry.mesh.visible, true, "base returns when calm");
    assert.ok(entry.chunks.every((c) => !c.node.visible), "chunks hide when calm");
  } finally {
    mod.deactivate();
  }
});

test("each text keeps its own placement across texts", () => {
  const THREE = recordingThree();
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
    },
  };
  const mkSource = () => ({
    material: "mat",
    geometry: { parameters: { options: { depth: 4 } } },
    parent: { add: () => {} },
  });
  const container = {
    zoidiumExpressTextObject: true,
    expressProperties: T.staticProps({ rotationOrder: "XYZ" }),
    customProperties: [fakeSection("Plain", { plainEnable: 1 })],
  };
  const mkText = (x) => ({
    threeObj: mkSource(),
    font: { font3d: { data: fontData } },
    properties: {
      text: { get: () => "A" },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      positionMode: { get: () => 0 },
      position: { get: () => [x, 0, 0] },
      rotation: { get: () => [0, 0, 0] },
      scale: { get: () => [1, 1, 1] },
    },
    parentObject: container,
  });
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
    }
  }
  class FakePropertyList {
    constructor(definitions) {
      this.definitions = definitions;
    }
    load() {}
  }
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
  };
  mod.activate({
    PZ,
    editor: null,
    window: { THREE },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const left = mkText(-30);
    const right = mkText(30);
    for (const t of [left, right]) {
      const layers = T.collectExpressObjects(t);
      T.updateExpressRendering(t, T.getSplitState(t), layers, 0);
    }
    const lState = T.getSplitState(left);
    const rState = T.getSplitState(right);
    assert.equal(lState.renderRoot.position.x, -30, "left text root follows its text");
    assert.equal(rState.renderRoot.position.x, 30, "right text root follows its text");
    assert.deepEqual(lState.renderRoot.scale.args, [1, 1, 1], "default scale passes through");
    // Anchors stay in layout space; the roots carry the placement.
    assert.equal(lState.entries[0].anchor.position.x, rState.entries[0].anchor.position.x, "same layout");
  } finally {
    mod.deactivate();
  }
});

test("grouped texts render with composed placement and shared numbering", () => {
  const THREE = recordingThree();
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
    },
  };
  const mkSource = () => ({
    material: "mat",
    geometry: { parameters: { options: { depth: 4 } } },
    parent: { add: () => {} },
  });
  const container = {
    zoidiumExpressTextObject: true,
    expressProperties: T.staticProps({ rotationOrder: "XYZ" }),
    customProperties: [
      fakeSection("Plain", { plainEnable: 1, plainLetters: "1", plainPosition: [7, 0, 0] }),
    ],
  };
  const mkGroup = (x) => ({
    objects: [],
    properties: {
      position: { get: () => [x, 0, 0] },
      rotation: { get: () => [0, 0, 0] },
      scale: { get: () => [1, 1, 1] },
    },
    parentObject: container,
  });
  const mkText = (x, parent) => ({
    threeObj: mkSource(),
    font: { font3d: { data: fontData } },
    properties: {
      text: { get: () => "A" },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      positionMode: { get: () => 0 },
      position: { get: () => [x, 0, 0] },
      rotation: { get: () => [0, 0, 0] },
      scale: { get: () => [1, 1, 1] },
    },
    parentObject: parent,
  });
  class FakeGroup {
    constructor() {
      this.objects = { name: "" };
      this.children = [];
    }
  }
  class FakePropertyList {
    constructor(definitions) {
      this.definitions = definitions;
    }
    load() {}
  }
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = {
    property: { type: { NUMBER: 1, OPTION: 2, TEXT: 3, VECTOR3: 5, LIST: 6 } },
    propertyList: FakePropertyList,
    object3d: { group: FakeGroup, text: TextObject, eulerOrders: "XYZ" },
  };
  mod.activate({
    PZ,
    editor: null,
    window: { THREE },
    object3d: { registerClass: () => () => {} },
  });
  try {
    const g1 = mkGroup(-30);
    const g2 = mkGroup(30);
    const t1 = mkText(5, g1);
    const t2 = mkText(-5, g2);
    g1.objects.push(t1);
    g2.objects.push(t2);
    container.objects = [g1, g2];
    for (const t of [t1, t2]) {
      const layers = T.collectExpressObjects(t);
      T.updateExpressRendering(t, T.getSplitState(t), layers, 0);
    }
    const s1 = T.getSplitState(t1);
    const s2 = T.getSplitState(t2);
    assert.equal(s1.renderRoot.position.x, -25, "group plus text offsets compose");
    assert.equal(s2.renderRoot.position.x, 25, "second group composes too");
    // Plain Letters "1" addresses the run's first letter through the
    // group boundary: only the first text's letter moves.
    const moved = (s) => s.entries[0].anchor.position.x - s.entries[0].base[0];
    assert.equal(moved(s1), 7, "first group's letter moves");
    assert.equal(moved(s2), 0, "second group's letter holds");
  } finally {
    mod.deactivate();
  }
});

test("letters number continuously across a container's texts", () => {
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
      B: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
      C: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
      D: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
    },
  };
  const mkText = (str) => ({
    font: { font3d: { data: fontData } },
    properties: {
      text: { get: () => str },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
    },
  });
  const container = { objects: [mkText("AB"), mkText("CD")] };
  // Registry finds texts in outliner order, skipping anything else.
  container.objects.push({ zoidiumExpressEffector: "plain" });
  container.objects.push({ zoidiumExpressTextObject: true });
  assert.deepEqual(T.containerTexts(container).map((t) => t.font.font3d.data && "text"), ["text", "text"], "two texts found");
  assert.equal(T.containerTexts(null).length, 0, "null-safe");
  assert.equal(T.layoutLetterCount(mkText("ABCD"), 0), 4, "layout counts letters");
  assert.equal(T.layoutLetterCount(mkText(""), 0), 0, "empty counts zero");
  assert.equal(T.layoutLetterCount({}, 0), 0, "fontless counts zero");
  // Run numbers continuously: AB -> 0,1 and CD -> 2,3.
  const run = T.containerLetterRun(container, container.objects[0], [{ index: 0, base: [0, 0, 0] }, { index: 1, base: [10, 0, 0] }], 0);
  assert.equal(run.total, 4, "total spans texts");
  assert.deepEqual(run.order, [0, 1, 2, 3], "identity order");
  assert.deepEqual(run.starts, [0, 2], "second text starts at 2");
  assert.deepEqual(run.counts, [2, 2], "counts per text");
  assert.equal(run.selfStart, 0, "self start reported");
  // A text missing from objects still resolves alone (probe-style links).
  const lone = T.containerLetterRun({ objects: [] }, mkText("AB"), [{ index: 0, base: [0, 0, 0] }], 0);
  assert.equal(lone.total, 2, "lone text counts itself");
  assert.equal(lone.selfStart, 0, "lone start at zero");
});

test("containerTexts descends through group wrappers", () => {
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 800" },
      B: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 800" },
      C: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 800" },
      D: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 800" },
    },
  };
  const mkText = (str) => ({
    font: { font3d: { data: fontData } },
    properties: {
      text: { get: () => str },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
    },
  });
  const group = (kids) => ({ objects: kids });
  const tAB = mkText("AB");
  const tCD = mkText("CD");
  const container = { objects: [group([tAB]), group([group([tCD])])] };
  assert.deepEqual(T.containerTexts(container), [tAB, tCD], "nested texts in outliner order");
  // Flagged subtrees (effectors, nested containers, Text+ owners) are skipped.
  const hidden = mkText("EF");
  const container2 = {
    objects: [
      { objects: [hidden], zoidiumExpressEffector: "plain" },
      { objects: [mkText("GH")], zoidiumExpressTextObject: true },
      { objects: [mkText("IJ")], zoidiumTextPlusObject: true },
      group([tAB]),
    ],
  };
  assert.deepEqual(T.containerTexts(container2), [tAB], "flagged subtrees skipped");
  assert.equal(T.containerTexts(null).length, 0, "null-safe");
  // Reference cycles terminate instead of looping forever.
  const loop = { objects: [] };
  loop.objects.push(loop);
  assert.deepEqual(T.containerTexts(loop), [], "cycles terminate");
});

test("grouped texts join the connected run with composed placement", () => {
  const fontData = {
    resolution: 1000,
    boundingBox: { yMax: 1000, yMin: 0 },
    glyphs: {
      A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 800" },
      B: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 800" },
      C: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 800" },
      D: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 800" },
    },
  };
  const mkText = (str, parent) => ({
    font: { font3d: { data: fontData } },
    properties: {
      text: { get: () => str },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      position: { get: () => [10, 0, 0] },
      rotation: { get: () => [0, 0, 0] },
      scale: { get: () => [1, 1, 1] },
    },
    parentObject: parent,
  });
  const mkGroup = (props, parent) => ({
    objects: [],
    properties: {
      position: { get: () => (props && props.position) || [0, 0, 0] },
      rotation: { get: () => (props && props.rotation) || [0, 0, 0] },
      scale: { get: () => (props && props.scale) || [1, 1, 1] },
    },
    parentObject: parent,
  });
  const container = { objects: [] };
  const g1 = mkGroup({ position: [5, 0, 0] }, container);
  const g2 = mkGroup({ position: [-40, 0, 0] }, container);
  const tAB = mkText("AB", g1);
  const tCD = mkText("CD", g2);
  g1.objects.push(tAB);
  g2.objects.push(tCD);
  container.objects.push(g1, g2);
  // Continuous numbering spans groups: AB -> 0,1 and CD -> 2,3.
  const run = T.containerLetterRun(container, tAB, [{ index: 0, base: [0, 0, 0] }, { index: 1, base: [10, 0, 0] }], 0);
  assert.equal(run.total, 4, "total spans grouped texts");
  assert.deepEqual(run.starts, [0, 2], "second group starts at 2");
  assert.equal(run.selfStart, 0, "self start reported");
  const run2 = T.containerLetterRun(container, tCD, [{ index: 0, base: [0, 0, 0] }, { index: 1, base: [10, 0, 0] }], 0);
  assert.equal(run2.selfStart, 2, "second text starts at 2");
  // Placement composes through wrappers: 10 (text) + 5 (group) = 15.
  assert.deepEqual(T.textWorldOf(tAB, 0).position, [15, 0, 0], "group offset carries");
  assert.deepEqual(T.textWorldOf(tCD, 0).position, [-30, 0, 0], "second group offset carries");
  // Rotation spins the offset, scale stretches it.
  const spun = mkText("AB", mkGroup({ rotation: [0, 0, Math.PI / 2] }, container));
  const world = T.textWorldOf(spun, 0).position;
  assert.ok(Math.abs(world[0]) < 1e-9 && Math.abs(world[1] - 10) < 1e-9, "group rotation spins the offset");
  const stretched = mkText("AB", mkGroup({ scale: [2, 2, 2] }, container));
  assert.deepEqual(T.textWorldOf(stretched, 0).position, [20, 0, 0], "group scale stretches the offset");
  // Direct children behave exactly as before (loop breaks at the container).
  const direct = mkText("AB", container);
  assert.deepEqual(T.textWorldOf(direct, 0).position, [10, 0, 0], "ungrouped text unchanged");
});

test("world bases round-trip through text transforms", () => {
  const world = { position: [30, 0, 0], rotation: [0, 0, 0], eulerOrder: "XYZ", scale: [1, 1, 1] };
  assert.deepEqual(T.worldBaseOf([5, 0, 0], world), [35, 0, 0], "translated out");
  assert.deepEqual(T.localBaseOf([35, 0, 0], world), [5, 0, 0], "translated back");
  const turned = { position: [0, 0, 0], rotation: [0, 0, Math.PI / 2], eulerOrder: "XYZ", scale: [2, 2, 2] };
  const out = T.worldBaseOf([10, 0, 0], turned);
  assert.ok(Math.abs(out[0]) < 1e-9 && Math.abs(out[1] - 20) < 1e-9, "scaled then turned");
  const back = T.localBaseOf(out, turned);
  assert.ok(Math.abs(back[0] - 10) < 1e-9 && Math.abs(back[1]) < 1e-9, "round-trips exactly");
  assert.deepEqual(T.localBaseOf([5, 5, 5], { position: [0, 0, 0], rotation: [0, 0, 0], eulerOrder: "XYZ", scale: [0, 1, 1] }), [0, 5, 5], "zero scale collapses");
});

test("effectors address connected letter numbers", () => {
  const list = { order: [0, 1, 2, 3], total: 4 };
  const bases = [
    [-30, 0, 0],
    [-10, 0, 0],
    [10, 0, 0],
    [30, 0, 0],
  ];
  const aux = {
    bases: [
      [-30, 0, 0],
      [-10, 0, 0],
      [10, 0, 0],
      [30, 0, 0],
    ],
    selfWorld: { position: [0, 0, 0], rotation: [0, 0, 0], eulerOrder: "XYZ", scale: [1, 1, 1] },
  };
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  // Plain Letters "3-4" reaches the second text's letters (global 2,3).
  const plain = {
    kind: "plain",
    props: props({
      plainEnable: 1,
      plainLetters: "3-4",
      plainStrength: 100,
      plainPosition: [7, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const at = (layers, frame, index, base, a) =>
    T.evaluateStack(layers, containerProps, frame, index, list, base, a || aux);
  assert.deepEqual(at([plain], 0, 0, bases[0]).position, [0, 0, 0], "global 0 skipped");
  assert.deepEqual(at([plain], 0, 2, bases[2]).position, [7, 0, 0], "global 2 moved");
  // Formula id/u/count span the run: last letter reads id 3, u 1.
  const wave = {
    kind: "formula",
    props: props({
      formulaEnable: 1,
      formulaLetters: "",
      formulaStrength: 100,
      formulaMinimum: 0,
      formulaMaximum: 100,
      formulaExpression: "id",
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
  assert.equal(at([wave], 0, 3, bases[3]).position[0], 3, "id counts across texts");
  const uu = {
    kind: "formula",
    props: props({
      formulaEnable: 1,
      formulaLetters: "",
      formulaStrength: 100,
      formulaMinimum: 0,
      formulaMaximum: 100,
      formulaExpression: "u",
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
  assert.equal(at([uu], 0, 3, bases[3]).position[0], 1, "u reaches 1 on the last letter");
  assert.equal(at([uu], 0, 0, bases[0]).position[0], 0, "u starts at 0 on the first");
  // Spline Step spreads by global rank: last letter takes the end slot.
  const line = {
    kind: "spline",
    props: props({
      splineEnable: 1,
      splineLetters: "",
      splineStrength: 100,
      splineMode: 0,
      splineTransform: 0,
      splinePath: 0,
      splineLength: 100,
      splineRadius: 50,
      splineRadiusEnd: 50,
      splineHeight: 100,
      splineTurns: 1,
      splinePlane: 0,
      splineReverse: 0,
      splineOffset: 0,
      splineStart: 0,
      splineEnd: 100,
      splineClamp: 1,
      splinePosition: 1,
      splineRotation: 0,
      splineHeading: 0,
      splinePitch: 0,
      splineBank: 0,
      splineDelay: 0,
      splineDelayOrder: 0,
      splineField: 0,
    }),
  };
  assert.equal(bases[3][0] + at([line], 0, 3, bases[3]).position[0], 50, "global rank takes the end");
  // Orbit centers on the selected pair across texts: letters 1-2 swap.
  const orb = {
    kind: "orbit",
    props: props({
      orbitEnable: 1,
      orbitLetters: "1-2",
      orbitStrength: 100,
      orbitAngle: [0, 0, Math.PI],
      orbitRadius: 100,
      orbitDelay: 0,
      orbitDelayOrder: 0,
      orbitField: 0,
    }),
  };
  assert.equal(bases[0][0] + at([orb], 0, 0, bases[0]).position[0], -10, "pair swaps across texts");
  assert.equal(bases[1][0] + at([orb], 0, 1, bases[1]).position[0], -30, "pair swaps back");
  // Sorted strata spread across the run, not per text.
  const sorted = {
    kind: "random",
    props: props({
      randomEnable: 1,
      randomLetters: "",
      randomStrength: 100,
      randomMode: 4,
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
      randomRotationMax: [0, 0, 0],
      randomScaleMin: [1, 1, 1],
      randomScaleMax: [1, 1, 1],
      randomDelay: 0,
      randomDelayOrder: 0,
      randomField: 0,
    }),
  };
  const strata = [0, 1, 2, 3].map((i) => at([sorted], 0, i, bases[i]).position[0]);
  assert.deepEqual(
    [...strata].sort((a, b) => a - b).map((v) => Math.round(v * 100) / 100 + 0),
    [1.25, 3.75, 6.25, 8.75],
    "sorted spreads across texts"
  );
});
