"use strict";

// Plain-text ancestor walks stay free: with no live Text+ or ExpressText+
// object, a 3D Text update must not read parentObject at all; with ancestors
// present the collectors must return exactly today's layers.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const textPlusPlugin = require("../plugins/text-plus/text-plus.js");
const textPlusUtils = require("../plugins/text-plus/text-plus-utils.js");
const textPlusGeometry = require("../plugins/text-plus/text-plus-geometry.js");
const expressPlugin = require("../plugins/expresstext-plus/expresstext.js");
const expressConstants = require("../plugins/expresstext-plus/expresstext-constants.js");

const T = expressPlugin._test;
const textPlusCount = () => textPlusUtils.state.liveTextPlusCount;
const expressCount = () => expressConstants.state.liveExpressCount;

/* ------------------------------------------------------- fake CM3 host */

class Object3d {}
class FakePropertyList {
  constructor(definitions, owner) {
    this.definitions = definitions;
    this.owner = owner;
  }
  load() {}
}
class FakeList {
  constructor(owner, itemClass) {
    this.owner = owner;
    this.itemClass = itemClass;
    this.length = 0;
  }
  push(child) {
    this[this.length] = child;
    this.length += 1;
    return this.length;
  }
}
class Group extends Object3d {
  constructor() {
    super();
    this.objects = { name: "" };
    this.customProperties = [];
    this.properties = new FakePropertyList({}, this);
    this.children = [this.properties, this.customProperties, this.objects];
  }
  load(data) {
    this.loadedData = data;
  }
  unload() {
    this.unloaded = true;
  }
  toJSON() {
    return { properties: {}, objects: [] };
  }
}
const updateCalls = [];
const geometryCalls = [];
class TextObject extends Object3d {
  update() {
    updateCalls.push(this);
    // The native update rebuilds geometry inline, like the CM3 pipeline.
    this.updateGeometry();
  }
  updateGeometry() {
    geometryCalls.push(this);
  }
  unload() {}
}
TextObject.propertyDefinitions = { detail: { value: 1 } };
TextObject.changeFn = function changeText() {};
Object3d.eulerOrders = "XYZ;XZY;YXZ;YZX;ZXY;ZYX";
Object3d.group = Group;
Object3d.text = TextObject;

const PZ = {
  object3d: Object3d,
  property: {
    type: { NUMBER: 0, VECTOR2: 1, VECTOR3: 2, OPTION: 6, LIST: 9, TEXT: 10 },
    dynamic: class FakeDynamic {},
  },
  propertyList: FakePropertyList,
  objectList: FakeList,
  ui: { objectTypes: new Map() },
};

const factories = [];
const context = {
  PZ,
  editor: null,
  window: { THREE: { TextGeometry: class TextGeometry {} } },
  object3d: {
    registerClass(definition) {
      factories.push(definition);
      return () => {};
    },
  },
};

textPlusPlugin.activate(context);
expressPlugin.activate(context);
after(() => {
  expressPlugin.deactivate();
  textPlusPlugin.deactivate();
});

function textPlusFactory(type) {
  const found = factories.find((entry) => entry.type === type);
  assert.ok(found, `registered ${type}`);
  return found.factory;
}

// A parentObject link whose reads can be counted. Plain data links (real
// parent instances) carry no counter; every getter link does.
function link(child, parent, counter) {
  Object.defineProperty(child, "parentObject", {
    configurable: true,
    get() {
      counter.reads += 1;
      return parent;
    },
  });
  return counter;
}
const counter = () => ({ reads: 0 });

function mockText() {
  updateCalls.length = 0;
  geometryCalls.length = 0;
  return new TextObject();
}

/* ------------------------------------------------------------- fast path */

test("plain text update reads no parentObject with nothing alive", () => {
  assert.equal(textPlusCount(), 0);
  assert.equal(expressCount(), 0);
  const sceneReads = counter();
  const groupReads = counter();
  const textReads = counter();
  const scene = {};
  link(scene, null, sceneReads);
  const group = new Group();
  link(group, scene, groupReads);
  const text = mockText();
  link(text, group, textReads);

  text.update(0);

  assert.ok(updateCalls.includes(text), "native update ran");
  assert.ok(geometryCalls.includes(text), "native geometry rebuild ran");
  assert.equal(textReads.reads, 0, "no collector walked from the text");
  assert.equal(groupReads.reads, 0, "no walk reached the group");
  assert.equal(sceneReads.reads, 0, "no walk reached the scene");
});

test("restore paths read nothing without split state", () => {
  const reads = counter();
  const text = mockText();
  link(text, new Group(), reads);
  textPlusGeometry.restoreTextRendering(text);
  T.restoreExpressRendering(text);
  assert.equal(reads.reads, 0, "restores only consult their split maps");
});

/* ------------------------------------------------------------ collectors */

test("nested Text+ ancestors collect outermost first and stop at the scene", () => {
  const outer = textPlusFactory("zoidium:text-plus/text-plus")();
  const inner = textPlusFactory("zoidium:text-plus/character-shake")();
  assert.equal(textPlusCount(), 2);
  try {
    const evilReads = counter();
    const evil = {};
    Object.defineProperty(evil, "parentObject", {
      configurable: true,
      get() {
        evilReads.reads += 1;
        return null;
      },
    });
    const scene = {};
    link(scene, evil, counter());
    const tail = counter();
    const head = counter();
    const middle = counter();
    const g2 = new Group();
    link(g2, outer, middle);
    outer.parentObject = scene;
    const g1 = new Group();
    link(g1, inner, head);
    inner.parentObject = g2;
    const text = mockText();
    link(text, g1, tail);

    const layers = textPlusUtils.collectTextPlusObjects(text);
    assert.deepEqual(layers, [outer, inner], "outermost first, as before");
    assert.equal(evilReads.reads, 0, "nothing above the scene layer is visited");

    // With the host API unavailable the same walk runs to the end.
    const savedPZ = textPlusUtils.state.PZ;
    textPlusUtils.state.PZ = null;
    try {
      const again = textPlusUtils.collectTextPlusObjects(text);
      assert.deepEqual(again, [outer, inner], "same layers without the scope check");
      assert.ok(evilReads.reads > 0, "the full walk reaches past the scene");
    } finally {
      textPlusUtils.state.PZ = savedPZ;
    }
  } finally {
    inner.unload();
    outer.unload();
  }
  assert.equal(textPlusCount(), 0);
});

test("ExpressText+ inside Text+ still yields no express layers", () => {
  const plus = textPlusFactory("zoidium:text-plus/text-plus")();
  const box = T.createExpressObjectClass(PZ, T.getExpressDefinitions()[0]);
  const boxInstance = new box();
  assert.equal(textPlusCount(), 1);
  assert.equal(expressCount(), 1);
  try {
    const text = mockText();
    const group = new Group();
    link(group, boxInstance, counter());
    boxInstance.parentObject = plus;
    plus.parentObject = null;
    link(text, group, counter());
    assert.deepEqual(T.collectExpressObjects(text), [], "defers to Text+");
    assert.deepEqual(textPlusUtils.collectTextPlusObjects(text), [plus]);
  } finally {
    boxInstance.unload();
    plus.unload();
  }
  assert.equal(textPlusCount(), 0);
  assert.equal(expressCount(), 0);
});

test("nested ExpressText+ container and effector collect outermost first", () => {
  const Cls = T.createExpressObjectClass(PZ, T.getExpressDefinitions()[0]);
  const boxInstance = new Cls();
  const shake = T.newEffectorInstance(T.EFFECTOR_TYPES.shake);
  assert.ok(shake, "effector factory builds");
  assert.equal(expressCount(), 2);
  try {
    const scene = {};
    link(scene, null, counter());
    const g = new Group();
    link(g, shake, counter());
    shake.parentObject = boxInstance;
    boxInstance.parentObject = scene;
    const text = mockText();
    link(text, g, counter());
    const layers = T.collectExpressObjects(text);
    assert.deepEqual(layers, [boxInstance, shake]);
    assert.equal(T.expressContainerOf(layers), boxInstance);
  } finally {
    shake.unload();
    boxInstance.unload();
  }
  assert.equal(expressCount(), 0);
});

/* --------------------------------------------------------------- release */

test("after the last Text+ unloads, plain text goes back to zero reads", () => {
  const plus = textPlusFactory("zoidium:text-plus/text-plus")();
  const reads = counter();
  const text = mockText();
  const group = new Group();
  link(group, plus, counter());
  plus.parentObject = null;
  link(text, group, reads);
  text.update(0);
  assert.ok(reads.reads > 0, "the walk runs while a Text+ is alive");
  plus.unload();
  assert.equal(textPlusCount(), 0);
  // The container leaves the tree with a stale split behind: the next
  // update settles it with one walk, then updates are free again.
  textPlusGeometry.getSplitState(text);
  link(group, null, counter());
  text.update(0);
  assert.ok(!textPlusUtils.state.splitStates.has(text), "stale split restored");
  const settled = reads.reads;
  text.update(0);
  assert.equal(reads.reads, settled, "no further parentObject reads");
});

test("after the last ExpressText+ unloads, plain text goes back to zero reads", () => {
  const Cls = T.createExpressObjectClass(PZ, T.getExpressDefinitions()[0]);
  const boxInstance = new Cls();
  const reads = counter();
  const text = mockText();
  link(text, boxInstance, reads);
  boxInstance.parentObject = null;
  text.update(0);
  assert.ok(reads.reads > 0, "the walk runs while ExpressText+ is alive");
  boxInstance.unload();
  assert.equal(expressCount(), 0);
  // The container leaves the tree: the next update settles the stale
  // split with one walk, then updates are free again.
  link(text, null, counter());
  text.update(0);
  const settled = reads.reads;
  text.update(0);
  assert.equal(reads.reads, settled, "no further parentObject reads");
});

/* ------------------------------------------------------------ saved load */

test("objects loaded from a saved project register exactly once", () => {
  const before = textPlusCount();
  const plus = textPlusFactory("zoidium:text-plus/text-plus")();
  assert.equal(textPlusCount(), before + 1, "construction registers");
  plus.load({ properties: {}, characterProperties: {}, objects: [] });
  assert.equal(textPlusCount(), before + 1, "load keeps one count");
  plus.load({ properties: {}, characterProperties: {}, objects: [] });
  assert.equal(textPlusCount(), before + 1, "repeated load keeps one count");
  const group = new Group();
  group.parentObject = plus;
  plus.parentObject = null;
  const text = mockText();
  link(text, group, counter());
  assert.deepEqual(textPlusUtils.collectTextPlusObjects(text), [plus]);
  plus.unload();
  assert.equal(textPlusCount(), before);
});

test("express objects loaded from a saved project register exactly once", () => {
  const before = expressCount();
  const Cls = T.createExpressObjectClass(PZ, T.getExpressDefinitions()[0]);
  const boxInstance = new Cls();
  assert.equal(expressCount(), before + 1, "construction registers");
  boxInstance.load({ objects: [], properties: {}, customProperties: [], expressProperties: {} });
  assert.equal(expressCount(), before + 1, "load keeps one count");
  const text = mockText();
  link(text, boxInstance, counter());
  boxInstance.parentObject = null;
  assert.deepEqual(T.collectExpressObjects(text), [boxInstance]);
  boxInstance.unload();
  assert.equal(expressCount(), before);
});
