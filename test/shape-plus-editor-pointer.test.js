"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  createPointerMachine,
} = require("../plugins/shape-plus/editor-pointer-machine.js");
class Target extends EventTarget {
  constructor() {
    super();
    this.captured = new Set();
  }
  setPointerCapture(id) {
    this.captured.add(id);
  }
  hasPointerCapture(id) {
    return this.captured.has(id);
  }
  releasePointerCapture(id) {
    this.captured.delete(id);
    this.fire("lostpointercapture", id);
  }
  fire(type, id = 1, extra = {}) {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, {
      pointerId: id,
      button: 0,
      isPrimary: true,
      ...extra,
    });
    this.dispatchEvent(event);
    return event;
  }
}
// Interruptions keep what the preview already shows; only an explicit
// cancel (Escape, undo) rolls the gesture back.
for (const [interruption, outcome] of [
  ["pointercancel", "end"],
  ["lostpointercapture", "end"],
  ["blur", "end"],
  ["dispose", "end"],
  ["commit", "end"],
  ["lost-release", "end"],
  ["escape", "cancel"],
])
  test(
    "pointer interruption releases capture and finishes once: " + interruption,
    () => {
      const element = new Target(),
        owner = new Target(),
        events = [];
      const machine = createPointerMachine(
        element,
        () => ({
          move() {
            events.push("move");
          },
          end() {
            events.push("end");
          },
          cancel() {
            events.push("cancel");
          },
        }),
        owner,
      );
      element.fire("pointerdown");
      element.fire("pointermove", 2);
      element.fire("pointerdown", 2);
      element.fire("pointerup", 2);
      assert.deepEqual(events, []);
      element.fire("pointermove", 1, { buttons: 1 });
      if (interruption === "blur") owner.fire("blur");
      else if (interruption === "escape") machine.cancel();
      else if (interruption === "commit") machine.commit();
      else if (interruption === "dispose") machine.dispose();
      else if (interruption === "lost-release") element.fire("pointermove", 1, { buttons: 0, pointerType: "mouse" });
      else element.fire(interruption);
      element.fire("pointerup");
      assert.deepEqual(events, ["move", outcome]);
      assert.equal(machine.active, null);
      assert.equal(element.captured.size, 0);
      machine.dispose();
    },
  );
test("a press while a gesture is open ends the stale gesture and starts a new one", () => {
  const element = new Target(),
    owner = new Target(),
    events = [];
  let count = 0;
  const machine = createPointerMachine(
    element,
    () => {
      const id = ++count;
      return { end() { events.push("end" + id); }, cancel() { events.push("cancel" + id); } };
    },
    owner,
  );
  element.fire("pointerdown");
  element.fire("pointerdown");
  assert.deepEqual(events, ["end1"]);
  element.fire("pointerup");
  assert.deepEqual(events, ["end1", "end2"]);
  machine.dispose();
});
test("lastMoved tells a drag from a click for double-click handling", () => {
  const element = new Target(),
    owner = new Target();
  const machine = createPointerMachine(element, () => ({}), owner);
  element.fire("pointerdown", 1, { clientX: 0, clientY: 0 });
  element.fire("pointermove", 1, { clientX: 1, clientY: 1, buttons: 1 });
  element.fire("pointerup", 1, { clientX: 1, clientY: 1 });
  assert.equal(machine.lastMoved, false);
  element.fire("pointerdown", 1, { clientX: 0, clientY: 0 });
  element.fire("pointermove", 1, { clientX: 20, clientY: 0, buttons: 1 });
  element.fire("pointerup", 1, { clientX: 20, clientY: 0 });
  assert.equal(machine.lastMoved, true);
  machine.dispose();
});
test("pointer completion runs once despite lost capture and ignores secondary pointers", () => {
  const element = new Target(),
    owner = new Target(),
    events = [];
  const machine = createPointerMachine(
    element,
    () => ({
      end() {
        events.push("end");
      },
      cancel() {
        events.push("cancel");
      },
    }),
    owner,
  );
  element.fire("pointerdown", 1, { isPrimary: false });
  assert.equal(machine.active, null);
  element.fire("pointerdown");
  element.fire("pointerup");
  element.fire("pointerup");
  assert.deepEqual(events, ["end"]);
  machine.dispose();
});

test("pointer errors cancel ownership and report through the editor boundary", () => {
  const element = new Target(),
    owner = new Target(),
    events = [];
  const machine = createPointerMachine(
    element,
    () => ({
      move() {
        throw Error("unsupported");
      },
      cancel() {
        events.push("cancel");
      },
    }),
    owner,
    (error) => events.push(error.message),
  );
  element.fire("pointerdown");
  element.fire("pointermove");
  assert.deepEqual(events, ["cancel", "unsupported"]);
  assert.equal(machine.active, null);
  assert.equal(element.captured.size, 0);
  machine.dispose();
});

test("Pen close, insert and delete clicks commit on release, on capture loss and roll back on Escape", () => {
  const { createPointer } = require("../plugins/shape-plus/editor-pointer");
  for (const hit of [{ kind: "anchor", index: 0 }, { kind: "anchor", index: 1 }, { kind: "segment", index: 0, t: .5 }]) {
    const element = new Target(), owner = new Target();
    element.focus = () => {};
    element.getBoundingClientRect = () => ({ left: 0, top: 0 });
    element.ownerDocument = { defaultView: owner };
    let data = { closed: 0, edits: 0 }, before = null, entries = 0;
    const item = {
      id: "path", kind: "path", vertexIds: ["a", "b"],
      properties: { closed: { get: () => data.closed, set: value => { data.closed = value; } } },
      evaluate: () => ({ properties: {} }),
      toJSON: () => ({ vertexIds: ["a", "b"], properties: { closed: data.closed,
        path: { animated: false, keyframes: [{ frame: 0, value: Array(12).fill(0), tween: 1 }] } } }),
    };
    const state = {
      layer: { contents: [item] }, activeId: "path", tool: "pen", penFinished: false,
      selection: new Set(), editor: { playback: {} },
      canvasApi: { hit: () => hit, activeMatrix: () => [] },
      active: () => item, localFrame: () => 0, valid: () => true,
      nextId: () => "new", preview() {}, refresh() {},
      topology() { data.edits++; }, message(text) { assert.fail(text); },
      gesture: {
        active: false,
        begin() { before = { ...data }; this.active = true; return true; },
        finish(cancel) {
          if (!this.active) return;
          this.active = false;
          if (cancel) data = before;
          else entries++;
        },
      },
    };
    const pointer = createPointer(state, element), original = { ...data };
    element.fire("pointerdown", 1, { clientX: 0, clientY: 0 });
    assert.notDeepEqual(data, original);
    assert.equal(entries, 0);
    pointer.cancel();
    assert.deepEqual(data, original);
    assert.equal(state.penFinished, false);
    assert.equal(state.gesture.active, false);
    assert.equal(entries, 0);
    element.fire("pointerdown", 1, { clientX: 0, clientY: 0 });
    element.fire("lostpointercapture");
    assert.equal(entries, 1);
    element.fire("pointerdown", 1, { clientX: 0, clientY: 0 });
    element.fire("pointerup");
    assert.equal(entries, 2);
    assert.equal(element.captured.size, 0);
    pointer.dispose();
  }
});
