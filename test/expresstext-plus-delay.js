"use strict";

// ExpressText+ tests: delay. Required by test/expresstext-plus.test.js; not discovered directly.

const assert = require("node:assert/strict");
const test = require("node:test");
const { T, keyedProps, props } = require("./expresstext-plus-helpers.js");

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

