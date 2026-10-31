"use strict";
// Fix 5: only changed path channels are written per drag move. The pre-change
// setValue is kept here as the reference: serialized history and final
// project JSON must match old against new for static and animated paths,
// fractional frames, auto-key creation, selected handles, multiple anchors,
// Escape, undo and redo.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { PZ } = require("./shape-plus-host.js");
const { createModel, clone } = require("../plugins/shape-plus/model.js");
const { createEditorModel } = require("../plugins/shape-plus/editor-model.js");
const g = require("../plugins/shape-plus/editor-geometry.js");

// Reference: setValue before the fix writes every channel on every move.
function oldSetValue(s, PZRef, property, value, frame) {
  const axes = property.objects || [property],
    values = property.objects ? value : [value];
  if (
    property.expression ||
    axes.some((axis) => axis.expression || axis.definition.readOnly)
  )
    throw Error("Expression-driven properties cannot be edited");
  axes.forEach((axis, i) => {
    if (axis.animated && !axis.hasKeyframe(frame)) {
      const closest = axis.keyframes[axis.getClosestKeyframeIndex(frame)];
      const key = new PZRef.keyframe(
        axis.get(frame),
        frame,
        closest?.tween ?? axis.defaultTween,
      );
      axis.addKeyframe(key);
      axis.onKeyframeCreated.update(key);
    }
    axis.set(values[i], frame);
    const key = axis.keyframes?.[axis.getClosestKeyframeIndex(frame)];
    axis.onKeyframeChanged?.update(key);
  });
  s.preview();
}

PZ.clip = class {};
PZ.keyframe = class {
  constructor(value, frame, tween) {
    Object.assign(this, { value, frame, tween, controlPoints: [[-10, 0], [10, 0]] });
  }
};
Object.defineProperties(PZ.property.prototype, {
  keyframes: { get() { return this.data?.keyframes; } },
  animated: {
    get() {
      return this.objects ? this.objects.some((p) => p.animated) : !!this.data?.animated;
    },
    set(value) { this.data.animated = value; },
    configurable: true,
  },
  onKeyframeCreated: { get() { return { update() {} }; }, configurable: true },
  onKeyframeDeleted: { get() { return { update() {} }; }, configurable: true },
});
PZ.property.prototype.onKeyframeChanged = {
  update() {},
};
PZ.property.prototype.hasKeyframe = function (frame) {
  return this.keyframes.some((k) => k.frame === frame);
};
PZ.property.prototype.getClosestKeyframeIndex = function (frame) {
  const index = this.keyframes.findIndex((k) => k.frame >= frame);
  return index < 0 ? this.keyframes.length - 1 : index;
};
PZ.property.prototype.addKeyframe = function (key) {
  this.keyframes.push(key);
  this.keyframes.sort((a, b) => a.frame - b.frame);
};
PZ.property.prototype.set = function (value, frame) {
  if (this.objects) this.objects.forEach((p, i) => p.set(value[i], frame));
  else if (this.data) this.keyframes[this.getClosestKeyframeIndex(frame)].value = value;
  else this.value = value;
};
class History {
  constructor() {
    this.operation = null;
    this.undoStack = [];
    this.redoStack = [];
  }
  startOperation() { this.operation = []; }
  pushCommand(fn, p) { this.operation.push(() => fn(p)); }
  finishOperation(undo = false) {
    if (this.operation.length) (undo ? this.redoStack : this.undoStack).push(this.operation);
    this.operation = null;
  }
  discardOperation() {
    for (let i = this.operation.length - 1; i >= 0; i--) this.operation[i]();
    this.operation = null;
  }
  undo() {
    const op = this.undoStack.pop();
    this.startOperation();
    for (let i = op.length - 1; i >= 0; i--) op[i]();
    this.finishOperation(true);
  }
  redo() {
    const op = this.redoStack.pop();
    this.startOperation();
    for (let i = op.length - 1; i >= 0; i--) op[i]();
    this.finishOperation();
  }
}
function pathData(vertexCount, animated, frames) {
  const vertexIds = Array.from({ length: vertexCount }, (_, i) => "v" + i);
  const line = (offset) => vertexIds.flatMap((_, i) => [i * 10 + offset, i * 5, 0, 0, 0, 0]);
  return {
    id: "path", kind: "path", vertexIds,
    properties: {
      closed: 0,
      path: {
        animated,
        keyframes: frames.map((frame) => ({ frame, value: line(frame), tween: 1 })),
      },
    },
  };
}
function host({ vertexCount, animated, frames, frame }) {
  const { Content } = createModel(PZ);
  const layer = { type: "shape", getAddress: () => [0], contents: null, tryGetParentOfType: () => null };
  layer.contents = new PZ.objectList(null, Content);
  const node = new Content("path", { id: "path", vertexIds: ["v0"] });
  layer.contents.push(node);
  node.load(pathData(vertexCount, animated, frames));
  const project = {
    target: layer,
    addressLookup() { return this.target; },
    ui: { onChanged: { update() {} } },
  };
  const editor = { project, history: new History(), playback: { currentFrame: frame } };
  const s = { PZ, Content, layer, editor, project, activeId: "path", message: (text) => { throw Error(text); } };
  createEditorModel(s);
  layer.signature = "keep";
  const stats = { sets: 0, changed: 0, created: 0 };
  const path = node.properties.path;
  const axes = path.objects;
  for (const axis of axes) {
    const set = axis.set.bind(axis);
    axis.set = (value, f) => { stats.sets++; return set(value, f); };
    const add = axis.addKeyframe.bind(axis);
    axis.addKeyframe = (key) => { stats.created++; return add(key); };
    // Creation announcements run in the same loop as creation, so counting
    // addKeyframe proves their parity; change announcements are counted here.
    axis.onKeyframeChanged = { update: () => { stats.changed++; } };
  }
  return { s, editor, node, stats, before: clone(layer.contents) };
}
function states(layer) {
  return clone(layer.contents);
}
// Drags one anchor's point; returns per-move snapshots.
function dragAnchor(s, moves) {
  const seen = [];
  assert.equal(s.gesture.begin(), true);
  for (const [index, delta] of moves) {
    const points = s.pathPoints();
    points[index].point = g.add(points[index].point, delta);
    s.setPoints(points);
    seen.push(states(s.layer));
  }
  s.gesture.finish();
  return seen;
}
for (const animated of [false, true]) {
  test(`static and animated paths match old history and JSON (animated=${animated})`, () => {
    const frames = animated ? [0, 30] : [0];
    const oldHost = host({ vertexCount: 240, animated, frames, frame: 15 });
    oldHost.s.setValue = (property, value, frame = oldHost.s.localFrame()) => oldSetValue(oldHost.s, PZ, property, value, frame);
    const newHost = host({ vertexCount: 240, animated, frames, frame: 15 });
    const oldSeen = dragAnchor(oldHost.s, [[3, [5, 0]], [3, [9, -4]], [3, [12, 7]]]);
    const newSeen = dragAnchor(newHost.s, [[3, [5, 0]], [3, [9, -4]], [3, [12, 7]]]);
    assert.deepEqual(newSeen, oldSeen, "project JSON matches after every move");
    assert.deepEqual(states(newHost.s.layer), states(oldHost.s.layer), "final JSON matches");
    assert.equal(newHost.editor.history.undoStack.length, 1, "one undo step");
    assert.equal(oldHost.editor.history.undoStack.length, 1, "one undo step before the fix too");
    newHost.editor.history.undo();
    oldHost.editor.history.undo();
    assert.deepEqual(states(newHost.s.layer), states(oldHost.s.layer), "undo matches");
    assert.deepEqual(states(newHost.s.layer), newHost.before, "undo restores the gesture start");
    newHost.editor.history.redo();
    oldHost.editor.history.redo();
    assert.deepEqual(states(newHost.s.layer), states(oldHost.s.layer), "redo matches");
    if (animated) {
      assert.equal(newHost.stats.created, oldHost.stats.created, "same auto-key count");
      assert.ok(newHost.stats.created === 1440, `keys created once for all channels, got ${newHost.stats.created}`);
    }
    assert.ok(newHost.stats.sets < oldHost.stats.sets / 100, `writes collapse: ${newHost.stats.sets} vs ${oldHost.stats.sets}`);
    assert.equal(newHost.stats.changed, newHost.stats.sets, "every write is still announced");
  });
}
test("fractional frames match old history and JSON", () => {
  const oldHost = host({ vertexCount: 240, animated: true, frames: [0, 30], frame: 15.5 });
  oldHost.s.setValue = (property, value, frame = oldHost.s.localFrame()) => oldSetValue(oldHost.s, PZ, property, value, frame);
  const newHost = host({ vertexCount: 240, animated: true, frames: [0, 30], frame: 15.5 });
  const oldSeen = dragAnchor(oldHost.s, [[0, [4, 4]], [239, [-3, 6]]]);
  const newSeen = dragAnchor(newHost.s, [[0, [4, 4]], [239, [-3, 6]]]);
  assert.deepEqual(newSeen, oldSeen);
  assert.deepEqual(states(newHost.s.layer), states(oldHost.s.layer));
  const keys = (h) => h.node.properties.path.objects.map((axis) => axis.keyframes.map((k) => k.frame));
  assert.deepEqual(keys(newHost), keys(oldHost), "auto-key frames match per channel");
  assert.deepEqual(
    newHost.node.properties.path.objects.map((axis) => axis.keyframes.map((k) => k.tween)),
    oldHost.node.properties.path.objects.map((axis) => axis.keyframes.map((k) => k.tween)),
    "auto-key tweens match per channel",
  );
});
test("selected handles and multiple anchors match old JSON", () => {
  const oldHost = host({ vertexCount: 8, animated: true, frames: [0, 30], frame: 15 });
  oldHost.s.setValue = (property, value, frame = oldHost.s.localFrame()) => oldSetValue(oldHost.s, PZ, property, value, frame);
  const newHost = host({ vertexCount: 8, animated: true, frames: [0, 30], frame: 15 });
  const gesture = (s) => {
    assert.equal(s.gesture.begin(), true);
    const points = s.pathPoints();
    // Two anchors move; an unrelated handle moves with the same delta while
    // its anchor stays, mirroring the pointer's handle-drag branch.
    points[1].point = g.add(points[1].point, [7, 7]);
    points[4].point = g.add(points[4].point, [7, 7]);
    points[2] = g.handle(points[2], "out", g.add(points[2].out, [7, 7]), "corner");
    s.setPoints(points);
    s.gesture.finish();
  };
  gesture(oldHost.s);
  gesture(newHost.s);
  assert.deepEqual(states(newHost.s.layer), states(oldHost.s.layer));
  assert.equal(newHost.stats.sets, 2 * 2 + 2, `only changed channels written, got ${newHost.stats.sets}`);
});
test("Escape rolls back and a lost capture commits, matching the old path", () => {
  for (const cancel of [true, false]) {
    const oldHost = host({ vertexCount: 240, animated: true, frames: [0, 30], frame: 15 });
    oldHost.s.setValue = (property, value, frame = oldHost.s.localFrame()) => oldSetValue(oldHost.s, PZ, property, value, frame);
    const newHost = host({ vertexCount: 240, animated: true, frames: [0, 30], frame: 15 });
    for (const h of [oldHost, newHost]) {
      assert.equal(h.s.gesture.begin(), true);
      const points = h.s.pathPoints();
      points[9].point = g.add(points[9].point, [11, -2]);
      h.s.setPoints(points);
      h.s.gesture.finish(cancel);
    }
    assert.deepEqual(states(newHost.s.layer), states(oldHost.s.layer), cancel ? "Escape" : "commit");
    if (cancel) {
      assert.deepEqual(states(newHost.s.layer), newHost.before, "Escape restores the start");
      assert.equal(newHost.editor.history.undoStack.length, 0, "Escape records no undo step");
    } else {
      assert.equal(newHost.editor.history.undoStack.length, 1, "a lost capture commits one undo step");
    }
  }
});
test("length changes fall back to the full write", () => {
  const oldHost = host({ vertexCount: 4, animated: false, frames: [0], frame: 0 });
  oldHost.s.setValue = (property, value, frame = oldHost.s.localFrame()) => oldSetValue(oldHost.s, PZ, property, value, frame);
  const newHost = host({ vertexCount: 4, animated: false, frames: [0], frame: 0 });
  for (const h of [oldHost, newHost]) {
    const path = h.node.properties.path;
    h.s.setValue(path, path.get(0).concat([1, 2, 3, 4, 5, 6]), 0);
  }
  assert.deepEqual(states(newHost.s.layer), states(oldHost.s.layer));
  assert.equal(newHost.stats.sets, oldHost.stats.sets, "fallback writes every channel");
});
