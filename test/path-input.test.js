"use strict";
// Path input routing: Q/V tool selection, temporary command selection, Alt
// handling, Escape/Enter finishing, and shortcut focus guards. Tests run the
// real P1.1 controller (selection retention comes from its tool switches)
// and the real P1.4 deletion/cycle rules through this module; only the host
// behind the controller is a small fake.
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createPathController } = require("../plugins/shape-plus/path-controller.js");
const {
  createPathInput,
  isEditableTarget,
  isComposingEvent,
  MODIFIED_PASSTHROUGH,
  NATIVE_TOOL_KEYS,
} = require("../plugins/shape-plus/path-input.js");

function fakeHost() {
  return {
    id: "mask",
    paths: ["m1"],
    hasPath(id) {
      return this.paths.includes(id);
    },
    listPathIds() {
      return this.paths.slice();
    },
    listVertexIds() {
      return ["a", "b"];
    },
    syncSelection() {},
  };
}

function setup() {
  const host = fakeHost();
  const controller = createPathController({ project: "p1", viewport: "v1" });
  controller.activate(host, "m1");
  controller.claimFocus("path");
  const input = createPathInput({ controller });
  return { host, controller, input };
}

function down(key, extra) {
  const calls = [];
  return {
    key,
    target: { closest: () => null },
    preventDefault() {
      calls.push("preventDefault");
    },
    stopImmediatePropagation() {
      calls.push("stopImmediatePropagation");
    },
    calls,
    ...extra,
  };
}

function up(key, extra) {
  return down(key, extra);
}

test("Q selects pen and retains the vertex selection", () => {
  const { controller, input } = setup();
  controller.setSelection(controller.activeHost, "m1", ["a"]);
  controller.setTool("select");
  const event = down("q");
  const outcome = input.handleKeyDown(event);
  assert.equal(outcome.action, "select-pen");
  assert.equal(outcome.consumed, true);
  assert.equal(controller.tool, "pen");
  assert.deepEqual(controller.getSelection(), ["a"]);
  assert.deepEqual(event.calls, ["preventDefault", "stopImmediatePropagation"]);
});

test("P stays a pen alias and retains selection", () => {
  const { controller, input } = setup();
  controller.setSelection(controller.activeHost, "m1", ["b"]);
  controller.setTool("select");
  const outcome = input.handleKeyDown(down("P"));
  assert.equal(outcome.action, "select-pen");
  assert.equal(controller.tool, "pen");
  assert.deepEqual(controller.getSelection(), ["b"]);
});

test("V selects point editing when a path is active", () => {
  const { controller, input } = setup();
  controller.setTool("pen");
  const outcome = input.handleKeyDown(down("v"));
  assert.equal(outcome.action, "select-points");
  assert.equal(outcome.consumed, true);
  assert.equal(controller.tool, "select");
});

test("V yields to layer selection with no active path", () => {
  const { controller, input } = setup();
  controller.deactivate();
  controller.setTool("pen");
  const event = down("v");
  const outcome = input.handleKeyDown(event);
  assert.equal(outcome.action, "defer-to-layer");
  assert.equal(outcome.consumed, false);
  assert.equal(controller.tool, "pen");
  assert.deepEqual(event.calls, []);
});

test("a focused Graph+ editor keeps priority for V", () => {
  const { controller, input } = setup();
  const event = down("v");
  const outcome = input.handleKeyDown(event, { graphFocused: true });
  assert.equal(outcome.action, "defer-to-graph");
  assert.equal(outcome.consumed, false);
  assert.equal(controller.tool, "select");
  assert.deepEqual(event.calls, []);
});

test("holding Ctrl in pen temporarily selects points; release restores pen", () => {
  const { controller, input } = setup();
  controller.setTool("pen");
  const held = input.handleKeyDown(down("Control", { ctrlKey: true }));
  assert.equal(held.action, "temporary-select");
  assert.equal(held.consumed, false);
  assert.equal(controller.tool, "select");
  assert.equal(input.isTemporarySelect(), true);
  const released = input.handleKeyUp(up("Control", { ctrlKey: false }));
  assert.equal(released.action, "restore-tool");
  assert.equal(controller.tool, "pen");
  assert.equal(input.isTemporarySelect(), false);
});

test("temporary selection preserves the vertex selection", () => {
  const { controller, input } = setup();
  controller.setTool("pen");
  controller.setSelection(controller.activeHost, "m1", ["a", "b"]);
  input.handleKeyDown(down("Control", { ctrlKey: true }));
  input.handleKeyUp(up("Control"));
  assert.deepEqual(controller.getSelection(), ["a", "b"]);
});

test("modified clipboard, history, select-all, duplicate, and reorder keys defer", () => {
  const { input } = setup();
  for (const key of MODIFIED_PASSTHROUGH) {
    const event = down(key, { ctrlKey: true });
    const outcome = input.handleKeyDown(event);
    assert.equal(outcome.action, "defer-to-native", key);
    assert.equal(outcome.consumed, false, key);
    assert.deepEqual(event.calls, [], key);
  }
  const redo = down("z", { ctrlKey: true, shiftKey: true });
  assert.equal(input.handleKeyDown(redo).action, "defer-to-native");
  const meta = down("c", { metaKey: true });
  assert.equal(input.handleKeyDown(meta).action, "defer-to-native");
});

test("typing targets ignore shortcuts without consuming", () => {
  const { controller, input } = setup();
  controller.setTool("select");
  for (const closest of [
    () => ({}),
    (selector) => (selector.includes("input") ? {} : null),
  ]) {
    const event = down("q", { target: { closest } });
    const outcome = input.handleKeyDown(event);
    assert.equal(outcome.action, "ignore");
    assert.equal(outcome.reason, "typing");
    assert.equal(outcome.consumed, false);
    assert.deepEqual(event.calls, []);
  }
  assert.equal(controller.tool, "select");
});

test("composition events ignore shortcuts", () => {
  const { controller, input } = setup();
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) {
    const event = down("v", extra);
    const outcome = input.handleKeyDown(event);
    assert.equal(outcome.action, "ignore");
    assert.equal(outcome.reason, "composing");
    assert.equal(outcome.consumed, false);
  }
  assert.equal(controller.tool, "select");
});

test("shortcuts outside the viewport are ignored", () => {
  const { controller, input } = setup();
  const outcome = input.handleKeyDown(down("q"), { viewportFocused: false });
  assert.equal(outcome.action, "ignore");
  assert.equal(outcome.reason, "focus-elsewhere");
  assert.equal(controller.tool, "select");
});

test("Escape cancels an active drag first", () => {
  const { controller, input } = setup();
  controller.beginGesture({ kind: "drag" });
  const outcome = input.handleKeyDown(down("Escape"));
  assert.equal(outcome.action, "cancel-gesture");
  assert.equal(outcome.consumed, true);
  assert.equal(outcome.gesture.cancelled, true);
  assert.equal(controller.gesture, null);
});

test("Escape finishes drawing and retains the path and selection", () => {
  const { controller, input } = setup();
  controller.setSelection(controller.activeHost, "m1", ["a"]);
  controller.startDrawing({ points: [[0, 0]] });
  const outcome = input.handleKeyDown(down("Escape"));
  assert.equal(outcome.action, "finish-drawing");
  assert.equal(outcome.consumed, true);
  assert.equal(controller.drawing, null);
  assert.equal(controller.activePathId, "m1");
  assert.deepEqual(controller.getSelection(), ["a"]);
});

test("a second Escape clears vertex selection but keeps the path active", () => {
  const { controller, input } = setup();
  controller.setSelection(controller.activeHost, "m1", ["a", "b"]);
  const outcome = input.handleKeyDown(down("Escape"));
  assert.equal(outcome.action, "clear-selection");
  assert.equal(outcome.cleared, 2);
  assert.equal(outcome.consumed, true);
  assert.deepEqual(controller.getSelection(), []);
  assert.equal(controller.activePathId, "m1");
  const idle = input.handleKeyDown(down("Escape"));
  assert.equal(idle.action, "defer-to-native");
  assert.equal(idle.consumed, false);
});

test("Enter finishes drawing; otherwise it is never required", () => {
  const { controller, input } = setup();
  controller.startDrawing({ points: [[1, 1]] });
  const finish = input.handleKeyDown(down("Enter"));
  assert.equal(finish.action, "finish-drawing");
  assert.equal(finish.consumed, true);
  const idle = input.handleKeyDown(down("Enter"));
  assert.equal(idle.action, "ignore");
  assert.equal(idle.consumed, false);
});

test("Delete removes vertices only while path editing owns focus", () => {
  const { controller, input } = setup();
  controller.setSelection(controller.activeHost, "m1", ["a"]);
  const event = down("Delete");
  const outcome = input.handleKeyDown(event);
  assert.equal(outcome.action, "delete-vertices");
  assert.equal(outcome.count, 1);
  assert.equal(outcome.consumed, true);
  assert.deepEqual(event.calls, ["preventDefault", "stopImmediatePropagation"]);
});

test("Delete defers to the focused panel without focus or selection", () => {
  const { controller, input } = setup();
  controller.releaseFocus("path");
  controller.setSelection(controller.activeHost, "m1", ["a"]);
  const unfocused = input.handleKeyDown(down("Backspace"));
  assert.equal(unfocused.action, "defer-to-panel");
  assert.equal(unfocused.consumed, false);
  controller.claimFocus("path");
  controller.setSelection(controller.activeHost, "m1", []);
  const empty = input.handleKeyDown(down("Delete"));
  assert.equal(empty.action, "defer-to-panel");
  assert.equal(empty.consumed, false);
});

test("Delete on a locked path reports the block in English", () => {
  const { controller, input } = setup();
  controller.setSelection(controller.activeHost, "m1", ["a"]);
  const event = down("Delete");
  const outcome = input.handleKeyDown(event, { locked: true });
  assert.equal(outcome.action, "blocked-locked");
  assert.equal(outcome.consumed, true);
  assert.match(outcome.message, /Unlock the mask/);
  assert.deepEqual(controller.getSelection(), ["a"]);
});

test("Space always defers to viewport navigation", () => {
  const { input } = setup();
  const outcome = input.handleKeyDown(down(" "));
  assert.equal(outcome.action, "defer-to-viewport");
  assert.equal(outcome.consumed, false);
  const typing = input.handleKeyDown(down(" ", { target: { closest: () => ({}) } }));
  assert.equal(typing.action, "ignore");
  assert.equal(typing.reason, "typing");
});

test("T, C, and M stay with native commands", () => {
  const { input } = setup();
  for (const key of NATIVE_TOOL_KEYS) {
    const outcome = input.handleKeyDown(down(key));
    assert.equal(outcome.action, "defer-to-native", key);
    assert.equal(outcome.consumed, false, key);
  }
  assert.deepEqual(NATIVE_TOOL_KEYS, ["t", "c", "m"]);
});

test("Alt marks handle intent without consuming; Alt shortcuts defer", () => {
  const { input } = setup();
  assert.equal(input.isAltHeld(), false);
  const held = input.handleKeyDown(down("Alt", { altKey: true }));
  assert.equal(held.action, "alt-held");
  assert.equal(held.consumed, false);
  assert.equal(input.isAltHeld(), true);
  const menu = input.handleKeyDown(down("f", { altKey: true }));
  assert.equal(menu.action, "defer-to-native");
  assert.equal(menu.reason, "alt-shortcut");
  const released = input.handleKeyUp(up("Alt"));
  assert.equal(released.action, "alt-released");
  assert.equal(input.isAltHeld(), false);
});

test("blur ends temporary selection and restores pen", () => {
  const { controller, input } = setup();
  controller.setTool("pen");
  input.handleKeyDown(down("Meta", { metaKey: true }));
  assert.equal(input.isTemporarySelect(), true);
  const outcome = input.handleBlur();
  assert.equal(outcome.action, "restore-tool");
  assert.equal(controller.tool, "pen");
  assert.equal(input.isTemporarySelect(), false);
});

test("click activation cycles overlapping candidates through the controller", () => {
  const { host, controller, input } = setup();
  host.paths = ["front", "middle", "back"];
  controller.activate(host, "front");
  assert.equal(input.activateAt([10, 10], ["front", "middle", "back"], host), "front");
  assert.equal(controller.activePathId, "front");
  assert.equal(input.activateAt([11, 10], ["front", "middle", "back"], host), "middle");
  assert.equal(controller.activePathId, "middle");
  assert.equal(input.activateAt([10, 10], [], host), null);
  assert.equal(controller.activePathId, "middle");
});

test("external selections and frame changes restart the overlap cycle", () => {
  const { host, input } = setup();
  host.paths = ["front", "middle"];
  const ids = ["front", "middle"];
  assert.equal(input.activateAt([10, 10], ids, host), "front");
  assert.equal(input.activateAt([10, 10], ids, host), "middle");
  input.notifyExternalSelection();
  assert.equal(input.activateAt([10, 10], ids, host), "front");
  assert.equal(input.activateAt([10, 10], ids, host), "middle");
  input.notifyFrameChanged();
  assert.equal(input.activateAt([10, 10], ids, host), "front");
});

test("helper guards match the editor focus rules", () => {
  assert.equal(isEditableTarget(null), false);
  assert.equal(isEditableTarget({}), false);
  assert.equal(isEditableTarget({ closest: () => null }), false);
  assert.equal(isEditableTarget({ closest: () => ({}) }), true);
  assert.equal(isComposingEvent(null), false);
  assert.equal(isComposingEvent({ isComposing: true }), true);
  assert.equal(isComposingEvent({ keyCode: 229 }), true);
  assert.equal(isComposingEvent({}), false);
});

test("path input requires a controller", () => {
  assert.throws(() => createPathInput(), /needs a path controller/);
  assert.throws(() => createPathInput({ controller: {} }), /needs a path controller/);
});
