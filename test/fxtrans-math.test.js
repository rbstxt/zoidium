"use strict";

// fx-trans Native FX math: determinism, ranges, and CPU references for
// CC Page Turn, Card Wipe, CC Pixel Polly and Radial Shadow.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const math = require("../plugins/native-fx/effects/fxtrans-math.js");

function gradientImage(w, h) {
  const img = math.makeImage(w, h, null);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      img.data[o] = (x / w);
      img.data[o + 1] = (y / h);
      img.data[o + 2] = 0.25;
      img.data[o + 3] = 1;
    }
  }
  return img;
}

function maxDiff(a, b) {
  assert.equal(a.width, b.width);
  assert.equal(a.height, b.height);
  let m = 0;
  for (let i = 0; i < a.data.length; i++) m = Math.max(m, Math.abs(a.data[i] - b.data[i]));
  return m;
}

test("hashNoise is deterministic in [0,1) and spreads", () => {
  for (const [x, y, s] of [[0, 0, 0], [7, 3, 99], [1000, 500, 12345], [-1, -2, -3]]) {
    const v = math.hashNoise(x, y, s);
    assert.ok(v >= 0 && v < 1, `${x},${y},${s} -> ${v}`);
    assert.equal(math.hashNoise(x, y, s), v);
  }
  const seen = new Set();
  for (let i = 0; i < 64; i++) seen.add(math.hashNoise(i, i * 3, 7));
  assert.ok(seen.size > 60, "hash values collide too often");
  assert.ok(Math.abs(math.hashNoise(1, 2, 3) - math.hashNoise(1, 2, 4)) > 1e-9);
});

test("foldSeed folds like randomSeed as u32 ^ 0xca7d", () => {
  assert.equal(math.foldSeed(1), (1 ^ 0xca7d) | 0);
  assert.equal(math.foldSeed(1.9), (1 ^ 0xca7d) | 0);
  assert.equal(math.foldSeed(0), (0 ^ 0xca7d) | 0);
});

test("cardOrderOffset covers all flip orders", () => {
  assert.equal(math.cardOrderOffset(0, 0, 0, 4, 4), 0);
  assert.equal(math.cardOrderOffset(0, 3, 0, 4, 4), 1);
  assert.equal(math.cardOrderOffset(1, 0, 0, 4, 4), 1);
  assert.equal(math.cardOrderOffset(1, 3, 0, 4, 4), 0);
  assert.equal(math.cardOrderOffset(2, 0, 3, 4, 4), 1);
  assert.equal(math.cardOrderOffset(3, 0, 3, 4, 4), 0);
  assert.equal(math.cardOrderOffset(4, 3, 3, 4, 4), 1);
  assert.equal(math.cardOrderOffset(7, 3, 3, 4, 4), 0);
  assert.equal(math.cardOrderOffset(8, 0, 0, 4, 4, 0.42), 0.42);
  assert.equal(math.cardOrderOffset(8, 0, 0, 4, 4, 9), 1);
  assert.equal(math.cardOrderOffset(8, 0, 0, 4, 4, -2), 0);
  assert.equal(math.cardOrderOffset(0, 0, 0, 1, 1), 0);
});

test("cardProgress is 0 at completion 0 and 1 at completion 1", () => {
  for (let k = 0; k <= 10; k++) {
    const o = k / 10;
    assert.equal(math.cardProgress(0, o, 0.5), 0, `o=${o}`);
    assert.equal(math.cardProgress(1, o, 0.5), 1, `o=${o}`);
  }
  assert.ok(math.cardProgress(0.5, 0, 0.5) === 1, "first card finishes early");
  assert.ok(math.cardProgress(0.5, 1, 0.5) === 0, "last card has not started");
  const mid = math.cardProgress(0.5, 0.5, 0.5);
  assert.ok(mid > 0 && mid < 1, `mid card mid-flight: ${mid}`);
});

test("cardRandoms are deterministic per (card, seed)", () => {
  const a = math.cardRandoms(5, 2, 123);
  const b = math.cardRandoms(5, 2, 123);
  assert.deepEqual(a, b);
  for (const v of Object.values(a)) assert.ok(v >= 0 && v < 1);
  const c = math.cardRandoms(6, 2, 123);
  assert.ok(Math.abs(a.axis - c.axis) > 1e-9 || Math.abs(a.dir - c.dir) > 1e-9);
});

test("rotAxis3 is identity for a zero axis and rotates about z", () => {
  const id = math.rotAxis3(0, 0, 0, 1);
  assert.deepEqual(id, [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
  const r = math.rotAxis3(0, 0, 1, Math.PI / 2);
  assert.ok(Math.abs(r[0][0]) < 1e-12 && Math.abs(r[0][1] + 1) < 1e-12);
  assert.ok(Math.abs(r[1][0] - 1) < 1e-12 && Math.abs(r[2][2] - 1) < 1e-12);
  assert.equal(math.facingOf(r), r[2][2]);
});

test("pollyPlan is deterministic, identical at t=0, and counts pieces", () => {
  const opts = {
    layerWidth: 64, layerHeight: 48, force: 100, gravity: 1, spinning: 30,
    forceCenter: [32, 24], directionRandomness: 10, speedRandomness: 10,
    gridSpacing: 8, object: 0, enableDepthSort: true, randomSeed: 1, t: 0,
  };
  const a = math.pollyPlan(opts);
  const b = math.pollyPlan(opts);
  assert.deepEqual(a, b);
  assert.equal(a.cols, 8);
  assert.equal(a.rows, 6);
  assert.equal(a.pieces.length, 8 * 6 * 2);
  for (const p of a.pieces) {
    assert.ok(Math.abs(p.pos[0] - p.center[0]) < 1e-9);
    assert.ok(Math.abs(p.pos[1] - p.center[1]) < 1e-9);
    assert.ok(Math.abs(p.pos[2]) < 1e-9);
    assert.ok(p.shade >= 0 && p.shade <= 1);
  }
  const squares = math.pollyPlan({ ...opts, object: 3 });
  assert.equal(squares.pieces.length, 8 * 6);
  assert.ok(squares.textured);
  assert.ok(!a.textured);
  const later = math.pollyPlan({ ...opts, t: 0.5 });
  assert.ok(later.pieces.some((p, i) => Math.abs(p.pos[0] - a.pieces[i].pos[0]) > 1e-6));
  // Depth sort orders far (negative z) first.
  for (let i = 1; i < later.pieces.length; i++) {
    assert.ok(later.pieces[i].pos[2] >= later.pieces[i - 1].pos[2] - 1e-12);
  }
});

test("pollyPlan caps runaway piece counts by widening the grid", () => {
  const plan = math.pollyPlan({
    layerWidth: 1920, layerHeight: 1080, force: 100, gravity: 1, spinning: 0,
    forceCenter: [960, 540], directionRandomness: 0, speedRandomness: 0,
    gridSpacing: 4, object: 1, enableDepthSort: true, randomSeed: 1, t: 1,
    maxPieces: 100,
  });
  assert.ok(plan.pieces.length <= 100, `got ${plan.pieces.length}`);
  assert.ok(plan.spacing >= 4);
});

test("projectCorner centres on the piece and scales with depth", () => {
  const rot = math.rotAxis3(0, 0, 1, 0);
  const piece = { pos: [100, 50, 0], rot };
  const c = math.projectCorner(0, 0, piece, 200, 100, 400);
  assert.ok(Math.abs(c.x - 100) < 1e-9 && Math.abs(c.y - 50) < 1e-9);
  assert.equal(c.scale, 1);
  const near = math.projectCorner(0, 0, { pos: [100, 50, 200], rot }, 200, 100, 400);
  assert.ok(near.scale > 1, `near scale ${near.scale}`);
});

test("cardWipePixel is identity at 0 and backs-only at 1", () => {
  const img = gradientImage(48, 32);
  const sample = (luv) => math.sampleBilinear(img, luv[0] * 48, luv[1] * 32);
  const seed = math.foldSeed(1);
  const rndAt = (i, j) => math.cardRandoms(j * 6 + i, j, seed);
  const base = {
    rows: 4, columns: 6, cardScale: 1, flipAxis: 0, flipDirection: 0,
    flipOrder: 0, timingRandomness: 0, completion: 0, transitionWidth: 0.5,
    backMode: 1, backColor: [0, 0, 0], cameraDist: 2, lightIntensity: 1,
    ambient: 0.25, aspect: 1.5,
  };
  for (const [u, v] of [[0.01, 0.01], [0.5, 0.5], [0.99, 0.99], [0.3, 0.7]]) {
    const got = math.cardWipePixel(base, [u, v], rndAt, sample);
    const want = sample([u, v]);
    assert.ok(got.every((c, k) => Math.abs(c - want[k]) < 1e-9), `${u},${v}`);
  }
  const full = { ...base, completion: 1 };
  let alpha = 0;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 48; x++) {
      alpha += math.cardWipePixel(full, [(x + 0.5) / 48, (y + 0.5) / 32], rndAt, sample)[3];
    }
  }
  assert.equal(alpha, 0, "transparent backs at 100%");
  const colorBack = { ...base, completion: 1, backMode: 0, backColor: [0.2, 0.4, 0.6] };
  const mid = math.cardWipePixel(colorBack, [0.5, 0.5], rndAt, sample);
  assert.ok(Math.abs(mid[0] - 0.2) < 1e-9 && Math.abs(mid[3] - 1) < 1e-9);
});

test("pageTurnImage removes the folded corner and keeps the far side", () => {
  const img = gradientImage(64, 64);
  const base = {
    foldPosition: [0.7 * 64, 0.7 * 64], foldDirection: 315, foldRadius: 4,
    lightDirection: -45, render: 0, backPageOpacity: 75, paperColor: [1, 1, 1],
  };
  const out = math.pageTurnImage(base, img);
  assert.deepEqual(math.pageTurnImage(base, img).data, out.data, "deterministic");
  const corner = (y, x) => [out.data[(y * 64 + x) * 4 + 3]];
  assert.ok(corner(63, 63)[0] < 1e-6, "folded corner is transparent");
  assert.deepEqual(
    [out.data[(2 * 64 + 2) * 4], out.data[(2 * 64 + 2) * 4 + 1]],
    [img.data[(2 * 64 + 2) * 4], img.data[(2 * 64 + 2) * 4 + 1]],
    "far side untouched"
  );
  const frontOnly = math.pageTurnImage({ ...base, render: 2 }, img);
  assert.ok(maxDiff(frontOnly, out) > 1e-3, "render mode changes output");
});

test("radialShadowImage keeps the original on top and scales the shadow", () => {
  const img = math.makeImage(60, 60, null);
  for (let y = 25; y < 35; y++) {
    for (let x = 25; x < 35; x++) {
      const o = (y * 60 + x) * 4;
      img.data[o] = 1;
      img.data[o + 3] = 1;
    }
  }
  const base = {
    shadowColor: [0, 0, 0], opacity: 100, lightSource: [30.5, 30.5],
    projectionDistance: 100, render: 0, colorInfluence: 0, shadowOnly: false,
  };
  const out = math.radialShadowImage(base, img);
  assert.deepEqual(math.radialShadowImage(base, img).data, out.data, "deterministic");
  const centre = (y, x) => Array.from(out.data.slice((y * 60 + x) * 4, (y * 60 + x) * 4 + 4));
  assert.deepEqual(centre(30, 30), [1, 0, 0, 1], "original stays on top");
  // Shadow extends beyond the square (k = 2 about the centre).
  let shadowAlpha = 0;
  for (let x = 36; x < 45; x++) shadowAlpha = Math.max(shadowAlpha, centre(30, x)[3]);
  assert.ok(shadowAlpha > 0.2, `shadow cast outward, alpha ${shadowAlpha}`);
  const only = math.radialShadowImage({ ...base, shadowOnly: true }, img);
  const onlyCentre = (y, x) => Array.from(only.data.slice((y * 60 + x) * 4, (y * 60 + x) * 4 + 4));
  assert.deepEqual(onlyCentre(30, 30), [0, 0, 0, 1], "shadow-only shows the shadow, not the original");
  const glass = math.radialShadowImage({ ...base, render: 1 }, img);
  assert.ok(maxDiff(glass, out) > 1e-3, "glass edge changes the shadow");
});
