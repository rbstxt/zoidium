"use strict";

// Characterization tests for Geometry+: they pin the pure spline/tube math
// and the registered object classes before the plugin is split into files.
// The plugin is activated with stub hosts; the math is reached through the
// test-only plugin._test handles populated by activate().

const assert = require("node:assert/strict");
const test = require("node:test");
const plugin = require("../plugins/geometry-plus/geometry-plus.js");

class StubVector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}

class StubFace3 {
  constructor(a, b, c) {
    this.a = a;
    this.b = b;
    this.c = c;
  }
}

class StubGeometry {
  constructor() {
    this.vertices = [];
    this.faces = [];
  }

  computeFaceNormals() {}

  computeVertexNormals() {}
}

class StubCurve {}

class StubTubeGeometry {
  constructor(curve, tubularSegments, radius, radialSegments, closed) {
    this.midpoint = curve.getPoint(0.5);
    this.args = { tubularSegments, radius, radialSegments, closed };
  }
}

function activateForMath() {
  class StubObject3d {}
  StubObject3d.shape = { propertyDefinitions: {} };
  const PZ = {
    property: { create: (definition) => definition, type: {} },
    object3d: StubObject3d,
  };
  const THREE = {
    Vector3: StubVector3,
    Face3: StubFace3,
    Geometry: StubGeometry,
    Curve: StubCurve,
    TubeGeometry: StubTubeGeometry,
  };
  const registered = [];
  plugin.activate({
    PZ,
    window: { THREE },
    object3d: {
      registerClass: (definition) => {
        registered.push(definition);
        return () => {};
      },
    },
  });
  return { THREE, registered };
}

function closeEnough(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (const [index, value] of actual.entries()) {
    assert.ok(
      Math.abs(value - expected[index]) < 1e-9,
      `index ${index}: ${value} ~= ${expected[index]}`
    );
  }
}

test("geometry spline defaults describe a three-point arch", () => {
  activateForMath();
  try {
    assert.equal(plugin._test.SPLINE_MAX_POINTS, 32);
    assert.equal(plugin._test.SPLINE_DEFAULT_POINTS, 3);
    assert.deepEqual(plugin._test.SPLINE_DEFAULT_POINT_POSITIONS, [
      [-20, 0, 0],
      [0, 20, 0],
      [20, 0, 0],
    ]);
  } finally {
    plugin.deactivate();
  }
});

test("linear spline sampling interpolates open and closed point lists", () => {
  activateForMath();
  try {
    closeEnough(
      plugin._test.sampleSplineCurve(
        [
          [0, 0, 0],
          [10, 0, 0],
        ],
        "Linear",
        0.25,
        false,
        1
      ),
      [2.5, 0, 0]
    );
    closeEnough(
      plugin._test.sampleSplineCurve(
        [
          [0, 0, 0],
          [10, 0, 0],
          [10, 10, 0],
        ],
        "Linear",
        0.5,
        true,
        1
      ),
      [10, 5, 0]
    );
    closeEnough(
      plugin._test.sampleSplineCurve(
        [
          [1, 2, 3],
          [4, 5, 6],
        ],
        "Cubic",
        0.5,
        false,
        1
      ),
      [2.5, 3.5, 4.5]
    );
  } finally {
    plugin.deactivate();
  }
});

test("cubic spline sampling passes through its control points", () => {
  activateForMath();
  try {
    const points = [
      [-20, 0, 0],
      [0, 20, 0],
      [20, 0, 0],
    ];
    closeEnough(
      plugin._test.sampleSplineCurve(points, "Cubic", 0.5, false, 1),
      [0, 20, 0]
    );
    closeEnough(
      plugin._test.sampleSplineCurve(points, "Cubic", 1, false, 1),
      [20, 0, 0]
    );
    closeEnough(
      plugin._test.sampleSplineCurve(points, "Cubic", 0.25, false, 0),
      [-10, 10, 0]
    );
    closeEnough(
      plugin._test.sampleAkimaSpline(points, 0.5, false),
      [0, 20, 0]
    );
  } finally {
    plugin.deactivate();
  }
});

test("B-spline sampling clamps a four-point curve to its end points", () => {
  activateForMath();
  try {
    const points = [
      [0, 0, 0],
      [10, 0, 0],
      [10, 10, 0],
      [20, 10, 0],
    ];
    closeEnough(plugin._test.sampleBSplineSpline(points, 0, false), [0, 0, 0]);
    closeEnough(
      plugin._test.sampleBSplineSpline(points, 1, false),
      [19.99999997, 10, 0]
    );
  } finally {
    plugin.deactivate();
  }
});

test("thickness gradient maps single and blended color stops to scalars", () => {
  activateForMath();
  try {
    assert.equal(
      plugin._test.sampleThicknessGradient(
        [{ position: 0, color: "rgba(255,255,255,1)" }],
        0.5
      ),
      1
    );
    assert.equal(plugin._test.sampleThicknessGradient([], 0.3), 1);
    assert.equal(
      plugin._test.sampleThicknessGradient(
        [
          { position: 0, color: "rgba(0,0,0,1)" },
          { position: 1, color: "rgba(255,255,255,1)" },
        ],
        0.5
      ),
      0.5
    );
    assert.deepEqual(plugin._test.parseRgbaColor("rgba(10,20,30,0.5)"), {
      r: 10,
      g: 20,
      b: 30,
      a: 0.5,
    });
    assert.deepEqual(plugin._test.cross3([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
    closeEnough(plugin._test.normalize3([0, 3, 4], [9, 9, 9]), [0, 0.6, 0.8]);
  } finally {
    plugin.deactivate();
  }
});

test("straight spline tube has three rings of four vertices without caps", () => {
  const { THREE } = activateForMath();
  try {
    const geometry = plugin._test.createSplineTubeGeometry(
      [
        [0, 0, 0],
        [0, 10, 0],
        [0, 20, 0],
      ],
      [1, 1, 1],
      4,
      "None"
    );
    assert.ok(geometry instanceof THREE.Geometry);
    assert.equal(geometry.vertices.length, 12);
    assert.equal(geometry.faces.length, 16);
    const capped = plugin._test.createSplineTubeGeometry(
      [
        [0, 0, 0],
        [0, 10, 0],
        [0, 20, 0],
      ],
      [1, 1, 1],
      4,
      "Both",
      "Flat"
    );
    assert.equal(capped.vertices.length, 14);
    assert.equal(capped.faces.length, 24);
  } finally {
    plugin.deactivate();
  }
});

test("lathe and hollow cylinder builders emit fixed vertex and face counts", () => {
  activateForMath();
  try {
    const lathe = plugin._test.createLatheProfileGeometry(
      [
        { radius: 0, y: -1 },
        { radius: 1, y: 0 },
        { radius: 0, y: 1 },
      ],
      4
    );
    assert.equal(lathe.vertices.length, 7);
    assert.equal(lathe.faces.length, 8);
    const capped = plugin._test.createHollowCylinderGeometry(2, 1, 4, 3, true);
    assert.equal(capped.vertices.length, 16);
    assert.equal(capped.faces.length, 24);
    const open = plugin._test.createHollowCylinderGeometry(2, 1, 4, 3, false);
    assert.equal(open.vertices.length, 16);
    assert.equal(open.faces.length, 12);
  } finally {
    plugin.deactivate();
  }
});

test("helix builder sweeps a recorded tube along the helical path", () => {
  activateForMath();
  try {
    const geometry = plugin._test.createHelixGeometry(14, 32, 3, 2, 64, 8);
    assert.deepEqual(geometry.args, {
      tubularSegments: 64,
      radius: 2,
      radialSegments: 8,
      closed: false,
    });
    assert.equal(geometry.midpoint.x, -14);
    assert.equal(geometry.midpoint.y, 0);
    assert.ok(Math.abs(geometry.midpoint.z) < 1e-9);
  } finally {
    plugin.deactivate();
  }
});

test("geometry registers eight namespaced object classes in picker order", () => {
  const { registered } = activateForMath();
  try {
    assert.deepEqual(
      registered.map(({ type, name }) => ({ type, name })),
      [
        { type: "zoidium:geometry-plus/rounded-box", name: "Rounded Box" },
        { type: "zoidium:geometry-plus/polyhedron", name: "Polyhedron" },
        { type: "zoidium:geometry-plus/cone", name: "Cone" },
        { type: "zoidium:geometry-plus/capsule", name: "Capsule" },
        { type: "zoidium:geometry-plus/tube", name: "Tube" },
        { type: "zoidium:geometry-plus/gear", name: "Gear" },
        { type: "zoidium:geometry-plus/helix", name: "Helix" },
        { type: "zoidium:geometry-plus/spline", name: "Spline" },
      ]
    );
    for (const entry of registered) {
      assert.equal(entry.schemaVersion, 1);
      assert.equal(typeof entry.factory, "function");
    }
  } finally {
    plugin.deactivate();
  }
});
