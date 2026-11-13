"use strict";
// Mask path host: the Shape+ editor edits a native layer's mask collection
// through the adapter, with pen-group unwrapping, structural gating,
// gesture persistence and undo.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { PZ } = require("./shape-plus-host.js");
const { createModel, clone } = require("../plugins/shape-plus/model.js");
const { createEditorModel } = require("../plugins/shape-plus/editor-model.js");
const { createMaskHost } = require("../plugins/shape-plus/mask-host.js");
const { FIELD, getMasks } = require("../plugins/shape-plus/mask-model.js");

PZ.clip = class {};
PZ.keyframe = class {
  constructor(value, frame, tween) {
    Object.assign(this, { value, frame, tween });
  }
};
Object.defineProperties(PZ.property.prototype, {
  keyframes: { get() { return this.data?.keyframes; } },
  animated: {
    get() { return this.objects ? this.objects.some(p => p.animated) : !!this.data?.animated; },
    set(value) { this.data.animated = value; },
  },
  onKeyframeCreated: { get() { return { update() {} }; } },
});
PZ.property.prototype.hasKeyframe = function (frame) { return this.keyframes.some(k => k.frame === frame); };
PZ.property.prototype.getClosestKeyframeIndex = function (frame) {
  const index = this.keyframes.findIndex(k => k.frame >= frame);
  return index < 0 ? this.keyframes.length - 1 : index;
};
PZ.property.prototype.addKeyframe = function (key) { this.keyframes.push(key); this.keyframes.sort((a, b) => a.frame - b.frame); };
PZ.property.prototype.deleteKeyframe = function (frame) { return this.keyframes.splice(this.keyframes.findIndex(k => k.frame === frame), 1)[0]; };
Object.defineProperty(PZ.property.prototype, "onKeyframeDeleted", { get() { return { update() {} }; } });
PZ.property.prototype.set = function (value, frame) {
  if (this.objects) this.objects.forEach((p, i) => p.set(value[i], frame));
  else if (this.data) this.keyframes[this.getClosestKeyframeIndex(frame)].value = value;
  else this.value = value;
};

class History {
  constructor() { this.operation = null; this.entries = []; }
  startOperation() { this.operation = []; }
  pushCommand(fn, p) {
    // The native history accepts undo-time commands (redo) without an open
    // operation; the stub records them as their own entry.
    (this.operation || this.entries[this.entries.push([]) - 1]).push({ fn, p });
  }
  finishOperation() { if (this.operation.length) this.entries.push(this.operation); this.operation = null; }
  discardOperation() { this.operation = null; }
  undo() {
    const operation = this.entries.pop();
    if (!operation) return;
    for (const { fn, p } of operation) fn(p);
  }
}

function harness(masks = []) {
  const { Content } = createModel(PZ);
  const nativeLayer = {
    type: "scene",
    parent: null,
    getAddress: () => [7],
    tryGetParentOfType: () => ({ start: 10, offset: 5 }),
  };
  if (masks.length) nativeLayer[FIELD] = clone(masks);
  const project = {
    target: nativeLayer,
    addressLookup() { return this.target; },
    ui: { onChanged: { update() {} } },
  };
  const editor = { project, history: new History(), playback: { currentFrame: 20 } };
  const host = createMaskHost({ nativeLayer, Content, editor, project });
  let nextId = 100;
  const s = {
    PZ, editor, project, Content,
    layer: host.adapter,
    pathHost: host,
    nextId: () => "m" + ++nextId,
    selection: new Set(),
    treeSelection: new Set(),
    activeId: null,
    penFinished: false,
    dirty: true,
    lastMessage: null,
    refresh() { this.dirty = true; },
    message(text) { this.lastMessage = text; },
    selectItem(id) {
      this.treeSelection = new Set([id]);
      this.activeId = id;
      this.selection.clear();
      this.refresh();
    },
  };
  createEditorModel(s);
  return { s, host, nativeLayer, editor, Content };
}

function pathMask(id, value, frame = 0) {
  return {
    id, kind: "path", mode: "add", feather: 0, opacity: 1, invert: 0,
    vertexIds: ["a", "b"],
    vertexModes: {},
    properties: {
      name: "Mask " + id, enabled: 1, closed: 0,
      path: { animated: false, keyframes: [{ frame, value, tween: 1 }] },
    },
  };
}

test("empty host reads no masks and the pen creates an unwrapped path", () => {
  const { s, nativeLayer } = harness();
  assert.equal(s.valid(), true);
  assert.deepEqual(s.pathPoints(), []);
  const item = s.addItem("path", [10, 20]);
  assert.ok(item && item.kind === "path");
  const masks = getMasks(nativeLayer);
  assert.equal(masks.length, 1);
  assert.equal(masks[0].kind, "path");
  assert.equal(masks[0].properties.name, "Mask 1");
  assert.deepEqual(masks[0].properties.path.keyframes[0].value.slice(0, 2), [10, 20]);
  assert.equal(s.activeId, masks[0].id);
});

test("host rejects groups and paints, allows reorder and delete", () => {
  const { s, nativeLayer } = harness([pathMask("m1", [0, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0])]);
  s.treeAction("group");
  assert.match(s.lastMessage, /do not support group/);
  s.treeAction("paint", "fill");
  assert.match(s.lastMessage, /do not support paint/);
  assert.equal(getMasks(nativeLayer).length, 1);
  s.addItem("path", [30, 30]);
  assert.equal(getMasks(nativeLayer).length, 2);
  s.treeAction("forward");
  assert.equal(getMasks(nativeLayer).length, 2);
  const second = getMasks(nativeLayer)[1].id;
  s.selectItem(second);
  s.treeAction("delete");
  assert.equal(getMasks(nativeLayer).length, 1);
});

test("keyframing the path persists animated channels to the field", () => {
  const { s, nativeLayer } = harness([pathMask("m1", [0, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0])]);
  s.selectItem("m1");
  s.keyframe();
  const keyed = getMasks(nativeLayer)[0];
  assert.equal(keyed.properties.path.animated, true);
  s.mutate(() => s.setValue(s.active().properties.path, [5, 5, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0]));
  const moved = getMasks(nativeLayer)[0].properties.path;
  assert.ok(moved.keyframes.some(k => k.value[0] === 5));
});

test("mask parameters survive the Content round-trip", () => {
  const source = { ...pathMask("m1", [0, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0]), mode: "subtract", feather: 12, opacity: 0.5, invert: 1 };
  const { nativeLayer } = harness([source]);
  const back = getMasks(nativeLayer)[0];
  assert.equal(back.mode, "subtract");
  assert.equal(back.feather, 12);
  assert.equal(back.opacity, 0.5);
  assert.equal(back.invert, 1);
});

test("undo restores the previous mask collection", () => {
  const { s, nativeLayer, editor } = harness();
  s.gesture.begin();
  s.addItem("path", [1, 1]);
  s.gesture.finish();
  assert.equal(getMasks(nativeLayer).length, 1);
  editor.history.undo();
  assert.deepEqual(getMasks(nativeLayer), []);
});

test("host goes invalid when the layer leaves the project", () => {
  const { s, nativeLayer, editor } = harness([pathMask("m1", [0, 0, 0, 0, 0, 0, 10, 10, 0, 0, 0, 0])]);
  assert.equal(s.valid(), true);
  editor.project.target = { other: true };
  assert.equal(s.valid(), false);
  assert.equal(nativeLayer[FIELD].length, 1);
});
