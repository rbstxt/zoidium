"use strict";

// ExpressText+ tests: render-a. Required by test/expresstext-plus.test.js; not discovered directly.

const assert = require("node:assert/strict");
const test = require("node:test");
const { T, fakeSection, fakeThree, mod, recordingThree, recordingParent } = require("./expresstext-plus-helpers.js");

test("center offsets follow the native anchor modes", () => {
  const bounds = { min: [0, 0, 0], max: [20, 10, 2] };
  assert.deepEqual(T.getExpressCenterOffset(bounds, 0), [-10, -5, -1], "centered");
  assert.deepEqual(T.getExpressCenterOffset(bounds, 1)[0], 0, "mode 1 keeps X");
  assert.deepEqual(T.getExpressCenterOffset(bounds, 2)[0], -20, "mode 2 doubles X");
  assert.deepEqual(T.getExpressCenterOffset(bounds, 4)[1], 0, "mode 4 keeps Y");
  assert.deepEqual(T.getExpressCenterOffset(null, 0), [0, 0, 0], "no bounds");
  assert.deepEqual(T.getExpressTextCenter(bounds, [-10, -5, -1]), [0, 0, 0]);
});


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
    parent: recordingParent(added),
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
    parent: recordingParent(added),
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
    parent: recordingParent(added),
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
    parent: recordingParent(),
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
    parent: recordingParent(added),
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

