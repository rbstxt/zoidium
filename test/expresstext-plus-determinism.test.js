"use strict";

// ExpressText+ evaluation-order guarantees: a frame's letter transforms are
// a pure function of the stack and the frame, so scrubbing, reversed play
// and random access all render the same pixels.

const assert = require("node:assert/strict");
const test = require("node:test");
const { T, props, keyedProps } = require("./expresstext-plus-helpers.js");

const LIST = { order: [0, 1, 2, 3, 4, 5], total: 6 };
const BASES = [
  [-25, 0, 0],
  [-15, 0, 0],
  [-5, 0, 0],
  [5, 0, 0],
  [15, 0, 0],
  [25, 0, 0],
];

function containerProps() {
  return T.staticProps({ rotationOrder: "XYZ" });
}

function animatedPlain() {
  return {
    kind: "plain",
    props: keyedProps({
      plainEnable: 1,
      plainLetters: "",
      plainStrength: 100,
      plainPosition: (frame) => [frame * 2, Math.sin(frame / 5) * 4, 0],
      plainRotation: (frame) => [0, 0, frame * 3],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 1,
      plainFieldPosition: [0, 0, 0],
      plainFieldScale: [100, 100, 100],
    }),
  };
}

function noiseValues(extra) {
  return {
    randomEnable: 1,
    randomLetters: "",
    randomStrength: 100,
    randomMode: 2,
    randomMinimum: 0,
    randomMaximum: 100,
    randomSynchronized: 0,
    randomIndexed: 1,
    randomSeed: 7,
    randomSpace: 0,
    randomAnimationSpeed: 50,
    randomNoiseScale: 100,
    randomPositionMin: [-8, -8, -8],
    randomPositionMax: [8, 8, 8],
    randomRotationMin: [0, 0, 0],
    randomRotationMax: [0, 0, 0],
    randomScaleMin: [1, 1, 1],
    randomScaleMax: [1, 1, 1],
    randomDelay: 0,
    randomDelayOrder: 0,
    randomField: 0,
    ...extra,
  };
}

function animatedNoise() {
  return { kind: "random", props: props(noiseValues()) };
}

function animatedTurbulence() {
  return { kind: "random", props: props(noiseValues({ randomMode: 3, randomSeed: 11 })) };
}

function timeFormula() {
  return {
    kind: "formula",
    props: props({
      formulaEnable: 1,
      formulaLetters: "",
      formulaStrength: 100,
      formulaExpression: "60*t + 30*sin(u*360)",
      formulaPosition: [1, 0, 0],
      formulaRotation: [0, 0, 0],
      formulaScale: [1, 1, 1],
      formulaMinimum: 0,
      formulaMaximum: 100,
      formulaField: 0,
    }),
  };
}

function echoRepeater() {
  return {
    kind: "repeater",
    props: props({
      repeaterEnable: 1,
      repeaterLetters: "",
      repeaterStrength: 100,
      repeaterCopies: 3,
      repeaterMode: 2,
      repeaterOffset: [10, 0, 0],
      repeaterRangeMin: [-10, -10, -10],
      repeaterRangeMax: [10, 10, 10],
      repeaterSeed: 7,
      repeaterLag: 2,
      repeaterFade: 50,
      repeaterField: 0,
    }),
  };
}

function delayLayer(mode) {
  return {
    kind: "delay",
    props: props({
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: mode,
      delayField: 0,
    }),
  };
}

// One frame's full letter output the way the render path consumes it:
// stacked transforms plus the echo-ghost offsets trailing each letter.
function snapshot(stack, frame) {
  constSpecsCheck(stack);
  const specs = T.repeaterSpecsFor(stack, frame).filter(
    (spec) => spec.mode === 2 && spec.copies > 0
  );
  return LIST.order.map((index) => {
    const controls = T.evaluateStack(stack, containerProps(), frame, index, LIST, BASES[index]);
    const prev = T.evaluateStack(stack, containerProps(), frame - 1, index, LIST, BASES[index]);
    const velocity = [
      controls.position[0] - prev.position[0],
      controls.position[1] - prev.position[1],
      controls.position[2] - prev.position[2],
    ];
    return {
      position: controls.position,
      rotation: controls.rotation,
      scale: controls.scale,
      echo: specs.map((spec) =>
        [1, 2, 3]
          .filter((slot) => slot <= spec.copies)
          .map((slot) => T.repeaterCopyOffset(spec, index, slot, velocity))
      ),
    };
  });
}

function constSpecsCheck(stack) {
  for (const layer of stack) {
    assert.ok(layer && typeof layer.kind === "string", "stack layers carry kinds");
  }
}

for (const mode of [0, 1, 2]) {
  test(`frame 90 matches after any evaluation order with delay mode ${mode}`, () => {
    const stack = [animatedPlain(), animatedNoise(), animatedTurbulence(), timeFormula(), delayLayer(mode), echoRepeater()];
    const direct = snapshot(stack, 90);
    for (let frame = 0; frame <= 120; frame += 1) snapshot(stack, frame);
    assert.deepEqual(snapshot(stack, 90), direct, "sequential scrub preserves frame 90");
    snapshot(stack, 120);
    snapshot(stack, 30);
    assert.deepEqual(snapshot(stack, 90), direct, "random access preserves frame 90");
  });
}
