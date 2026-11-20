"use strict";

// ExpressText+ Split into letters: pure placement plus the headless CM3
// create/undo/redo round-trip through the real editor history.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const cache =
  process.env.ZOIDIUM_RESOURCE_DIR || path.join(ROOT, ".zoidium-resources");
const mod = require("../plugins/expresstext-plus/expresstext.js");
const T = mod._test;

const FONT_DATA = {
  resolution: 1000,
  boundingBox: { yMin: 0, yMax: 1000 },
  underlineThickness: 0,
  glyphs: {
    A: { ha: 600, o: "m 0 0 l 500 0 l 500 700 l 0 700 l 0 0" },
    B: { ha: 800, o: "m 0 0 l 700 0 l 700 700 l 0 700 l 0 0" },
    C: { ha: 500, o: "m 0 0 l 500 0 l 500 500 l 0 500 l 0 0" },
    " ": { ha: 300 },
    "?": { ha: 400, o: "m 0 0 l 400 0 l 400 400 l 0 400 l 0 0" },
  },
};

test("split units match the layout for BMP text", () => {
  for (const text of ["AB", "AB\nC D", "A B", ""]) {
    assert.deepEqual(
      T.splitLetterUnits(text, FONT_DATA, 20, 0),
      T.getExpressLayout(text, FONT_DATA, 20, 0),
      JSON.stringify(text)
    );
  }
});

test("split units group surrogate pairs and skip nothing by themselves", () => {
  const layout = T.splitLetterUnits("A😀B", FONT_DATA, 20, 0);
  assert.equal(layout.count, 3, "pair is one unit");
  assert.equal(layout.units[1].character, "😀", "pair stays whole");
  assert.equal(layout.units[2].character, "B");
  // No "?" fallback for the pair here would still advance zero; the unit
  // exists exactly once either way.
  assert.ok(layout.units[1].advance >= 0);
  const spaced = T.splitLetterUnits("A B", FONT_DATA, 20, 0);
  assert.equal(spaced.count, 3, "space is a unit (it advances)");
  assert.equal(spaced.units[1].character, " ");
  assert.equal(spaced.units[2].x, spaced.units[1].x + 6, "B sits past the space advance");
});

test("split placements are full anchor minus single anchor", () => {
  const boxes = new Map([
    ["A", { min: [0, 0, 0], max: [10, 14, 2] }],
    ["B", { min: [0, 0, 0], max: [10, 14, 2] }],
  ]);
  const units = T.splitLetterUnits("AB", FONT_DATA, 20, 0).units;
  const placements = T.splitLetterPlacements(units, boxes, 0);
  assert.equal(placements.length, 2);
  assert.deepEqual(placements[0].position, [-6, 0, 0], "A holds the left half");
  assert.deepEqual(placements[1].position, [6, 0, 0], "B holds the right half");
  const left = T.splitLetterPlacements(units, boxes, 1);
  assert.deepEqual(left[0].position, [0, 0, 0], "positionMode 1 pins A at the cursor");
  assert.deepEqual(left[1].position, [12, 0, 0], "positionMode 1 steps B by the advance");
  const withSpace = T.splitLetterUnits("A B", FONT_DATA, 20, 0).units;
  const gapped = T.splitLetterPlacements(withSpace, boxes, 1);
  assert.equal(gapped.length, 2, "whitespace yields no object");
  assert.deepEqual(gapped[1].position, [18, 0, 0], "B advances past A plus the space");
});

test("split placements keep each line where it was", () => {
  const boxes = new Map([
    ["A", { min: [0, 0, 0], max: [10, 14, 2] }],
    ["B", { min: [0, 0, 0], max: [10, 14, 2] }],
  ]);
  const units = T.splitLetterUnits("AB\nB", FONT_DATA, 20, 0).units;
  assert.equal(units.length, 3, "newlines produce no units of their own");
  assert.equal(units[2].y, -20, "second line drops one line height at size 20");
  const placements = T.splitLetterPlacements(units, boxes, 0);
  assert.equal(placements.length, 3);
  assert.equal(
    placements[2].position[1] - placements[0].position[1],
    -20,
    "line pitch preserved across the centered block"
  );
});

function splitFixture() {
  // Mirrors test/expressions-plus-harness.js nativeHost: window stays a
  // plain object (never the context itself), so the ui script's top-level
  // const declarations load cleanly. Adds the plugin-apis scripts the
  // ExpressText+ host fixture provides.
  const context = vm.createContext({
    PZ: {},
    ISNODE: true,
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    performance,
    TextEncoder,
    TextDecoder,
    URL,
  });
  vm.runInContext(fs.readFileSync(path.join(cache, "three.r91.min.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(cache, "core-1.0.102.js"), "utf8"), context);
  const document = {
    body: { appendChild() {} },
    createElement() {
      const realm = vm.createContext({});
      return {
        setAttribute() {},
        remove() {},
        contentWindow: { Function: vm.runInContext("Function", realm) },
      };
    },
  };
  Object.assign(context, {
    Image: class {},
    CSS: { supports: () => true },
    window: { PZ: context.PZ, addEventListener() {} },
    navigator: {},
    document,
  });
  vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context);
  for (const file of ["random", "props", "color", "gl", "json", "windows"]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, "zoidium/shared", file + ".js"), "utf8"),
      context
    );
  }
  vm.runInContext(
    fs.readFileSync(path.join(ROOT, "zoidium/plugin-apis.js"), "utf8"),
    context
  );
  const { PZ, THREE } = context;
  PZ.material.fnList.singlecolor = Promise.resolve(function () {
    this.load = function () {
      this.threeObj = new THREE.MeshBasicMaterial();
    };
    this.update = function () {};
    this.prepare = async function () {};
    this.unload = function () {
      this.threeObj.dispose();
    };
  });
  const project = new PZ.project();
  project.threeObj = new THREE.Object3D();
  project.objects = new PZ.objectList(project, PZ.object3d);
  project.children.push(project.objects);
  const editor = { playback: { currentFrame: 0 }, sequence: project.sequence };
  PZ.observable.defineObservableProp(editor, "project", "onProjectChanged");
  editor.history = new PZ.ui.history(editor);
  editor.project = project;
  const edit = Object.create(PZ.ui.edit.prototype);
  edit.editor = editor;
  mod.activate({ PZ, window: { THREE }, object3d: { registerClass: () => () => {} } });
  const font = new THREE.Font(FONT_DATA);
  // Unload-safe stand-in for the project font asset: assetList.unload only
  // touches the refcount and drops unused keys.
  const fontAsset = { key: "split-fixture-font", references: 99, mediaReferences: 0 };
  function text(value, parent) {
    const object = new PZ.object3d.text();
    (parent || project.objects).push(object);
    object.load({ properties: { font: "", text: value } });
    object.font = { font3d: font, loading3d: Promise.resolve(), asset: fontAsset };
    object.fontNeedsUpdate = false;
    object.geometryNeedsUpdate = true;
    return object;
  }
  function close() {
    mod.deactivate();
  }
  return { PZ, THREE, project, editor, edit, text, close };
}

test("split creates one undoable operation with independently owned materials", () => {
  const h = splitFixture();
  try {
    const original = h.text("AB");
    // Real texts always carry their numeric type (set by PZ.object3d.create
    // or project load); stamp it so the before snapshot matches exactly.
    original.type = 1;
    const originalMaterial = original.material;
    const originalFont = original.font;
    const beforeSplit = JSON.parse(JSON.stringify(h.project.objects));
    const { group, letters } = T.runSplitTextIntoLetters(original, {
      PZ: h.PZ,
      edit: h.edit,
      frame: 0,
    });
    assert.equal(letters.length, 2, "one text per character");
    assert.equal(group.properties.name.get(0), "Text letters", "group named after the text");
    assert.equal(h.project.objects.indexOf(group), 0, "group sits at the original index");
    assert.equal(h.project.objects.length, 1, "original replaced by the group");
    assert.deepEqual(
      letters.map((letter) => letter.properties.text.get(0)),
      ["A", "B"]
    );
    for (const letter of letters) {
      assert.equal(letter.font, originalFont, "font shared, not cloned");
      assert.notEqual(letter.material, originalMaterial, "each letter owns its material");
      assert.equal(letter.material.parent, letter.materials, "material belongs to its letter");
      assert.equal(letter.parent, group.objects, "letters parented under the group");
    }
    assert.notEqual(letters[0].material, letters[1].material, "letters do not reparent the same material");
    const undone = h.editor.history.undo();
    assert.notEqual(undone, false, "undo applies");
    assert.deepEqual(
      JSON.parse(JSON.stringify(h.project.objects)),
      beforeSplit,
      "one undo restores the original object data exactly"
    );
    const restored = h.project.objects[0];
    assert.equal(restored.properties.text.get(0), "AB", "original text back");
    assert.equal(h.project.objects.indexOf(restored), 0, "original index back");
    h.editor.history.redo();
    assert.equal(h.project.objects.length, 1, "redo restores the split");
    assert.equal(h.project.objects[0].properties.name.get(0), "Text letters");
    assert.equal(h.project.objects[0].objects.length, 2, "redo restores both letters");
    assert.equal(h.project.objects[0].objects[0].properties.text.get(0), "A");
  } finally {
    h.close();
  }
});

test("split letters land where the native text rendered", () => {
  const h = splitFixture();
  try {
    const original = h.text("AB");
    original.update(0);
    const nativeBox = original.threeObj.geometry.boundingBox;
    const nativeMin = [nativeBox.min.x, nativeBox.min.y, nativeBox.min.z];
    const nativeMax = [nativeBox.max.x, nativeBox.max.y, nativeBox.max.z];
    const { letters } = T.runSplitTextIntoLetters(original, {
      PZ: h.PZ,
      edit: h.edit,
      frame: 0,
    });
    assert.equal(letters.length, 2);
    // Each letter renders exactly where its glyph sat in the native text:
    // letter offset plus own centered box equals the native glyph slot.
    const closeTo = (got, want, label) => {
      for (let axis = 0; axis < 3; axis += 1) {
        assert.ok(
          Math.abs(got[axis] - want[axis]) < 1e-6,
          `${label} axis ${axis}: ${got} vs ${want}`
        );
      }
    };
    const first = letters[0];
    first.fontNeedsUpdate = false;
    first.update(0);
    const firstBox = first.threeObj.geometry.boundingBox;
    const firstSize = [
      firstBox.max.x - firstBox.min.x,
      firstBox.max.y - firstBox.min.y,
      firstBox.max.z - firstBox.min.z,
    ];
    const firstAt = first.properties.position.get(0);
    closeTo(
      [firstAt[0], firstAt[1], firstAt[2]],
      [
        nativeMin[0] + firstSize[0] / 2 - (firstBox.min.x + firstBox.max.x) / 2,
        nativeMin[1] + firstSize[1] / 2 - (firstBox.min.y + firstBox.max.y) / 2,
        nativeMin[2] + firstSize[2] / 2 - (firstBox.min.z + firstBox.max.z) / 2,
      ],
      "first letter tiles the native box from its minimum"
    );
    const second = letters[1];
    second.fontNeedsUpdate = false;
    second.update(0);
    const secondBox = second.threeObj.geometry.boundingBox;
    const secondSize = [
      secondBox.max.x - secondBox.min.x,
      secondBox.max.y - secondBox.min.y,
      secondBox.max.z - secondBox.min.z,
    ];
    const secondAt = second.properties.position.get(0);
    closeTo(
      [secondAt[0], secondAt[1], secondAt[2]],
      [
        nativeMax[0] - secondSize[0] / 2 - (secondBox.min.x + secondBox.max.x) / 2,
        nativeMax[1] - secondSize[1] / 2 - (secondBox.min.y + secondBox.max.y) / 2,
        nativeMax[2] - secondSize[2] / 2 - (secondBox.min.z + secondBox.max.z) / 2,
      ],
      "second letter tiles the native box up to its maximum"
    );
  } finally {
    h.close();
  }
});

test("split carries keyframes and expressions onto the group", () => {
  const h = splitFixture();
  try {
    const original = h.text("AB");
    original.properties.position.set([5, 6, 7], 3);
    original.properties.rotation.expression = new h.PZ.expression("[frame, 0, 0]");
    assert.deepEqual(Array.from(original.properties.position.get(3)), [5, 6, 7]);
    const { group, letters } = T.runSplitTextIntoLetters(original, {
      PZ: h.PZ,
      edit: h.edit,
      frame: 0,
    });
    assert.deepEqual(
      Array.from(group.properties.position.get(3)),
      [5, 6, 7],
      "position keyframes moved to the group"
    );
    assert.deepEqual(
      Array.from(group.properties.rotation.get(4)),
      [4, 0, 0],
      "rotation expression moved to the group"
    );
    for (const letter of letters) {
      assert.equal(letter.properties.position.hasKeyframe(9), false, "letters hold static offsets");
      assert.deepEqual(
        Array.from(letter.properties.position.get(9)),
        Array.from(letter.properties.position.get(0)),
        "letter offset is static"
      );
      assert.equal(letter.properties.rotation.expression, null, "no expression leaks to letters");
    }
  } finally {
    h.close();
  }
});

test("split keeps lines, skips whitespace and groups surrogate pairs", () => {
  const h = splitFixture();
  try {
    const original = h.text("A B\nC");
    const { group, letters } = T.runSplitTextIntoLetters(original, {
      PZ: h.PZ,
      edit: h.edit,
      frame: 0,
    });
    assert.deepEqual(
      letters.map((letter) => letter.properties.text.get(0)),
      ["A", "B", "C"],
      "space yields no object but still advances"
    );
    const ax = letters[0].properties.position.get(0)[0];
    const bx = letters[1].properties.position.get(0)[0];
    assert.ok(bx - ax > 12, `B advances past A plus the space: ${bx - ax}`);
    const cy = letters[2].properties.position.get(0)[1];
    assert.ok(cy < -10, `C sits on the second line: ${cy}`);
    assert.equal(group.objects.length, 3);
  } finally {
    h.close();
  }
});

test("split validates before touching history", () => {
  const h = splitFixture();
  try {
    const group = new h.PZ.object3d.group();
    assert.throws(
      () => T.runSplitTextIntoLetters(group, { PZ: h.PZ, edit: h.edit, frame: 0 }),
      /3D Text/,
      "groups are refused"
    );
    const blank = h.text("   ");
    assert.throws(
      () => T.runSplitTextIntoLetters(blank, { PZ: h.PZ, edit: h.edit, frame: 0 }),
      /no letters/,
      "whitespace-only text is refused"
    );
    const noFont = h.text("AB");
    noFont.font = null;
    assert.throws(
      () => T.runSplitTextIntoLetters(noFont, { PZ: h.PZ, edit: h.edit, frame: 0 }),
      /font/,
      "missing font is refused"
    );
    assert.equal(h.project.objects.length, 2, "failed splits create nothing");
  } finally {
    h.close();
  }
});

test("split letters stay tracked under an ExpressText+ container", () => {
  const h = splitFixture();
  try {
    const definitions = T.getExpressDefinitions();
    const Container = T.createExpressObjectClass(h.PZ, definitions[0]);
    const container = new Container();
    h.project.objects.push(container);
    container.load({ objects: [], properties: {}, expressProperties: {} });
    const original = h.text("AB", container.objects);
    const { group, letters } = T.runSplitTextIntoLetters(original, {
      PZ: h.PZ,
      edit: h.edit,
      frame: 0,
    });
    assert.equal(group.parent, container.objects, "group takes the original slot");
    assert.deepEqual(
      T.containerTexts(container).map((text) => text.properties.text.get(0)),
      ["A", "B"],
      "the container still tracks the letters through the group"
    );
    assert.equal(letters.length, 2);
  } finally {
    h.close();
  }
});

test("split button offers on 3D Text and notifies on error", () => {
  const h = splitFixture();
  try {
    const proto = h.PZ.ui.edit.prototype;
    const real = proto.generateItemCommands;
    proto.generateItemCommands = function () {
      return { children: [null, { prepend(button) { this.seen = button; } }] };
    };
    const notices = [];
    const seen = [];
    const dispose = T.installSplitCommand({
      PZ: h.PZ,
      notify: (notice) => notices.push(notice),
    });
    try {
      assert.equal(T.shouldOfferSplit(h.PZ, h.text("AB")), true, "text offered");
      assert.equal(
        T.shouldOfferSplit(h.PZ, new h.PZ.object3d.group()),
        false,
        "groups refused"
      );
      const row = { children: [null, { prepend: (button) => seen.push(button) }] };
      const target = h.text("CD");
      const fakeThis = Object.create(h.PZ.ui.edit.prototype);
      fakeThis.options = {};
      fakeThis.editor = h.editor;
      fakeThis.generateButton = (kind) => ({
        kind,
        title: "",
        setAttribute() {},
        onclick: null,
      });
      proto.generateItemCommands.call(fakeThis, row, target);
      assert.equal(seen.length, 1, "one button added");
      assert.equal(seen[0].title, "Split into letters", "brief-mandated label");
      seen[0].onclick({ stopPropagation() {} });
      assert.equal(target.parent, null, "button click splits the text");
      const failing = { children: [null, { prepend: (button) => seen.push(button) }] };
      const blank = h.text("   ");
      proto.generateItemCommands.call(fakeThis, failing, blank);
      seen[seen.length - 1].onclick({ stopPropagation() {} });
      assert.equal(notices.length, 1, "error notifies instead of throwing");
      assert.equal(notices[0].title, "ExpressText+");
      assert.match(notices[0].message, /no letters/);
    } finally {
      dispose();
      proto.generateItemCommands = real;
    }
  } finally {
    h.close();
  }
});
