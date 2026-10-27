"use strict";

// ExpressText+ tests: effectors-b. Required by test/expresstext-plus.test.js; not discovered directly.

const assert = require("node:assert/strict");
const test = require("node:test");
const { T, props } = require("./expresstext-plus-helpers.js");

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

