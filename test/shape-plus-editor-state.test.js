"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createGesture } = require("../plugins/shape-plus/editor-history.js");
const tree = require("../plugins/shape-plus/editor-tree-data.js");
class History {
  constructor() {
    this.operation = null;
    this.undoStack = [];
    this.redoStack = [];
  }
  startOperation() {
    this.operation = [];
  }
  pushCommand(fn, p) {
    this.operation.push(() => fn(p));
  }
  finishOperation(undo = false) {
    if (this.operation.length)
      (undo ? this.redoStack : this.undoStack).push(this.operation);
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
test("one history entry per gesture, empty gestures and cancellation add none", () => {
  const history = new History();
  let data = [0];
  const gesture = createGesture(
    history,
    () => data.slice(),
    (value) => {
      data = value;
    },
  );
  gesture.begin();
  for (let i = 0; i < 30; i++) data[0] = i;
  gesture.finish();
  assert.equal(history.undoStack.length, 1);
  history.undo();
  assert.deepEqual(data, [0]);
  history.redo();
  assert.deepEqual(data, [29]);
  gesture.begin();
  data[0] = 100;
  gesture.finish(true);
  assert.deepEqual(data, [29]);
  assert.equal(history.undoStack.length, 1);
  gesture.begin();
  gesture.finish();
  assert.equal(history.undoStack.length, 1);
  assert.equal(history.operation, null);
  history.startOperation();
  assert.equal(gesture.begin(), false);
  history.discardOperation();
  assert.throws(
    () =>
      gesture.run(() => {
        data[0] = 500;
        throw Error("failed");
      }),
    /failed/,
  );
  assert.deepEqual(data, [29]);
  assert.equal(history.operation, null);
});
test("tree reorder, cross-group move, group, ungroup and duplicate serialize stably", () => {
  const contents = [
    { id: "a", kind: "rectangle", properties: {} },
    { id: "b", kind: "ellipse", properties: {} },
    { id: "g", kind: "group", properties: {}, contents: [] },
  ];
  tree.move(contents, ["a"], "g");
  assert.equal(contents[1].contents[0].id, "a");
  assert.throws(() => tree.move(contents, ["g"], "g"), /itself/);
  tree.move(contents, ["a"], null, "b");
  assert.deepEqual(
    contents.map((i) => i.id),
    ["a", "b", "g"],
  );
  tree.group(contents, ["b", "a"], "group");
  assert.deepEqual(
    contents[0].contents.map((i) => i.id),
    ["a", "b"],
  );
  const saved = JSON.stringify(contents);
  tree.ungroup(contents, "group");
  assert.deepEqual(
    contents.map((i) => i.id),
    ["a", "b", "g"],
  );
  tree.group(contents, ["a", "b"], "group");
  assert.equal(JSON.stringify(contents), saved);
  let seed = 0;
  tree.duplicate(contents, ["group", "a"], () => "copy" + ++seed);
  assert.deepEqual(
    contents.map((i) => i.id),
    ["group", "copy1", "g"],
  );
  assert.equal(contents[1].contents[0].id, "copy2");
  assert.equal(contents[0].contents[0].id, "a");
  contents[0].properties.scale = {
    objects: [
      { animated: false, keyframes: [{ frame: 0, value: 2, tween: 1 }] },
      { animated: false, keyframes: [{ frame: 0, value: 1, tween: 1 }] },
    ],
  };
  assert.throws(() => tree.ungroup(contents, "group"), /Reset group/);
});
module.exports = { History };

test("ungroup preserves a disabled group's effective visibility", () => {
  const contents = [
    {
      id: "group",
      kind: "group",
      properties: { enabled: 0 },
      contents: [{ id: "a", kind: "rectangle", properties: { enabled: 1 } }],
    },
  ];
  tree.ungroup(contents, "group");
  assert.equal(contents[0].properties.enabled, 0);
});
