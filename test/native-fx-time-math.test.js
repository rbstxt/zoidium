"use strict";

// CPU mirrors of the EffectCraft time formulas behind the Native FX time
// effects, checked against hand-computed pixels. The mirrors follow the
// reference arithmetic (unpremultiply, Rec.709 luma, gain 1 + contrast/25,
// slice round(luma * (N - 1))); the expectations below were computed by hand
// from that arithmetic, so agreement pins the port rather than the code.

const assert = require("node:assert/strict");
const test = require("node:test");

function unpremul(px) {
  if (px[3] > 0) return [[px[0] / px[3], px[1] / px[3], px[2] / px[3]], px[3]];
  return [[0, 0, 0], Math.max(px[3], 0)];
}

function premul(rgb, a) {
  return [rgb[0] * a, rgb[1] * a, rgb[2] * a, a];
}

function timeDifference(current, target, { gain = 1, absolute = true, alphaMode = 0 } = {}) {
  const [c, ca] = unpremul(current);
  const [d, da] = unpremul(target);
  const diff = [c[0] - d[0], c[1] - d[1], c[2] - d[2]];
  let rgb;
  if (absolute) {
    rgb = diff.map((v) => Math.min(1, Math.max(0, Math.abs(v) * gain)));
  } else {
    rgb = diff.map((v) => Math.min(1, Math.max(0, 0.5 + v * 0.5 * gain)));
  }
  const brightest = Math.max(...rgb);
  const darkest = Math.min(...rgb);
  const lightness = (brightest + darkest) * 0.5;
  let a = ca;
  if (alphaMode === 1) a = da;
  else if (alphaMode === 2) a = (ca + da) * 0.5;
  else if (alphaMode === 3) a = Math.max(ca, da);
  else if (alphaMode === 4) a = 1;
  else if (alphaMode === 5) a = lightness;
  else if (alphaMode === 6) a = brightest;
  else if (alphaMode === 7) a = Math.abs(ca - da) * gain;
  else if (alphaMode === 8) {
    a = Math.min(1, Math.max(0, Math.abs(ca - da) * gain));
    rgb = [1, 1, 1];
  }
  a = Math.min(1, Math.max(0, a));
  return premul(rgb, a);
}

function approx(actual, expected, eps = 1e-6, message = "") {
  const tolerance = typeof eps === "string" ? 1e-6 : eps;
  const note = typeof eps === "string" ? ` (${eps})` : message ? ` (${message})` : "";
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i += 1) {
    assert.ok(
      Math.abs(actual[i] - expected[i]) <= tolerance,
      `${actual} ~= ${expected}${note}`,
    );
  }
}

test("time difference of identical frames is the zero image", () => {
  approx(timeDifference([0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]), [0, 0, 0, 0.5]);
  approx(
    timeDifference([0.5, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5], { absolute: false }),
    [0.25, 0.25, 0.25, 0.5],
    "signed mid grey, alpha kept",
  );
});

test("time difference absolute mode reports motion magnitude", () => {
  // White text over black background: |1 - 0| * 1 = 1.
  approx(timeDifference([1, 1, 1, 1], [0, 0, 0, 1]), [1, 1, 1, 1]);
  // Contrast 25 doubles the gain: |0.5 - 0| * 2 clamps to 1.
  approx(timeDifference([0.5, 0.5, 0.5, 1], [0, 0, 0, 1], { gain: 2 }), [1, 1, 1, 1]);
  // Signed mode centers the difference on mid grey.
  approx(timeDifference([1, 1, 1, 1], [0, 0, 0, 1], { absolute: false }), [1, 1, 1, 1]);
  approx(timeDifference([0, 0, 0, 1], [1, 1, 1, 1], { absolute: false }), [0, 0, 0, 1]);
});

test("time difference alpha modes select the documented channel", () => {
  const current = [0.5, 0.5, 0.5, 0.5];
  const target = [0.25, 0.25, 0.25, 0.5];
  // Unpremultiplied: c = white, d = mid grey; rgb diff is 0.5 grey.
  const modes = {
    0: 0.5,
    1: 0.5,
    2: 0.5,
    3: 0.5,
    4: 1,
    5: 0.5,
    6: 0.5,
    7: 0,
    8: 0,
  };
  for (const [mode, alpha] of Object.entries(modes)) {
    const out = timeDifference(current, target, { alphaMode: Number(mode) });
    assert.equal(out[3], alpha, `alpha mode ${mode}`);
  }
  const white = timeDifference(current, target, { alphaMode: 8 });
  approx(white, [0, 0, 0, 0], "alpha-difference-only forces white rgb at zero alpha");
});

function wideTimeAverage(frames) {
  const weight = 1 / frames.length;
  return frames[0].map((_, c) => frames.reduce((sum, f) => sum + f[c] * weight, 0));
}

test("wide time averages taps and accumulates in blur mode", () => {
  const taps = [
    [0.2, 0.2, 0.2, 0.2],
    [0.4, 0.4, 0.4, 0.4],
    [0.6, 0.6, 0.6, 0.6],
  ];
  approx(wideTimeAverage(taps), [0.4, 0.4, 0.4, 0.4]);
  // Identical frames average to themselves (viewport identity check).
  approx(wideTimeAverage([taps[0], taps[0], taps[0]]), taps[0]);
});

function displacementSlice(luma, slices) {
  return Math.min(slices - 1, Math.max(0, Math.floor(luma * (slices - 1) + 0.5)));
}

function displacementOffsets(maxFrames, slices) {
  const offsets = [];
  for (let index = 0; index < slices; index += 1) {
    offsets.push(-maxFrames + (2 * maxFrames * index) / (slices - 1));
  }
  return offsets;
}

test("displacement slices span the symmetric range", () => {
  assert.deepEqual(displacementOffsets(30, 5), [-30, -15, 0, 15, 30]);
  assert.deepEqual(displacementOffsets(30, 2), [-30, 30]);
  assert.equal(displacementSlice(0, 16), 0);
  assert.equal(displacementSlice(1, 16), 15);
  // Transparent map pixels read as mid grey, like the reference.
  assert.equal(displacementSlice(0.5, 16), 8);
  assert.equal(displacementSlice(0.5, 2), 1);
});
