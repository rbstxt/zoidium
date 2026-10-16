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
for (const cancel of [
  "pointercancel",
  "lostpointercapture",
  "blur",
  "escape",
  "dispose",
  "target-deletion",
  "project-replacement",
])
  test(
    "pointer cancellation releases capture and finishes once: " + cancel,
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
      element.fire("pointermove");
      if (cancel === "blur") owner.fire("blur");
      else if (
        ["escape", "target-deletion", "project-replacement"].includes(cancel)
      )
        machine.cancel();
      else if (cancel === "dispose") machine.dispose();
      else element.fire(cancel);
      element.fire("pointerup");
      assert.deepEqual(events, ["move", "cancel"]);
      assert.equal(machine.active, null);
      assert.equal(element.captured.size, 0);
      machine.dispose();
    },
  );
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
