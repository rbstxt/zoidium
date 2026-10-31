"use strict";
// Exactness contract for the hit-test broad-phase rejection in
// plugins/shape-plus/editor-geometry.js. The old implementation below is a
// verbatim copy of `hit` before the control-hull bounds check was added; the
// shared `nearest` solver is unchanged, so every query must return an exactly
// equal result (kind, index, side, t, distance) from the new implementation.
const test = require("node:test"),
  assert = require("node:assert/strict");
const g = require("../plugins/shape-plus/editor-geometry.js");
const { distance, evaluate, verticesToCubics } = require("../plugins/shape-plus/path.js");

function oldHit(
  points,
  closed,
  point,
  scale,
  handles = true,
  endpointHandles = false,
) {
  const radius = 8 / scale;
  if (handles)
    for (let i = points.length - 1; i >= 0; i--)
      for (const side of ["out", "in"]) {
        if (
          !closed &&
          !endpointHandles &&
          ((side === "in" && i === 0) ||
            (side === "out" && i === points.length - 1))
        )
          continue;
        if (
          Math.hypot(...points[i][side]) > 1e-8 &&
          distance(point, g.add(points[i].point, points[i][side])) <= radius
        )
          return { kind: "handle", index: i, side };
      }
  for (let i = points.length - 1; i >= 0; i--)
    if (distance(point, points[i].point) <= radius)
      return { kind: "anchor", index: i };
  let best = null;
  verticesToCubics(points, closed).forEach((c, index) => {
    const found = g.nearest(c, point);
    if (found.distance <= radius && (!best || found.distance < best.distance))
      best = { kind: "segment", index, ...found };
  });
  return best;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const v = (point, input, out) => ({ point, in: input, out });
const straight = (x, y) => v([x, y], [0, 0], [0, 0]);

const fixtures = {
  // A cubic loop: outgoing and incoming handles cross the chord.
  loop: [
    v([0, 0], [0, 0], [120, 80]),
    v([100, 0], [-40, 90], [0, 0]),
  ],
  // A cusp: handles leave the anchor in the same direction.
  cusp: [
    v([0, 0], [-60, -60], [60, 60]),
    v([120, 0], [50, 70], [-50, -70]),
  ],
  // Degenerate spans: coincident anchors and zero-length handles.
  degenerate: [
    straight(10, 10),
    straight(10, 10),
    v([10, 10], [0, 0], [40, 0]),
    v([90, 10], [-40, 0], [0, 0]),
    straight(90, 10),
  ],
  // Long curved handles far from the chord.
  curved: [
    v([0, 0], [0, 0], [30, 160]),
    v([200, 40], [-30, -160], [0, 0]),
  ],
  // A many-segment ring, as in an imported SVG path.
  ring: Array.from({ length: 12 }, (_, i) => {
    const t = (i / 12) * 2 * Math.PI;
    return straight(80 * Math.cos(t), 55 * Math.sin(t));
  }),
};

function checkPath(points, closed, label) {
  const cubics = verticesToCubics(points, closed);
  const grid = [];
  // Dense grid sweep around the path's bounding box.
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.point[0]);
    maxX = Math.max(maxX, p.point[0]);
    minY = Math.min(minY, p.point[1]);
    maxY = Math.max(maxY, p.point[1]);
  }
  for (let x = minX - 20; x <= maxX + 20; x += 11)
    for (let y = minY - 20; y <= maxY + 20; y += 11) grid.push([x, y]);
  const exact = [];
  // Points sampled along each curve, plus exact-radius boundary points.
  for (const c of cubics)
    for (let i = 0; i <= 8; i++) {
      const t = i / 8,
        on = evaluate(c, t);
      exact.push(on);
      for (const scale of [0.25, 0.5, 1, 2, 4]) {
        const r = 8 / scale;
        exact.push([on[0] + r, on[1]]);
        exact.push([on[0] - r, on[1]]);
        exact.push([on[0], on[1] + r]);
        exact.push([on[0], on[1] - r]);
      }
    }
  // Points just outside the exact boundary must miss in both versions.
  for (const c of cubics)
    for (let i = 0; i <= 4; i++) {
      const on = evaluate(c, i / 4);
      exact.push([on[0] + 8 + 1e-6, on[1]]);
    }
  const check = (q, scale, endpointHandles) => {
    const a = oldHit(points, closed, q, scale, true, endpointHandles);
    const b = g.hit(points, closed, q, scale, true, endpointHandles);
    assert.deepEqual(
      b,
      a,
      `${label} closed=${closed} scale=${scale} endpointHandles=${endpointHandles} point=${q}: old=${JSON.stringify(a)} new=${JSON.stringify(b)}`,
    );
  };
  // The grid runs at one scale; curve and boundary points run the full
  // scale x endpoint-handle cross product where rejection matters most.
  // Endpoint-handle logic is untouched by the change, so the open-handle
  // variant runs at one scale over the exact points.
  for (const endpointHandles of [false, true]) for (const q of grid) check(q, 1, endpointHandles);
  for (const scale of [0.25, 0.5, 1, 2, 4])
    for (const q of exact) check(q, scale, false);
  for (const q of exact) check(q, 1, true);
  // Handle checks disabled, as in hover without handle targets.
  for (const q of grid) {
    const a = oldHit(points, closed, q, 1, false);
    const b = g.hit(points, closed, q, 1, false);
    assert.deepEqual(b, a, `${label} handles=false point=${q}`);
  }
}

test("hit bounds rejection matches the old implementation exactly", () => {
  for (const [label, points] of Object.entries(fixtures)) {
    checkPath(points, false, `${label}/open`);
    checkPath(points, true, `${label}/closed`);
  }
});

test("hit bounds rejection matches on seeded random paths", () => {
  const rand = mulberry32(20261031);
  for (let path = 0; path < 12; path++) {
    const n = 2 + Math.floor(rand() * 10);
    const points = Array.from({ length: n }, () => ({
      point: [(rand() - 0.5) * 400, (rand() - 0.5) * 400],
      in: [(rand() - 0.5) * 160, (rand() - 0.5) * 160],
      out: [(rand() - 0.5) * 160, (rand() - 0.5) * 160],
    }));
    // Force occasional degenerate handles.
    if (path % 3 === 0) points[0].out = [0, 0];
    if (path % 4 === 0) points[1].in = points[0].out.slice();
    const closed = path % 2 === 0;
    for (const scale of [0.5, 1, 3]) {
      for (let q = 0; q < 300; q++) {
        const p = [(rand() - 0.5) * 460, (rand() - 0.5) * 460];
        assert.deepEqual(
          g.hit(points, closed, p, scale),
          oldHit(points, closed, p, scale),
          `seeded path ${path} closed=${closed} scale=${scale} point=${p}`,
        );
      }
      // Boundary points at exactly the hit radius from sampled curve points.
      for (const c of verticesToCubics(points, closed))
        for (let i = 0; i <= 8; i++) {
          const on = evaluate(c, i / 8),
            r = 8 / scale;
          for (const q of [
            [on[0] + r, on[1]],
            [on[0], on[1] - r],
          ])
            assert.deepEqual(
              g.hit(points, closed, q, scale),
              oldHit(points, closed, q, scale),
              `seeded boundary path ${path} scale=${scale} point=${q}`,
            );
        }
    }
  }
});
