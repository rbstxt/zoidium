"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const install = require("../plugins/graph-plus/axes.js");
const { host, fixture, editorFor } = require("./helpers/editor-identity-host.cjs");
function graph() {
  const c = host(), { PZ } = c;
  const { project } = fixture(c);
  const owner = new PZ.object(); owner.parent = project.sequence;
  owner.properties = new PZ.propertyList({ pos: { name: "Position", dynamic: true, group: true, type: 2,
    objects: ["X", "Y", "Z"].map(name => ({ name, dynamic: true, type: 0, value: 0 })) } }, owner);
  owner.properties.load();
  const vector = owner.properties.pos;
  PZ.ui.graph = function () {};
  install({ PZ });
  const groups = Array.from(vector.objects, prop => {
    prop.keyframes.push(new PZ.keyframe(3, 10, 1));
    const g = { pz_object: prop, style: {}, _keys: { children: [] } };
    g._keys.children = Array.from(prop.keyframes, k => ({ pz_object: k, parentElement: { parentElement: g } }));
    return g;
  });
  const g = Object.assign(new PZ.ui.graph(), { editor: editorFor(PZ, project), options: {}, propGroups: () => groups });
  return { g, groups, vector };
}
test("vector axes have stable identity and colours; operations target selected visible axes", () => {
  const { g, groups, vector } = graph();
  assert.equal(g.axisInfo(vector.objects[1]).axis, "Y");
  assert.equal(g.axisInfo(vector.objects[1]).color, "#81c784");
  g._selectedAxes = new Set([vector.objects[1]]);
  assert.deepEqual(g.editableGroups(), [groups[1]]);
  groups[1].style.display = "none";
  assert.equal(g.editableGroups().length, 0);
});
test("Link axes includes only same-frame siblings and excludes expression channels", () => {
  const { g, groups } = graph();
  const y = groups[1]._keys.children[1];
  assert.deepEqual(g.timeKeys([y]), [y]);
  g.options.linkAxes = true;
  assert.equal(g.timeKeys([y]).length, 3);
  groups[2].pz_object.expression = {};
  assert.equal(g.timeKeys([y]).length, 2);
  groups[0]._keys.children[1].pz_object.frame = 11;
  assert.deepEqual(g.timeKeys([y]), [y]);
});

test("dense-axis move events coalesce to one redraw", async () => {
  const PZ = { ui: { graph: function () {} } };
  require("../plugins/graph-plus/curves.js")({ PZ });
  let redraws = 0;
  const graph = { redrawAllKeyframes: () => redraws++, updateLegend() {} };
  const group = { parentElement: {} };
  for (let i = 0; i < 200; i++) PZ.ui.graph.prototype.onKeyframeMoved.call(graph, group);
  assert.equal(redraws, 0);
  await Promise.resolve();
  assert.equal(redraws, 1);
});

test("tangent toggle undo and redo preserve exact native handle coordinates", () => {
  const c = host(), { PZ } = c;
  const { project, layer } = fixture(c);
  const editor = editorFor(PZ, project);
  const property = layer.properties.position.objects[1], key = property.keyframes[0];
  PZ.ui.graph = function () {};
  require("../plugins/graph-plus/operations.js")({ PZ });
  const graph = { editor, propertyOps: new PZ.ui.properties(editor) };
  const before = JSON.stringify(key);
  editor.history.startOperation();
  PZ.ui.graph.prototype.setContinuousTangentExact.call(graph, property, key, false);
  editor.history.finishOperation();
  const after = JSON.stringify(key);
  assert.equal(editor.history.undoStack.length, 1);
  editor.history.undo(); assert.equal(JSON.stringify(key), before);
  editor.history.redo(); assert.equal(JSON.stringify(key), after);
});

test("vector paste keeps exact property matches, maps sibling axes, and permits a single-axis target", () => {
  const { pasteKey } = require("../plugins/graph-plus/axes.js");
  const data = { "Position.X": [1], "Position.Y": [2], "Rotation.X": [3] };
  assert.equal(pasteKey(data, "Rotation.X", "X", false), "Rotation.X");
  assert.equal(pasteKey(data, "Scale.Y", "Y", false), "Position.Y");
  assert.equal(pasteKey({ "Position.X": [1] }, "Position.Y", "Y", true), "Position.X");
  assert.equal(pasteKey(data, "Scale.Z", "Z", false), null);
});
