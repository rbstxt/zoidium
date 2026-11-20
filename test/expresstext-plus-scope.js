"use strict";

// ExpressText+ tests: scope. Required by test/expresstext-plus.test.js; not discovered directly.
//
// Per-text letter sets: every text under a container evaluates as if alone
// under a copy of the container, while Across texts keeps the historical
// connected run.

const assert = require("node:assert/strict");
const test = require("node:test");
const { T, fakeSection, mod, recordingThree, recordingParent } = require("./expresstext-plus-helpers.js");

const GLYPHS = {
  A: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
  B: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
  C: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
  D: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500" },
};
const FONT = { resolution: 1000, boundingBox: { yMax: 1000, yMin: 0 }, glyphs: GLYPHS };

function mkText(str, parent) {
  return {
    font: { font3d: { data: FONT } },
    properties: {
      text: { get: () => str },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      position: { get: () => [0, 0, 0] },
      rotation: { get: () => [0, 0, 0] },
      scale: { get: () => [1, 1, 1] },
    },
    parentObject: parent || null,
  };
}

const ENTRIES_AB = [
  { index: 0, base: [0, 0, 0] },
  { index: 1, base: [10, 0, 0] },
];

test("lettersScopeOf defaults to across texts without the row", () => {
  assert.equal(T.lettersScopeOf(null, 0), 1, "null-safe");
  assert.equal(T.lettersScopeOf({}, 0), 1, "missing settings stay historical");
  const across = { expressProperties: T.staticProps({ rotationOrder: "XYZ" }) };
  assert.equal(T.lettersScopeOf(across, 0), 1, "old containers stay across texts");
  const perText = { expressProperties: T.staticProps({ rotationOrder: "XYZ", lettersMode: 0 }) };
  assert.equal(T.lettersScopeOf(perText, 0), 0, "explicit per text");
  const explicit = { expressProperties: T.staticProps({ rotationOrder: "XYZ", lettersMode: 1 }) };
  assert.equal(T.lettersScopeOf(explicit, 0), 1, "explicit across texts");
});

test("letterRunFor narrows the run to each text in per-text scope", () => {
  const tAB = mkText("AB");
  const tCD = mkText("CD");
  const container = { objects: [tAB, tCD] };
  // Across texts (no row): continuous numbering, as before.
  const runAB = T.letterRunFor(container, tAB, ENTRIES_AB, 0);
  assert.equal(runAB.total, 4, "total spans texts");
  assert.deepEqual(runAB.order, [0, 1, 2, 3], "identity order");
  assert.equal(runAB.selfStart, 0, "first text starts at zero");
  const runCD = T.letterRunFor(container, tCD, ENTRIES_AB, 0);
  assert.equal(runCD.selfStart, 2, "second text starts at two");
  // Per text: each text is its own whole run.
  container.expressProperties = T.staticProps({ rotationOrder: "XYZ", lettersMode: 0 });
  const localAB = T.letterRunFor(container, tAB, ENTRIES_AB, 0);
  assert.equal(localAB.total, 2, "first text counts itself");
  assert.deepEqual(localAB.order, [0, 1], "local order");
  assert.equal(localAB.selfStart, 0, "local start at zero");
  assert.deepEqual(localAB.bases, [[0, 0, 0], [10, 0, 0]], "own bases only");
  const localCD = T.letterRunFor(container, tCD, ENTRIES_AB, 0);
  assert.equal(localCD.total, 2, "second text counts itself");
  assert.equal(localCD.selfStart, 0, "second text starts at zero too");
  assert.deepEqual(localCD.bases, [[0, 0, 0], [10, 0, 0]], "same layout, own run");
});

test("per-text selections, id and count resolve inside each text", () => {
  const tAB = mkText("AB");
  const tCD = mkText("CD");
  const container = {
    objects: [tAB, tCD],
    expressProperties: T.staticProps({ rotationOrder: "XYZ", lettersMode: 0 }),
  };
  const containerProps = T.staticProps({ rotationOrder: "XYZ" });
  const plain = {
    kind: "plain",
    props: T.staticProps({
      plainEnable: 1,
      plainLetters: "2",
      plainStrength: 100,
      plainPosition: [7, 0, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
  };
  const runCD = T.letterRunFor(container, tCD, ENTRIES_AB, 0);
  const list = { order: runCD.order, total: runCD.total };
  // Letters "2" moves the second letter of EACH text, not the run's.
  const moved = T.evaluateStack([plain], containerProps, 0, 1, list, [10, 0, 0]);
  assert.deepEqual(moved.position, [7, 0, 0], "second letter of the second text moves");
  const held = T.evaluateStack([plain], containerProps, 0, 0, list, [0, 0, 0]);
  assert.deepEqual(held.position, [0, 0, 0], "first letter holds");
  // Formula id/u/count are local: first letter reads id 0, count 2.
  const wave = {
    kind: "formula",
    props: T.staticProps({
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
  assert.equal(
    T.evaluateStack([wave], containerProps, 0, 0, list, [0, 0, 0]).position[0],
    0,
    "id restarts per text"
  );
  assert.equal(
    T.evaluateStack([wave], containerProps, 0, 1, list, [10, 0, 0]).position[0],
    1,
    "second letter reads id 1"
  );
});

test("voronoi selections resolve per text like the alone run", () => {
  // Voronoi shatter has no observable geometry in this harness (chunk
  // meshes need real triangle data), so pin the scope-sensitive input:
  // letter selection against the run. "1" picks the first letter of each
  // text per text, but only the run's first letter across texts.
  const tAB = mkText("AB");
  const tCD = mkText("CD");
  const container = {
    objects: [tAB, tCD],
    expressProperties: T.staticProps({ rotationOrder: "XYZ", lettersMode: 0 }),
  };
  const voronoi = T.staticProps({
    voronoiEnable: 1,
    voronoiLetters: "1",
    voronoiStrength: 100,
    voronoiDelay: 0,
    voronoiDelayOrder: 0,
    voronoiSeed: 1,
    voronoiField: 0,
  });
  const runCD = T.letterRunFor(container, tCD, ENTRIES_AB, 0);
  assert.equal(runCD.total, 2, "second text counts itself per text");
  const list = { order: runCD.order, total: runCD.total };
  const ctx = T.letterContext(voronoi, "voronoi", 0, 0, list, []);
  assert.ok(T.isLetterSelected(ctx.selected, 0), "first letter of the second text selected per text");
  const acrossContainer = { objects: [tAB, tCD] };
  const acrossRun = T.letterRunFor(acrossContainer, tCD, ENTRIES_AB, 0);
  const acrossList = { order: acrossRun.order, total: acrossRun.total };
  const acrossCtx = T.letterContext(voronoi, "voronoi", 0, acrossRun.selfStart, acrossList, []);
  assert.ok(
    !T.isLetterSelected(acrossCtx.selected, acrossRun.selfStart),
    "across numbering leaves the same letter unselected"
  );
});

function sections() {
  return [
    fakeSection("Plain", {
      plainEnable: 1,
      plainLetters: "2",
      plainStrength: 100,
      plainPosition: [10, 0, 0],
      plainRotation: [0, 0, 1],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
    fakeSection("Plain", {
      plainEnable: 1,
      plainLetters: "1",
      plainStrength: 100,
      plainPosition: [0, 0, 0],
      plainRotation: [0, 0, 20],
      plainScale: [1, 1, 1],
      plainPivot: 1,
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
    fakeSection("Plain", {
      plainEnable: 1,
      plainLetters: "plain-1",
      plainStrength: 100,
      plainPosition: [0, 4, 0],
      plainRotation: [0, 0, 0],
      plainScale: [1, 1, 1],
      plainDelay: 0,
      plainDelayOrder: 0,
      plainField: 0,
    }),
    fakeSection("Random", {
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
      randomPositionMin: [-5, -5, -5],
      randomPositionMax: [5, 5, 5],
      randomRotationMin: [0, 0, 0],
      randomRotationMax: [0, 0, 0],
      randomScaleMin: [1, 1, 1],
      randomScaleMax: [1, 1, 1],
      randomDelay: 0,
      randomDelayOrder: 0,
      randomField: 0,
    }),
    fakeSection("Random", {
      randomEnable: 1,
      randomLetters: "",
      randomStrength: 100,
      randomMode: 4,
      randomMinimum: 0,
      randomMaximum: 100,
      randomSynchronized: 0,
      randomIndexed: 1,
      randomSeed: 11,
      randomSpace: 0,
      randomAnimationSpeed: 0,
      randomNoiseScale: 100,
      randomPositionMin: [-3, -3, -3],
      randomPositionMax: [3, 3, 3],
      randomRotationMin: [0, 0, 0],
      randomRotationMax: [0, 0, 0],
      randomScaleMin: [1, 1, 1],
      randomScaleMax: [1, 1, 1],
      randomDelay: 0,
      randomDelayOrder: 0,
      randomField: 0,
    }),
    fakeSection("Formula", {
      formulaEnable: 1,
      formulaLetters: "",
      formulaStrength: 100,
      formulaMinimum: 0,
      formulaMaximum: 100,
      formulaExpression: "id*10+count",
      formulaTime: 1,
      formulaFrequency: 1,
      formulaPosition: [1, 0, 0],
      formulaRotation: [0, 0, 0],
      formulaScale: [1, 1, 1],
      formulaDelay: 0,
      formulaDelayOrder: 0,
      formulaField: 0,
    }),
    fakeSection("Repeater", {
      repeaterEnable: 1,
      repeaterLetters: "",
      repeaterStrength: 100,
      repeaterMode: 1,
      repeaterCopies: 2,
      repeaterOffset: [10, 0, 0],
      repeaterRangeMin: [-4, -4, 0],
      repeaterRangeMax: [4, 4, 0],
      repeaterSeed: 3,
      repeaterLag: 2,
      repeaterFade: 50,
      repeaterDelay: 0,
      repeaterDelayOrder: 0,
      repeaterField: 0,
    }),
    fakeSection("Delay", {
      delayEnable: 1,
      delayLetters: "",
      delayStrength: 100,
      delayMode: 1,
      delayPosition: 1,
      delayScale: 1,
      delayRotation: 1,
      delayField: 0,
    }),
  ];
}

function mkRenderText(str, parent) {
  return {
    threeObj: {
      material: "mat",
      geometry: { parameters: { options: { depth: 4 } } },
      parent: recordingParent(),
    },
    font: { font3d: { data: FONT } },
    properties: {
      text: { get: () => str },
      size: { get: () => [20, 3] },
      spacing: { get: () => 0 },
      positionMode: { get: () => 0 },
      position: { get: () => [0, 0, 0] },
      rotation: { get: () => [0, 0, 0] },
      scale: { get: () => [1, 1, 1] },
    },
    parentObject: parent,
  };
}

function mkRenderContainer(lettersMode) {
  const values = { rotationOrder: "XYZ" };
  if (lettersMode !== undefined) values.lettersMode = lettersMode;
  return {
    zoidiumExpressTextObject: true,
    expressProperties: T.staticProps(values),
    customProperties: sections(),
  };
}

function activateRecording() {
  const THREE = recordingThree();
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
  return THREE;
}

function posesOf(textObject, frames) {
  const out = [];
  const layers = T.collectExpressObjects(textObject);
  const splitState = T.getSplitState(textObject);
  for (const frame of frames) {
    T.updateExpressRendering(textObject, splitState, layers, frame);
    out.push(
      splitState.entries.map((entry) => {
        const anchor = entry.anchor;
        return {
          p: [anchor.position.x, anchor.position.y, anchor.position.z],
          r: anchor.rotation.args.slice(),
          s: anchor.scale.args.slice(),
          v: entry.mesh ? !!entry.mesh.visible : null,
          copies: (entry.copies || []).map((copy) => ({
            p: [copy.node.position.x, copy.node.position.y, copy.node.position.z],
            v: !!copy.node.visible,
          })),
        };
      })
    );
  }
  return out;
}

test("per-text renders exactly like each text alone in its own container", () => {
  // Pins every scope-sensitive path at once: the shared stack carries
  // Plain selections, a Text-pivot rotation, a kind-N token selection,
  // indexed and Sorted Random draws, a Formula over id/count, a Random
  // Repeater (letter-indexed copy offsets) and a Delay trail.
  activateRecording();
  try {
    const frames = [0, 5];
    // Shared container, per text: two texts under one stack.
    const shared = mkRenderContainer(0);
    const first = mkRenderText("AB", shared);
    const second = mkRenderText("CD", shared);
    shared.objects = [first, second];
    // Alone: each text under its own copy of the container.
    const aloneFirstContainer = mkRenderContainer(0);
    const aloneFirst = mkRenderText("AB", aloneFirstContainer);
    aloneFirstContainer.objects = [aloneFirst];
    const aloneSecondContainer = mkRenderContainer(0);
    const aloneSecond = mkRenderText("CD", aloneSecondContainer);
    aloneSecondContainer.objects = [aloneSecond];
    assert.deepEqual(
      posesOf(first, frames),
      posesOf(aloneFirst, frames),
      "first text matches its alone copy"
    );
    assert.deepEqual(
      posesOf(second, frames),
      posesOf(aloneSecond, frames),
      "second text matches its alone copy"
    );
    // Control: across texts does NOT match the alone copies.
    const across = mkRenderContainer(1);
    const acrossFirst = mkRenderText("AB", across);
    const acrossSecond = mkRenderText("CD", across);
    across.objects = [acrossFirst, acrossSecond];
    assert.notDeepEqual(
      posesOf(acrossSecond, frames),
      posesOf(aloneSecond, frames),
      "across texts differ from alone"
    );
  } finally {
    mod.deactivate();
  }
});

test("per-text run survives group wrappers with local numbering", () => {
  const tAB = mkText("AB");
  const tCD = mkText("CD");
  const group = (kids) => ({ objects: kids });
  const container = {
    objects: [group([tAB]), group([group([tCD])])],
    expressProperties: T.staticProps({ rotationOrder: "XYZ", lettersMode: 0 }),
  };
  assert.deepEqual(T.containerTexts(container), [tAB, tCD], "texts found through groups");
  const run = T.letterRunFor(container, tCD, ENTRIES_AB, 0);
  assert.equal(run.total, 2, "nested text counts itself");
  assert.equal(run.selfStart, 0, "nested text starts at zero");
  assert.deepEqual(run.order, [0, 1], "nested text owns its order");
});
