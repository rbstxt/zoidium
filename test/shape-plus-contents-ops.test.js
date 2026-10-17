"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { planAdd, paintScope, contextGroup, uniqueName } = require("../plugins/shape-plus/contents-ops");
const { validate } = require("../plugins/shape-plus/model");
const ids = () => { let n = 0; return () => "n" + ++n; };
const item = (kind, id, extra = {}) => ({ id, kind, properties: {}, ...extra });
const group = (id, contents, properties = {}) => ({ id, kind: "group", properties, contents });
const tree = list => list.map(entry => entry.contents ? [entry.kind, tree(entry.contents)] : entry.kind);
const layer = () => [group("g1", [item("rectangle", "r1"), item("fill", "f1")], { name: "Rectangle 1" }), item("stroke", "s0")];

test("root geometry is wrapped in a new top group with its own fill and a unique name", () => {
  const contents = layer(), nextId = ids();
  const result = planAdd(contents, "rectangle", { nextId });
  assert.equal(contents[0], result.group);
  assert.equal(result.select, result.group.id);
  assert.equal(result.group.properties.name, "Rectangle 2");
  assert.deepEqual(tree(contents[0].contents), ["rectangle", "fill"]);
  assert.equal(result.item, contents[0].contents[0]);
  const path = planAdd(contents, "path", { nextId });
  assert.equal(path.group.properties.name, "Shape 1");
  assert.equal(path.item.vertexIds.length, 4);
  assert.equal(planAdd(contents, "ellipse", { nextId }).group.properties.name, "Ellipse 1");
  assert.equal(uniqueName(contents, "Rectangle"), "Rectangle 3");
  validate(contents);
});

test("geometry goes to the top of the selected group or of the group containing the selection", () => {
  const contents = layer(), nextId = ids();
  const into = planAdd(contents, "ellipse", { nextId, selected: ["g1"] });
  assert.equal(contents[0].contents[0], into.item);
  assert.equal(into.group, contents[0]);
  assert.equal(into.select, into.item.id);
  const beside = planAdd(contents, "polystar", { nextId, selected: ["f1"] });
  assert.equal(contents[0].contents[0], beside.item);
  assert.deepEqual(tree(contents), [["group", ["polystar", "ellipse", "rectangle", "fill"]], "stroke"]);
});

test("paints and modifiers go to the end of the context group; root selection keeps the root", () => {
  const contents = layer();
  const stroke = planAdd(contents, "stroke", { nextId: ids(), selected: ["r1"] });
  assert.equal(contents[0].contents.at(-1), stroke.item);
  assert.equal(stroke.select, stroke.item.id);
  const trim = planAdd(contents, "trim", { nextId: () => "t1", selected: ["g1"] });
  assert.equal(contents[0].contents.at(-1), trim.item);
  const root = planAdd(contents, "fill", { nextId: () => "f9", selected: ["s0", "r1"] });
  assert.equal(contents.at(-1), root.item);
  assert.equal(root.group, null);
  const modifier = planAdd(contents, "repeater", { nextId: () => "rep" });
  assert.equal(contents.at(-1), modifier.item);
});

test("an explicit groupId wins over the selection and must name a group", () => {
  const contents = [group("a", [item("rectangle", "ra")]), group("b", [group("c", [item("path", "pc", { vertexIds: ["v"] })])])];
  const result = planAdd(contents, "rectangle", { nextId: ids(), selected: ["ra"], groupId: "c" });
  assert.equal(contents[1].contents[0].contents[0], result.item);
  const paint = planAdd(contents, "gradientFill", { nextId: () => "gf", groupId: "b" });
  assert.equal(contents[1].contents.at(-1), paint.item);
  assert.throws(() => planAdd(contents, "fill", { nextId: () => "x", groupId: "ra" }), /group/);
  assert.throws(() => planAdd(contents, "fill", { nextId: () => "y", groupId: "missing" }), /group/);
});

test("groupsOnly ignores the parent group of a selected path", () => {
  const contents = layer();
  assert.equal(contextGroup(contents, ["r1"], true), null);
  assert.equal(contextGroup(contents, ["r1", "g1"], true), contents[0]);
  assert.equal(contextGroup(contents, ["s0", "r1"]), null);
  const result = planAdd(contents, "path", { nextId: ids(), selected: ["r1"], groupsOnly: true, point: [5, 6] });
  assert.equal(contents[0], result.group);
  assert.notEqual(result.group.id, "g1");
});

test("a Pen path gets one open vertex, a stroke above a fill and the requested width", () => {
  const contents = [], nextId = ids();
  const result = planAdd(contents, "path", { nextId, point: [10, -20], paints: ["stroke", "fill"], strokeWidth: 3 });
  assert.deepEqual(tree(contents), [["group", ["path", "stroke", "fill"]]]);
  assert.equal(result.group.properties.name, "Shape 1");
  assert.equal(result.item.vertexIds.length, 1);
  assert.equal(result.item.properties.closed, 0);
  assert.deepEqual(result.item.properties.path.keyframes[0].value, [10, -20, 0, 0, 0, 0]);
  assert.equal(result.group.contents[1].properties.width.keyframes[0].value, 3);
  assert.deepEqual(result.group.contents[2].properties, {});
  const rect = planAdd(contents, "rectangle", { nextId, point: [1, 2], paints: [] });
  assert.deepEqual(rect.item.properties.position.keyframes[0].value, [1, 2]);
  assert.deepEqual(tree(rect.group.contents), ["rectangle"]);
  validate(contents);
});

test("paint scope follows the compiler: paths above in the group, including nested groups above", () => {
  const contents = [
    group("outer", [
      group("inner", [item("ellipse", "e1"), item("stroke", "innerStroke")]),
      item("rectangle", "r1"),
      item("fill", "f1"),
      item("path", "below", { vertexIds: ["v"] }),
    ]),
    item("fill", "rootFill"),
    item("polystar", "afterRoot"),
  ];
  const scope = paintScope(contents);
  assert.deepEqual(scope.get("innerStroke"), { paths: 1, enabled: true, targets: ["e1"] });
  assert.deepEqual(scope.get("f1").targets, ["e1", "r1"]);
  assert.deepEqual(scope.get("rootFill").targets, ["e1", "r1", "below"]);
  assert.equal(scope.get("below").painted, true, "the root fill sees a nested group's later path");
  assert.equal(scope.get("afterRoot").painted, false);
  assert.equal(scope.get("e1").painted, true);
  assert.equal(scope.has("outer"), false);
});

test("disabled items, groups and paints contribute nothing", () => {
  const contents = [
    group("off", [item("rectangle", "hidden"), item("fill", "hiddenFill")], { enabled: 0 }),
    item("ellipse", "e", { properties: { enabled: 0 } }),
    item("rectangle", "r"),
    item("stroke", "offStroke", { properties: { enabled: 0 } }),
    item("fill", "f"),
  ];
  const scope = paintScope(contents);
  assert.deepEqual(scope.get("hidden"), { painted: false, enabled: false });
  assert.deepEqual(scope.get("hiddenFill"), { paths: 0, enabled: false, targets: [] });
  assert.deepEqual(scope.get("e"), { painted: false, enabled: false });
  assert.deepEqual(scope.get("offStroke"), { paths: 0, enabled: false, targets: [] });
  assert.deepEqual(scope.get("f").targets, ["r"]);
  assert.equal(scope.get("r").painted, true);
});

test("a paint above its path sees nothing; the path below stays unpainted", () => {
  const scope = paintScope([item("fill", "f"), item("rectangle", "r")]);
  assert.deepEqual(scope.get("f"), { paths: 0, enabled: true, targets: [] });
  assert.equal(scope.get("r").painted, false);
});
