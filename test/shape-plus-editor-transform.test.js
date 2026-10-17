"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { PZ } = require("./shape-plus-host.js");
const { createModel } = require("../plugins/shape-plus/model.js");
const { scene } = require("../plugins/shape-plus/editor-canvas.js");
const { find } = require("../plugins/shape-plus/editor-tree-data.js");
const { transform, matrix } = require("../plugins/shape-plus/compiler.js");
const { pickTarget, parentOf } = require("../plugins/shape-plus/editor-pick.js");
const xf = require("../plugins/shape-plus/editor-transform.js");
PZ.property.prototype.set = function (value, frame) {
  if (this.objects) this.objects.forEach((p, i) => p.set(value[i], frame));
  else if (this.data) this.data.keyframes[0].value = value;
  else this.value = value;
};
const close = (actual, expected, message) =>
  [].concat(expected).forEach((v, i) => assert.ok(Math.abs([].concat(actual)[i] - v) < 1e-6, `${message}: ${actual} vs ${expected}`));
// Group "outer" (position 100,0) holds group "inner" (rect + fill) and a path.
function host() {
  const { Content } = createModel(PZ);
  const layer = { contents: new PZ.objectList(null, Content) };
  const data = [{ id: "outer", kind: "group", properties: { position: { animated: false, keyframes: [{ frame: 0, value: [100, 0], tween: 1 }] } }, contents: [
    { id: "inner", kind: "group", properties: {}, contents: [
      { id: "rect", kind: "rectangle", properties: {} },
      { id: "fill", kind: "fill", properties: {} },
    ] },
    { id: "path", kind: "path", vertexIds: ["a", "b", "c", "d"], properties: {} },
  ] }];
  for (const item of data) { const node = new Content(item.kind, item); layer.contents.push(node); node.load(item); }
  // CSS = 1:1 with Shape+ space, Y flipped, origin at (500, 300).
  const projection = [1, 0, 0, -1, 500, 300];
  const s = {
    layer, treeSelection: new Set(), activeId: null, refreshes: 0,
    localFrame: () => 0,
    find: id => find(layer.contents, id)?.item || null,
    refresh() { this.refreshes++; },
    setValue: (property, value, frame) => property.set(value, frame),
    gesture: { active: false, begin() { this.active = true; return true; }, finish() { this.active = false; } },
    canvasApi: { projection: () => projection, entries: () => scene(layer.contents, 0) },
  };
  return { s, layer, projection };
}
const at = (x, y) => ({ clientX: x, clientY: y, shiftKey: false, altKey: false });
const point = e => [e.clientX, e.clientY];
test("clicks pick the outermost group first, then keep or drill within the selection", () => {
  const { layer } = host();
  assert.equal(pickTarget(layer.contents, "rect", new Set()), "outer");
  assert.equal(pickTarget(layer.contents, "rect", new Set(["outer"])), "outer");
  assert.equal(pickTarget(layer.contents, "rect", new Set(["inner"])), "inner");
  // A selected sibling at depth 1 makes the click pick the hit item's depth-1 ancestor.
  assert.equal(pickTarget(layer.contents, "rect", new Set(["path"])), "inner");
  assert.equal(pickTarget(layer.contents, "path", new Set(["inner"])), "path");
  assert.equal(parentOf(layer.contents, "rect"), "inner");
  assert.equal(parentOf(layer.contents, "outer"), null);
});
test("a group's box is measured in its own contents space and exposes scale and rotate handles", () => {
  const { s } = host();
  const b = xf.box(s, "outer");
  close(b.min, [-100, -100], "min");
  close(b.max, [100, 100], "max");
  close(transform(xf.at(b, 0, 0), b.screen), [600, 300], "screen center");
  const list = xf.handles(b);
  assert.equal(list.filter(h => h.rotate).length, 1);
  assert.equal(list.filter(h => !h.rotate).length, 8);
  assert.equal(xf.handles(xf.box(s, "path")).length, 0);
});
test("corner scaling keeps the opposite corner fixed in the parent space", () => {
  const { s, layer } = host();
  s.treeSelection = new Set(["outer"]);
  // Top-right corner of the box (local 100,100) is CSS (700, 200).
  const handle = xf.handleAt(s, [700, 200]);
  assert.ok(handle && !handle.rotate);
  const gesture = xf.boxGesture(s, handle, [700, 200], point);
  gesture.move(at(900, 0));
  gesture.end();
  const group = layer.contents[0].evaluate(0).properties;
  close(group.scale, [2, 2], "scale");
  const m = matrix(group);
  close(transform([-100, -100], m), [0, -100], "opposite corner");
  close(transform([100, 100], m), [400, 300], "dragged corner follows the pointer");
});
test("Alt scales about the center and Shift keeps proportions", () => {
  const { s, layer } = host();
  s.treeSelection = new Set(["outer"]);
  const handle = xf.handleAt(s, [700, 200]);
  const gesture = xf.boxGesture(s, handle, [700, 200], point);
  gesture.move({ ...at(800, 100), altKey: true });
  close(layer.contents[0].evaluate(0).properties.scale, [2, 2], "alt scale");
  close(layer.contents[0].evaluate(0).properties.position, [100, 0], "alt keeps the center");
  gesture.move({ ...at(900, 150), shiftKey: true });
  const scale = layer.contents[0].evaluate(0).properties.scale;
  assert.ok(Math.abs(scale[0] - scale[1]) < 1e-9);
  gesture.end();
});
test("rotation turns a group about its box center", () => {
  const { s, layer } = host();
  s.treeSelection = new Set(["outer"]);
  const handle = xf.handles(xf.box(s, "outer")).find(h => h.rotate);
  const gesture = xf.boxGesture(s, { box: xf.box(s, "outer"), ...handle }, handle.point, point);
  // From straight above the center to straight left of it: +90 degrees.
  gesture.move(at(600 - 200, 300));
  gesture.end();
  const group = layer.contents[0].evaluate(0).properties;
  close(group.rotation, Math.PI / 2, "rotation");
  close(transform([0, 0], matrix(group)), [100, 0], "center stays put");
});
test("rectangle corners resize from the opposite corner", () => {
  const { s, layer } = host();
  s.treeSelection = new Set(["rect"]);
  // Rect box in the inner group's space; outer moves it by (100, 0). Top-left
  // corner (-100, 100) is CSS (500, 200); the opposite corner (100,-100) stays.
  const handle = xf.handleAt(s, [500, 200]);
  assert.ok(handle);
  const gesture = xf.boxGesture(s, handle, [500, 200], point);
  gesture.move(at(450, 150));
  gesture.end();
  const rect = find(layer.contents, "rect").item.evaluate(0).properties;
  close(rect.size, [250, 250], "size");
  close(rect.position, [-25, 25], "position");
});
test("dragging moves every selected item in its own parent space and paths move their vertices", () => {
  const { s, layer } = host();
  const gesture = xf.moveGesture(s, [600, 300], point, ["outer", "rect", "path"]);
  gesture.move(at(601, 300));
  assert.equal(s.gesture.active, false, "a 1 px wobble is not a drag");
  gesture.move(at(610, 280));
  gesture.end();
  close(layer.contents[0].evaluate(0).properties.position, [110, 20], "outer");
  // Descendants of a selected group are carried by the group, not moved twice.
  close(find(layer.contents, "rect").item.evaluate(0).properties.position, [0, 0], "rect");
  close(find(layer.contents, "path").item.evaluate(0).properties.path.slice(0, 2), [-100, -100], "path");
  const solo = xf.moveGesture(s, [0, 0], point, ["path"]);
  solo.move(at(10, -5));
  solo.end();
  close(find(layer.contents, "path").item.evaluate(0).properties.path.slice(0, 2), [-90, -95], "path vertex");
  assert.ok(xf.nudge(s, ["rect"], [0, 10]));
  close(find(layer.contents, "rect").item.evaluate(0).properties.position, [0, 10], "nudge");
  assert.equal(xf.nudge(s, ["fill"], [1, 0]), false, "paints are not movable");
});
