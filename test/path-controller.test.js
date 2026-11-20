"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createPathController, TOOLS } = require("../plugins/shape-plus/path-controller.js");

// Small fake host until the P1.6 adapters exist. Only `id` is required;
// every other hook is optional.
function fakeHost(id, pathIds, options = {}) {
  let paths = pathIds.slice();
  const vertices = options.vertices || {};
  const host = {
    id,
    synced: [],
    hasPath(pathId) { return paths.includes(pathId); },
    listPathIds() { return paths.slice(); },
    syncSelection(snapshot) { host.synced.push(snapshot); },
  };
  if (options.noEnum) {
    delete host.hasPath;
    delete host.listPathIds;
  }
  if (options.vertexLists) {
    host.listVertexIds = pathId => (vertices[pathId] || []).slice();
  }
  host.remove = pathId => { paths = paths.filter(id => id !== pathId); };
  host.setPaths = next => { paths = next.slice(); };
  return host;
}

test("exports the pen/select tool contract", () => {
  assert.deepEqual(TOOLS, ["pen", "select"]);
  const controller = createPathController({ project: "p1" });
  assert.equal(controller.tool, "select");
  assert.equal(controller.activePathId, null);
  assert.equal(controller.disposed, false);
});

test("activate validates the host and path", () => {
  const controller = createPathController({ project: "p1" });
  const host = fakeHost("mask:1", ["a"]);
  assert.throws(() => controller.activate({}, "a"), /string id/);
  assert.throws(() => controller.activate(host, ""), /short string/);
  assert.throws(() => controller.activate(host, "missing"), /Unknown path/);
  assert.deepEqual(controller.activate(host, "a"), { hostId: "mask:1", pathId: "a" });
  assert.equal(controller.activePathId, "a");
  assert.equal(controller.activeHost, host);
  assert.deepEqual(host.synced[host.synced.length - 1], { hostId: "mask:1", pathId: "a", vertices: [] });
});

test("setTool switches tools and rejects unknown tools", () => {
  const controller = createPathController({});
  assert.equal(controller.setTool("pen"), "pen");
  assert.equal(controller.setTool("select"), "select");
  assert.throws(() => controller.setTool("brush"), /Unknown path tool/);
});

test("tool switches preserve the active path and vertex selection", () => {
  const controller = createPathController({});
  const host = fakeHost("shape:1", ["a"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1", "v2"]);
  controller.setTool("pen");
  assert.equal(controller.activePathId, "a");
  assert.deepEqual(controller.getSelection(), ["v1", "v2"]);
  controller.setTool("select");
  assert.equal(controller.activePathId, "a");
  assert.deepEqual(controller.getSelection(), ["v1", "v2"]);
});

test("re-selecting the active tool ends transient state but keeps selection", () => {
  const controller = createPathController({});
  const host = fakeHost("shape:1", ["a"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1"]);
  controller.startDrawing();
  controller.setHover({ kind: "anchor", id: "v1" });
  controller.setTool("select");
  assert.equal(controller.drawing, null);
  assert.equal(controller.hover, null);
  assert.deepEqual(controller.getSelection(), ["v1"]);
});

test("selection is keyed by host and path and survives activation switches", () => {
  const controller = createPathController({});
  const masks = fakeHost("mask:1", ["a", "b"]);
  const shapes = fakeHost("shape:7", ["a"]);
  controller.activate(masks, "a");
  controller.setSelection(masks, "a", ["v1"]);
  controller.activate(masks, "b");
  controller.setSelection(masks, "b", ["v9"]);
  controller.activate(shapes, "a");
  controller.setSelection(shapes, "a", ["vx"]);
  controller.activate(masks, "a");
  assert.deepEqual(controller.getSelection(), ["v1"]);
  controller.activate(masks, "b");
  assert.deepEqual(controller.getSelection(), ["v9"]);
  assert.deepEqual(controller.getSelection(shapes, "a"), ["vx"]);
  assert.deepEqual(controller.getSelection(masks, "a"), ["v1"]);
});

test("toggleVertex flips one vertex and keeps the rest", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a"]);
  controller.activate(host, "a");
  assert.equal(controller.toggleVertex(host, "a", "v1"), true);
  assert.equal(controller.toggleVertex(host, "a", "v2"), true);
  assert.equal(controller.toggleVertex(host, "a", "v1"), false);
  assert.deepEqual(controller.getSelection(), ["v2"]);
  assert.throws(() => controller.toggleVertex(host, "a", ""), /short string/);
});

test("setSelection validates input and unknown paths", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a"]);
  assert.throws(() => controller.setSelection(host, "a", "v1"), /array/);
  assert.throws(() => controller.setSelection(host, "a", [""]), /short strings/);
  assert.throws(() => controller.setSelection(host, "missing", ["v1"]), /Unknown path/);
  assert.throws(() => controller.setSelection(null, null, ["v1"]), /host and path/);
});

test("focus changes preserve selection; delete gating follows focus ownership", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1"]);
  assert.equal(controller.ownsFocus(), false);
  controller.claimFocus("path");
  assert.equal(controller.ownsFocus(), true);
  assert.equal(controller.ownsFocus("panel"), false);
  controller.releaseFocus("panel");
  assert.equal(controller.ownsFocus(), true);
  controller.releaseFocus("path");
  assert.equal(controller.ownsFocus(), false);
  assert.deepEqual(controller.getSelection(), ["v1"]);
  assert.equal(controller.activePathId, "a");
  assert.throws(() => controller.claimFocus(""), /short string/);
});

test("deleting the active path clears only its own selection", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a", "b"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1"]);
  controller.setSelection(host, "b", ["v2"]);
  host.remove("a");
  controller.handlePathDeleted(host, "a");
  assert.equal(controller.activePathId, null);
  assert.equal(controller.activeHost, null);
  assert.deepEqual(controller.getSelection(host, "b"), ["v2"]);
  assert.deepEqual(controller.getSelection(host, "a"), []);
});

test("deleting an inactive path keeps the active path and its selection", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a", "b"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1"]);
  controller.setSelection(host, "b", ["v2"]);
  host.remove("b");
  controller.handlePathDeleted(host, "b");
  assert.equal(controller.activePathId, "a");
  assert.deepEqual(controller.getSelection(), ["v1"]);
  assert.deepEqual(controller.getSelection(host, "b"), []);
});

test("undo and reload prune selections against live host paths", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a", "b"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1"]);
  controller.setSelection(host, "b", ["v2"]);
  host.setPaths(["b"]);
  controller.handlePathsChanged(host);
  assert.equal(controller.activePathId, null);
  assert.deepEqual(controller.getSelection(host, "b"), ["v2"]);
  assert.deepEqual(controller.getSelection(host, "a"), []);

  // Other hosts are untouched by the prune.
  const other = fakeHost("shape:1", ["a"]);
  controller.activate(other, "a");
  controller.setSelection(other, "a", ["vx"]);
  host.setPaths(["a", "b"]);
  other.setPaths([]);
  controller.handlePathsChanged(other);
  assert.equal(controller.activePathId, null);
  assert.deepEqual(controller.getSelection(host, "b"), ["v2"]);
});

test("vertex selections resolve against live vertex ids on read", () => {
  const host = fakeHost("mask:1", ["a"], { vertexLists: true, vertices: { a: ["v1", "v2"] } });
  const controller = createPathController({});
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1", "v2", "stale"]);
  assert.deepEqual(controller.getSelection(), ["v1", "v2"]);
});

test("deactivate keeps stored selections for later activation", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1"]);
  controller.deactivate();
  assert.equal(controller.activePathId, null);
  controller.activate(host, "a");
  assert.deepEqual(controller.getSelection(), ["v1"]);
});

test("a project change resets state; the same project keeps it", () => {
  const controller = createPathController({ project: "p1" });
  const host = fakeHost("mask:1", ["a"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1"]);
  controller.setTool("pen");
  controller.claimFocus("path");
  assert.equal(controller.handleProjectChanged("p1"), false);
  assert.equal(controller.activePathId, "a");
  assert.deepEqual(controller.getSelection(), ["v1"]);
  assert.equal(controller.handleProjectChanged("p2"), true);
  assert.equal(controller.activePathId, null);
  assert.equal(controller.tool, "select");
  assert.equal(controller.focusOwner, null);
  assert.deepEqual(controller.getSelection(host, "a"), []);
});

test("reset clears drawing, hover, gesture, focus and every selection", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1"]);
  controller.startDrawing();
  controller.addDrawingPoint([1, 2]);
  controller.setHover({ kind: "segment" });
  controller.beginGesture({ kind: "drag" });
  controller.claimFocus("path");
  controller.reset();
  assert.equal(controller.activePathId, null);
  assert.equal(controller.drawing, null);
  assert.equal(controller.hover, null);
  assert.equal(controller.gesture, null);
  assert.equal(controller.focusOwner, null);
  assert.equal(controller.tool, "select");
});

test("drawing state accumulates points and finishes or cancels", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a"]);
  controller.activate(host, "a");
  assert.equal(controller.finishDrawing(), null);
  assert.equal(controller.cancelDrawing(), false);
  controller.startDrawing();
  assert.equal(controller.addDrawingPoint([3, 4]), 1);
  assert.equal(controller.addDrawingPoint([5, 6]), 2);
  assert.throws(() => controller.addDrawingPoint([NaN, 1]), /two finite numbers/);
  const finished = controller.finishDrawing();
  assert.deepEqual(finished.points, [[3, 4], [5, 6]]);
  assert.deepEqual(finished, { hostId: "mask:1", pathId: "a", points: [[3, 4], [5, 6]], startedAt: finished.startedAt });
  assert.equal(controller.drawing, null);
  controller.startDrawing();
  assert.equal(controller.cancelDrawing(), true);
  assert.equal(controller.drawing, null);
  controller.deactivate();
  assert.throws(() => controller.startDrawing(), /active path/);
});

test("activating another path cancels in-progress drawing", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a", "b"]);
  controller.activate(host, "a");
  controller.startDrawing();
  controller.activate(host, "b");
  assert.equal(controller.drawing, null);
  assert.equal(controller.activePathId, "b");
});

test("hover and gesture state round-trips and ends on tool switch", () => {
  const controller = createPathController({});
  controller.setHover({ kind: "anchor", id: "v1" });
  assert.deepEqual(controller.hover, { kind: "anchor", id: "v1" });
  controller.clearHover();
  assert.equal(controller.hover, null);
  controller.beginGesture({ kind: "marquee" });
  assert.deepEqual(controller.gesture, { kind: "marquee" });
  assert.throws(() => controller.beginGesture(null), /object/);
  const ended = controller.endGesture();
  assert.deepEqual(ended, { kind: "marquee", cancelled: false });
  assert.equal(controller.gesture, null);
  assert.equal(controller.endGesture(), null);
  controller.beginGesture({ kind: "drag" });
  controller.setTool("pen");
  assert.equal(controller.gesture, null);
});

test("hosts without enumeration hooks still activate and select", () => {
  const controller = createPathController({});
  const host = fakeHost("plain:1", [], { noEnum: true });
  controller.activate(host, "any");
  controller.setSelection(host, "any", ["v1"]);
  assert.deepEqual(controller.getSelection(), ["v1"]);
  controller.handlePathsChanged(host);
  assert.equal(controller.activePathId, "any");
});

test("dispose clears state and rejects further mutations", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1"]);
  controller.dispose();
  assert.equal(controller.disposed, true);
  assert.equal(controller.activePathId, null);
  assert.throws(() => controller.setTool("pen"), /disposed/);
  assert.throws(() => controller.activate(host, "a"), /disposed/);
  assert.throws(() => controller.setSelection(host, "a", ["v1"]), /disposed/);
  controller.dispose();
});

test("clearPathSelection and clearAllSelections keep sibling state", () => {
  const controller = createPathController({});
  const host = fakeHost("mask:1", ["a", "b"]);
  controller.activate(host, "a");
  controller.setSelection(host, "a", ["v1"]);
  controller.setSelection(host, "b", ["v2"]);
  controller.clearPathSelection(host, "b");
  assert.deepEqual(controller.getSelection(), ["v1"]);
  assert.deepEqual(controller.getSelection(host, "b"), []);
  controller.clearAllSelections();
  assert.deepEqual(controller.getSelection(), []);
});
