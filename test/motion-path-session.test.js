"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createSession } = require("../plugins/motion-path/edit-session.js");
const c = require("../plugins/motion-path/curves.js");
const edit = require("../plugins/motion-path/path-edit.js");

// A small host model with CM3's inverse-command history semantics. In
// particular discard executes the inverse commands, rather than dropping them.
function host(data) {
  const axes = data.map(({ animated = true, keys }) => ({
    animated, keyframes: c.cloneKeys(keys), expression: null,
    onKeyframeChanged: { update() {} },
    getKeyframe(frame) { return this.keyframes.find(k => k.frame === frame); },
    getAddress() { return axes.indexOf(this); },
  }));
  const history = {
    operation: null, undoStack: [], redoStack: [],
    startOperation() { this.operation = []; },
    pushCommand(fn, args) { this.operation.push(() => fn(args)); },
    discardOperation() {
      const commands = this.operation.slice();
      for (const fn of commands.reverse()) fn();
      this.operation = null;
    },
    finishOperation() { this.undoStack.push(this.operation); this.operation = null; },
    replay(from, to) {
      this.startOperation();
      for (const fn of from.pop().slice().reverse()) fn();
      to.push(this.operation); this.operation = null;
    },
    undo() { this.replay(this.undoStack, this.redoStack); },
    redo() { this.replay(this.redoStack, this.undoStack); },
  };
  const editor = { history, project: { addressLookup: index => axes[index] } };
  class Ops {
    constructor(editor) { this.editor = editor; }
    toggleAnimation(axis, frame) {
      const before = { animated: axis.animated, keys: c.cloneKeys(axis.keyframes) };
      function swap(data) {
        const old = { animated: axis.animated, keys: c.cloneKeys(axis.keyframes) };
        axis.animated = data.animated; axis.keyframes = c.cloneKeys(data.keys);
        history.pushCommand(swap, old);
      }
      axis.animated = true; axis.keyframes[0].frame = frame;
      history.pushCommand(swap, before);
    }
    createKeyframe({ property, data }) {
      const axis = axes[property];
      axis.keyframes.push(c.cloneKey(data)); axis.keyframes.sort((a, b) => a.frame - b.frame);
      history.pushCommand(args => this.deleteKeyframe(args), { property, frame: data.frame });
    }
    deleteKeyframe({ property, frame }) {
      const axis = axes[property], key = axis.getKeyframe(frame);
      axis.keyframes.splice(axis.keyframes.indexOf(key), 1);
      history.pushCommand(args => this.createKeyframe(args), { property, data: key });
    }
  }
  const easings = [null, x => x];
  return {
    axes, editor, history, easings,
    session: () => createSession({ PZ: { ui: { properties: Ops } }, editor, path: { axes }, easings }),
    json: () => JSON.stringify(axes.map(a => ({ animated: a.animated, keys: a.keyframes }))),
  };
}
const key = (frame, value, tween = 1) => c.makeKey(frame, value, tween);

test("one gesture materializes every axis, and undo/redo restores the exact channels", () => {
  const h = host([
    { keys: [key(0, 0), key(30, 90), key(60, 0)] },
    { animated: false, keys: [key(0, 12)] },
  ]);
  const before = h.json(), s = h.session();
  for (let i = 0; i < 2; i++) s.ensure(i, [0, 30, 60]);
  const channels = h.axes.map((a, i) => ({ keys: s.base(i), animated: true, editable: true }));
  s.preview(edit.moveKeys(channels, [30], [20, 0]));
  assert.equal(s.commit(), true);
  assert.equal(h.history.undoStack.length, 1);
  assert.equal(h.axes[0].getKeyframe(30).value, 110);
  assert.deepEqual(h.axes[1].keyframes.map(k => [k.frame, k.value]), [[0, 12], [30, 12], [60, 12]]);
  const after = h.json();
  h.history.undo(); assert.equal(h.json(), before);
  h.history.redo(); assert.equal(h.json(), after);
});

test("Escape and a drag returned to its start remove newly inserted keys", () => {
  for (const cancel of [true, false]) {
    const h = host([{ keys: [key(0, 0), key(60, 120, 257)] }]);
    const before = h.json(), s = h.session();
    s.ensure(0, [0, 30, 60]);
    const channels = [{ keys: s.base(0), animated: true, editable: true }];
    s.preview(edit.moveKeys(channels, [30], [20]));
    if (cancel) s.cancel();
    else { s.preview([null]); assert.equal(s.commit(), false); }
    assert.equal(h.json(), before);
    assert.equal(h.history.undoStack.length, 0);
    assert.equal(h.history.operation, null);
  }
});

test("broken tangent undo retains asymmetric time and value offsets", () => {
  const middle = key(30, 100, 257);
  middle.controlPoints = [[-5, -20], [12, 48]];
  const h = host([{ keys: [key(0, 0), middle, key(60, 0, 257)] }]);
  const before = h.json(), s = h.session();
  s.ensure(0, [0, 30, 60]);
  s.preview(edit.setHandle([{ keys: s.base(0), animated: true, editable: true }], 30, 1, [70], {
    breakTangent: true, easings: h.easings,
  }));
  s.commit();
  const after = h.json();
  assert.equal(h.axes[0].getKeyframe(30).continuousTangent, false);
  h.history.undo(); assert.equal(h.json(), before);
  h.history.redo(); assert.equal(h.json(), after);
});

test("an existing history operation is never nested or closed", () => {
  const h = host([{ keys: [key(0, 0), key(60, 120)] }]);
  h.history.startOperation(); const operation = h.history.operation;
  assert.equal(h.session(), null);
  assert.equal(h.history.operation, operation);
});
