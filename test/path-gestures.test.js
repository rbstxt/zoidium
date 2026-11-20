"use strict";
// Interaction gestures: transform drags over selected points, direct
// segment drag, context-menu requests, Space-pan and wheel-zoom handoff,
// pointer capture, Escape/frame-change cancellation, and inverse-mapping
// failures. Drives the real controller, input, projection, transform, and
// feedback modules; only the store, viewport, and selection/menu sinks are
// faked. Pointer binding uses the Shape+ editor pointer fake
// (`test/shape-plus-editor-pointer.test.js`).
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createPathController } = require("../plugins/shape-plus/path-controller.js");
const { createPathInput } = require("../plugins/shape-plus/path-input.js");
const { createPathGestures, segmentEndpoints } = require("../plugins/shape-plus/path-gestures.js");

// Pointer fake from the Shape+ editor tests: an EventTarget with capture
// tracking and a fire helper for dispatching pointer/keyboard events.
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

const vertex = (id, point) => ({ id, point, in: [0, 0], out: [0, 0] });
const copy = (value) => JSON.parse(JSON.stringify(value));

function makeWorld({ paths, selection = {}, guides = [] } = {}) {
  const world = {
    data: copy(paths),
    sel: copy(selection),
    guideList: guides,
    commits: [],
    previews: [],
    restored: [],
    selects: [],
    messages: [],
    menus: [],
    pans: [],
    zooms: [],
    store: null,
    viewport: null,
  };
  world.store = {
    paths: () => world.data,
    selection: () => copy(world.sel),
    projection: () => null,
    guides: () => world.guideList,
    snapshot: () => JSON.stringify(world.data),
    restore: (token) => {
      world.restored.push(token);
      world.data = JSON.parse(token);
    },
    preview: (edited) => {
      world.previews.push(copy(edited));
      for (const entry of edited) {
        const path = world.data.find((item) => item.id === entry.id);
        if (path) path.vertices = copy(entry.vertices);
      }
    },
    commit: (label) => {
      world.commits.push(label);
    },
  };
  world.viewport = {
    panBy: (dx, dy) => {
      world.pans.push([dx, dy]);
    },
    zoomAt: (point, factor) => {
      world.zooms.push([point, factor]);
    },
  };
  return world;
}

function makeGestures(world, extra = {}) {
  const controller = createPathController({ project: "p", viewport: "v" });
  const input = createPathInput({ controller });
  const gestures = createPathGestures({
    controller,
    input,
    store: world.store,
    viewport: world.viewport,
    onMessage: (text) => {
      world.messages.push(text);
    },
    onSelect: (payload) => {
      world.selects.push(payload);
      if (payload.type === "click" && !payload.toggle) world.sel = { [payload.pathId]: [payload.vertexIndex] };
      else if (payload.type === "click" && payload.toggle) {
        const list = new Set(world.sel[payload.pathId] || []);
        if (list.has(payload.vertexIndex)) list.delete(payload.vertexIndex);
        else list.add(payload.vertexIndex);
        world.sel[payload.pathId] = [...list];
      } else if (payload.type === "marquee" && payload.replace) world.sel = payload.selection;
      else if (payload.type === "segment") world.sel = { [payload.pathId]: payload.vertexIndices.slice() };
    },
    onContextMenu: (request) => {
      world.menus.push(request);
    },
    ...extra,
  });
  return { controller, input, gestures };
}

const twoPoints = () => [
  { id: "p", vertices: [vertex("v0", [10, 10]), vertex("v1", [50, 50]), vertex("v2", [100, 100])], closed: false, matrix: null, locked: false },
];

test("press on a selected anchor starts a captured move gesture", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  const outcome = gestures.press([11, 12], { pointerId: 7 });
  assert.equal(outcome.action, "move");
  assert.equal(outcome.capture, true);
  assert.equal(outcome.pointerId, 7);
  assert.equal(gestures.active.kind, "move");
  assert.equal(world.selects.length, 0);
});

test("a move drag previews the edit and release commits one history entry", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  gestures.press([10, 10], { pointerId: 1 });
  const moved = gestures.move([30, 40], { pointerId: 1 });
  assert.equal(moved.action, "move");
  assert.equal(moved.applied, true);
  assert.equal(world.previews.length, 1);
  assert.deepEqual(world.data[0].vertices[0].point, [30, 40]);
  assert.deepEqual(world.data[0].vertices[1].point, [50, 50]);
  const released = gestures.release([30, 40], { pointerId: 1 });
  assert.deepEqual(released, { action: "commit", committed: true, releaseCapture: true, pointerId: 1 });
  assert.deepEqual(world.commits, ["transform-points"]);
  assert.equal(gestures.active, null);
});

test("pressing an unselected anchor selects it first, then drags", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  const outcome = gestures.press([51, 50], { pointerId: 1 });
  assert.equal(outcome.action, "move");
  assert.equal(outcome.activated, true);
  assert.deepEqual(world.selects, [{ type: "click", pathId: "p", vertexIndex: 1, toggle: false }]);
  gestures.move([70, 80], { pointerId: 1 });
  assert.deepEqual(world.data[0].vertices[1].point, [69, 80]);
  assert.deepEqual(world.data[0].vertices[0].point, [10, 10]);
});

test("shift-click toggles without starting a gesture or capturing", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  const outcome = gestures.press([51, 50], { pointerId: 1, shiftKey: true });
  assert.equal(outcome.action, "toggle-only");
  assert.equal(outcome.capture, false);
  assert.equal(gestures.active, null);
  assert.deepEqual(world.selects, [{ type: "click", pathId: "p", vertexIndex: 1, toggle: true }]);
  assert.deepEqual(world.commits, []);
});

test("a drag snaps to a nearby unselected vertex", () => {
  const world = makeWorld({
    paths: [
      { id: "p", vertices: [vertex("v0", [10, 10]), vertex("v1", [40, 40]), vertex("v2", [100, 100])], closed: false, matrix: null, locked: false },
    ],
    selection: { p: [0] },
  });
  const { gestures } = makeGestures(world);
  gestures.press([10, 10], { pointerId: 1 });
  const moved = gestures.move([38, 38], { pointerId: 1 });
  assert.equal(moved.applied, true);
  assert.equal(moved.snapped, true);
  assert.deepEqual(world.data[0].vertices[0].point, [40, 40]);
});

test("shift constrains the drag direction before snapping", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  gestures.press([10, 10], { pointerId: 1 });
  gestures.move([15, 11], { pointerId: 1, shiftKey: true });
  assert.deepEqual(world.data[0].vertices[0].point[1], 10);
});

test("a press on a locked path activates without dragging or capturing", () => {
  const locked = [
    { id: "p", vertices: [vertex("v0", [10, 10]), vertex("v1", [50, 50])], closed: false, matrix: null, locked: true },
  ];
  const world = makeWorld({ paths: locked, selection: {} });
  const { gestures } = makeGestures(world);
  const outcome = gestures.press([10, 10], { pointerId: 1 });
  assert.equal(outcome.action, "activate");
  assert.equal(outcome.locked, true);
  assert.equal(outcome.capture, false);
  assert.equal(gestures.active, null);
  assert.deepEqual(world.selects, [{ type: "activate", pathId: "p" }]);
  assert.deepEqual(world.commits, []);
});

test("a locked path still serves as a snap target while staying untouched", () => {
  const world = makeWorld({
    paths: [
      { id: "free", vertices: [vertex("v0", [10, 10])], closed: false, matrix: null, locked: false },
      { id: "fixed", vertices: [vertex("w0", [40, 40])], closed: false, matrix: null, locked: true },
    ],
    selection: { free: [0] },
  });
  const { gestures } = makeGestures(world);
  gestures.press([10, 10], { pointerId: 1 });
  const moved = gestures.move([38, 38], { pointerId: 1 });
  assert.equal(moved.applied, true);
  assert.equal(moved.snapped, true);
  assert.deepEqual(world.data[0].vertices[0].point, [40, 40]);
  assert.deepEqual(world.data[1].vertices[0].point, [40, 40]);
  gestures.release([40, 40], { pointerId: 1 });
  assert.deepEqual(world.commits, ["transform-points"]);
});

test("a press without movement releases with no history entry", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  gestures.press([10, 10], { pointerId: 1 });
  const released = gestures.release([10, 10], { pointerId: 1 });
  assert.equal(released.action, "end");
  assert.equal(released.committed, false);
  assert.deepEqual(world.commits, []);
  assert.deepEqual(world.previews, []);
});

test("direct segment drag moves both endpoints together", () => {
  const world = makeWorld({
    paths: [{ id: "p", vertices: [vertex("v0", [0, 0]), vertex("v1", [40, 0])], closed: false, matrix: null, locked: false }],
    selection: {},
  });
  const { gestures } = makeGestures(world);
  const outcome = gestures.press([20, 0], { pointerId: 1 });
  assert.equal(outcome.action, "segment");
  assert.equal(outcome.capture, true);
  assert.deepEqual(outcome.vertexIndices, [0, 1]);
  gestures.move([20, 10], { pointerId: 1 });
  assert.deepEqual(world.data[0].vertices[0].point, [0, 10]);
  assert.deepEqual(world.data[0].vertices[1].point, [40, 10]);
  const released = gestures.release([20, 10], { pointerId: 1 });
  assert.equal(released.action, "commit");
  assert.deepEqual(world.commits, ["drag-segment"]);
});

test("segmentEndpoints wraps the last segment of closed paths", () => {
  assert.deepEqual(segmentEndpoints({ vertices: [{}, {}, {}], closed: true }, 2), [2, 0]);
  assert.deepEqual(segmentEndpoints({ vertices: [{}, {}], closed: false }, 0), [0, 1]);
  assert.equal(segmentEndpoints({ vertices: [{}], closed: false }, 0), null);
});

test("context menu on an anchor requests Set First Vertex", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  const request = gestures.requestContextMenu([11, 11]);
  assert.deepEqual(request, {
    action: "set-first-vertex",
    pathId: "p",
    vertexIndex: 0,
    vertexId: "v0",
    locked: false,
  });
  assert.deepEqual(world.menus, [request]);
});

test("context menu on segments and empty canvas requests nothing", () => {
  const world = makeWorld({
    paths: [{ id: "p", vertices: [vertex("v0", [0, 0]), vertex("v1", [40, 0])], closed: false, matrix: null, locked: false }],
  });
  const { gestures } = makeGestures(world);
  assert.equal(gestures.requestContextMenu([20, 0]), null);
  assert.equal(gestures.requestContextMenu([500, 500]), null);
  assert.deepEqual(world.menus, []);
});

test("context menu reports locked vertices for the menu to disable", () => {
  const world = makeWorld({
    paths: [{ id: "p", vertices: [vertex("v0", [10, 10])], closed: false, matrix: null, locked: true }],
  });
  const { gestures } = makeGestures(world);
  const request = gestures.requestContextMenu([10, 10]);
  assert.equal(request.action, "set-first-vertex");
  assert.equal(request.locked, true);
});

test("space-drag pans through the viewport and restores the prior tool", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { controller, gestures } = makeGestures(world);
  controller.setTool("pen");
  gestures.setSpaceHeld(true);
  const outcome = gestures.press([100, 100], { pointerId: 3 });
  assert.equal(outcome.action, "pan");
  assert.equal(outcome.capture, true);
  gestures.move([120, 110], { pointerId: 3 });
  gestures.move([130, 125], { pointerId: 3 });
  assert.deepEqual(world.pans, [
    [20, 10],
    [10, 15],
  ]);
  const released = gestures.release([130, 125], { pointerId: 3 });
  assert.equal(released.action, "end-pan");
  assert.equal(released.releaseCapture, true);
  assert.equal(controller.tool, "pen");
  assert.deepEqual(world.commits, []);
});

test("blur during a pan ends it and restores the tool", () => {
  const world = makeWorld({ paths: twoPoints() });
  const { controller, gestures } = makeGestures(world);
  controller.setTool("pen");
  gestures.setSpaceHeld(true);
  gestures.press([50, 50], { pointerId: 1 });
  const blurred = gestures.handleBlur();
  assert.equal(blurred.action, "end-pan");
  assert.equal(controller.tool, "pen");
  assert.equal(gestures.active, null);
});

test("wheel zooms at the pointer through the viewport", () => {
  const world = makeWorld({ paths: twoPoints() });
  const { gestures } = makeGestures(world);
  const outcome = gestures.wheel([80, 60], -120);
  assert.equal(outcome.action, "zoom");
  assert.ok(outcome.factor > 1);
  assert.deepEqual(world.zooms.length, 1);
  assert.deepEqual(world.zooms[0][0], [80, 60]);
  assert.equal(world.zooms[0][1], outcome.factor);
});

test("pen presses ignore empty canvas for the drawing layer, except pan", () => {
  const world = makeWorld({ paths: twoPoints() });
  const { controller, gestures } = makeGestures(world);
  controller.setTool("pen");
  const outcome = gestures.press([500, 500], { pointerId: 1 });
  assert.equal(outcome.action, "ignore");
  assert.equal(gestures.active, null);
});

test("Escape cancels a dirty drag and restores the snapshot", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { controller, gestures } = makeGestures(world);
  gestures.press([10, 10], { pointerId: 1 });
  gestures.move([30, 40], { pointerId: 1 });
  assert.notDeepEqual(world.data[0].vertices[0].point, [10, 10]);
  assert.equal(gestures.handleEscape(), true);
  assert.deepEqual(world.data[0].vertices[0].point, [10, 10]);
  assert.deepEqual(world.commits, []);
  assert.equal(controller.gesture, null);
  assert.equal(gestures.active, null);
  assert.equal(gestures.handleEscape(), false);
});

test("a frame change cancels the gesture instead of committing it elsewhere", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { controller, gestures } = makeGestures(world);
  gestures.press([10, 10], { pointerId: 1 });
  gestures.move([30, 40], { pointerId: 1 });
  const outcome = gestures.notifyFrameChanged();
  assert.equal(outcome.action, "cancel-frame");
  assert.equal(outcome.releaseCapture, true);
  assert.deepEqual(world.data[0].vertices[0].point, [10, 10]);
  assert.deepEqual(world.commits, []);
  assert.equal(controller.gesture, null);
  assert.ok(world.messages.some((text) => /frame changed/i.test(text)));
});

test("a singular mapping mid-drag fails in English and moves nothing", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  gestures.press([10, 10], { pointerId: 1 });
  world.data[0].matrix = [0, 0, 0, 0, 0, 0];
  const before = copy(world.data);
  const moved = gestures.move([30, 40], { pointerId: 1 });
  assert.equal(moved.action, "move");
  assert.equal(moved.applied, false);
  assert.deepEqual(world.data, before);
  assert.deepEqual(world.previews, []);
  assert.ok(world.messages.some((text) => /singular/i.test(text)));
  const released = gestures.release([30, 40], { pointerId: 1 });
  assert.equal(released.committed, false);
  assert.deepEqual(world.commits, []);
});

test("empty-space drag reports a marquee selection on release", () => {
  const world = makeWorld({ paths: twoPoints(), selection: {} });
  const { gestures } = makeGestures(world);
  const outcome = gestures.press([200, 200], { pointerId: 1 });
  assert.equal(outcome.action, "marquee");
  assert.equal(outcome.capture, true);
  const moved = gestures.move([60, 60], { pointerId: 1 });
  assert.deepEqual(moved.rect, { start: [200, 200], end: [60, 60] });
  const released = gestures.release([60, 60], { pointerId: 1 });
  assert.equal(released.action, "select-marquee");
  assert.deepEqual(world.sel, { p: [2] });
});

test("cursor priority covers pan, pen, select, and marquee states", () => {
  const world = makeWorld({ paths: twoPoints() });
  const { controller, gestures } = makeGestures(world);
  gestures.setSpaceHeld(true);
  assert.equal(gestures.cursorFor({}).cursor, "pan");
  gestures.setSpaceHeld(false);
  controller.setTool("pen");
  assert.equal(gestures.cursorFor({ target: null }).cursor, "pen-canvas-start");
  assert.equal(
    gestures.cursorFor({ target: { kind: "segment", segmentIndex: 0 } }).cursor,
    "pen-segment-add",
  );
  controller.setTool("select");
  assert.equal(gestures.cursorFor({ target: null }).cursor, "select");
  gestures.press([200, 200], { pointerId: 1 });
  assert.equal(gestures.cursorFor({ target: null }).cursor, "select-marquee");
  gestures.cancel();
});

test("binding captures the pointer and releases it on up", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  const element = new Target(),
    owner = new Target();
  element.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const unbind = gestures.bind(element, owner);
  element.fire("pointerdown", 1, { clientX: 10, clientY: 10 });
  assert.deepEqual([...element.captured], [1]);
  assert.equal(gestures.active.kind, "move");
  element.fire("pointermove", 1, { clientX: 30, clientY: 40, buttons: 1 });
  assert.deepEqual(world.data[0].vertices[0].point, [30, 40]);
  element.fire("pointerup", 1, { clientX: 30, clientY: 40 });
  assert.deepEqual(world.commits, ["transform-points"]);
  assert.deepEqual([...element.captured], []);
  assert.equal(gestures.active, null);
  unbind();
});

test("binding ignores a secondary pointer while a gesture is open", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  const element = new Target(),
    owner = new Target();
  element.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const unbind = gestures.bind(element, owner);
  element.fire("pointerdown", 1, { clientX: 10, clientY: 10 });
  element.fire("pointerdown", 2, { clientX: 60, clientY: 60 });
  element.fire("pointermove", 2, { clientX: 90, clientY: 90, buttons: 1 });
  assert.deepEqual(world.data[0].vertices[0].point, [10, 10]);
  element.fire("pointerup", 1, { clientX: 10, clientY: 10 });
  assert.deepEqual(world.commits, []);
  unbind();
});

test("pointer cancel keeps the preview and commits it once", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  const element = new Target(),
    owner = new Target();
  element.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const unbind = gestures.bind(element, owner);
  element.fire("pointerdown", 1, { clientX: 10, clientY: 10 });
  element.fire("pointermove", 1, { clientX: 30, clientY: 40, buttons: 1 });
  element.fire("pointercancel", 1);
  assert.deepEqual(world.data[0].vertices[0].point, [30, 40]);
  assert.deepEqual(world.commits, ["transform-points"]);
  assert.deepEqual([...element.captured], []);
  unbind();
});

test("lost capture and blur commit the preview like other interruptions", () => {
  for (const interruption of ["lostpointercapture", "blur"]) {
    const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
    const { gestures } = makeGestures(world);
    const element = new Target(),
      owner = new Target();
    element.getBoundingClientRect = () => ({ left: 0, top: 0 });
    const unbind = gestures.bind(element, owner);
    element.fire("pointerdown", 1, { clientX: 10, clientY: 10 });
    element.fire("pointermove", 1, { clientX: 30, clientY: 40, buttons: 1 });
    if (interruption === "blur") owner.fire("blur");
    else element.fire("lostpointercapture", 1);
    assert.deepEqual(world.data[0].vertices[0].point, [30, 40], interruption);
    assert.deepEqual(world.commits, ["transform-points"], interruption);
    unbind();
  }
});

test("Escape through the binding restores the snapshot", () => {
  const world = makeWorld({ paths: twoPoints(), selection: { p: [0] } });
  const { gestures } = makeGestures(world);
  const element = new Target(),
    owner = new Target();
  element.getBoundingClientRect = () => ({ left: 0, top: 0 });
  const unbind = gestures.bind(element, owner);
  element.fire("pointerdown", 1, { clientX: 10, clientY: 10 });
  element.fire("pointermove", 1, { clientX: 30, clientY: 40, buttons: 1 });
  element.fire("keydown", 1, { key: "Escape" });
  assert.deepEqual(world.data[0].vertices[0].point, [10, 10]);
  assert.deepEqual(world.commits, []);
  assert.deepEqual([...element.captured], []);
  unbind();
});
