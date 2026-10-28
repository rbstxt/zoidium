"use strict";

// ExpressText+ tests: render-b. Required by test/expresstext-plus.test.js; not discovered directly.

const assert = require("node:assert/strict");
const test = require("node:test");
const { T, fakeRow, fakeSection, mod, props, recordingThree, recordingParent } = require("./expresstext-plus-helpers.js");

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
    parent: recordingParent(added),
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
    parent: recordingParent(added),
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
    parent: recordingParent(),
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

test("grouped texts render in parent coordinates with shared numbering", () => {
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
    parent: recordingParent(),
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
    assert.equal(s1.renderRoot.position.x, 5, "root keeps the first Text local offset");
    assert.equal(s2.renderRoot.position.x, -5, "root keeps the second Text local offset");
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
