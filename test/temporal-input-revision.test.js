"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");

// The input-revision memo is browser-only work: it needs CM3's property and
// object-list prototypes to observe edits. This file installs minimal stand-ins
// before the core scripts load, then checks that a memoized key is reused until
// the model reports a change.
function signal() {
  const listeners = [];
  return {
    watch(listener) { listeners.push(listener); },
    update() { for (const listener of listeners.slice()) listener(); },
  };
}

class FakeProperty {
  constructor(value) {
    this.value = value;
    this.onChanged = signal();
  }
  set(value) {
    this.value = value;
    this.onChanged.update();
  }
}
FakeProperty.static = class extends FakeProperty {};
FakeProperty.dynamic = class extends FakeProperty {};

class FakeObjectList extends Array {
  push(...items) { return super.push(...items); }
  splice(...args) { return super.splice(...args); }
  load(value) { return value; }
}

const documentListeners = new Map();
global.document = {
  addEventListener(name, listener) {
    if (!documentListeners.has(name)) documentListeners.set(name, []);
    documentListeners.get(name).push(listener);
  },
};

global.PZ = { property: FakeProperty, objectList: FakeObjectList };

const { frameSamplerInputKey } = require("../plugins/core/temporal-sampler.js");

function fixture() {
  const rate = new FakeProperty(30);
  const layer = { type: 2, properties: { rate }, objects: [], effects: [] };
  const clip = { start: 0, length: 100, object: layer };
  const sequence = {
    properties: { rate },
    videoTracks: new FakeObjectList({ enabled: true, clips: [clip] }),
    parentProject: { assets: { list: {} } },
    serializations: 0,
    toJSON() {
      this.serializations += 1;
      return { properties: this.properties, videoTracks: this.videoTracks };
    },
  };
  const root = { readBuffer: { width: 80, height: 40 } };
  const effect = { type: "zoidium:test/sampler" };
  // No layer or clip on the stage keeps the key on the whole-sequence path,
  // which is the expensive serialization the memo exists for.
  const stage = { effect, trackIndex: 0, effectIndex: 2 };
  PZ.zoidium = {};
  return {
    rate, sequence, root, stage,
    key() { return frameSamplerInputKey(sequence, root, stage, null); },
    serializations() { return sequence.serializations; },
  };
}

test("an unchanged project reuses the memoized input revision", () => {
  const h = fixture();
  const first = h.key();
  assert.equal(h.serializations(), 1);
  assert.equal(h.key(), first);
  assert.equal(h.serializations(), 1, "the second read does not serialize the scene");
});

test("a property edit invalidates the memoized revision", () => {
  const h = fixture();
  const before = h.key();
  h.rate.set(60);
  const after = h.key();
  assert.notEqual(after, before);
  assert.equal(h.serializations(), 2);
});

test("a structural edit invalidates the memoized revision", () => {
  const h = fixture();
  const before = h.key();
  h.sequence.videoTracks.push({ enabled: false, clips: [] });
  assert.notEqual(h.key(), before);
  assert.equal(h.serializations(), 2);
});

test("a native input event invalidates the memoized revision", () => {
  const h = fixture();
  const before = h.key();
  for (const listener of documentListeners.get("input") || []) listener({});
  assert.equal(h.key(), before, "the content is unchanged");
  assert.equal(h.serializations(), 2, "the revision is still re-read");
});

test("debugDisableTemporalKeyMemo serializes every read", () => {
  const h = fixture();
  PZ.zoidium.debugDisableTemporalKeyMemo = true;
  h.key();
  h.key();
  assert.equal(h.serializations(), 2);
});

test("debugAssertTemporalKeyMemo reports a content change that no revision observed", () => {
  const h = fixture();
  h.key();
  PZ.zoidium.debugAssertTemporalKeyMemo = true;
  h.sequence.properties.rate = { value: 60 };
  assert.throws(() => h.key(), /changed without a model invalidation/);
});
