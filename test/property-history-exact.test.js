"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { host, fixture, editorFor } = require("./helpers/editor-identity-host.cjs");

function setup() {
  const context = host(), { PZ } = context;
  vm.runInContext(fs.readFileSync("plugins/core/property-history.js", "utf8"), context);
  const { project, layer } = fixture(context), editor = editorFor(PZ, project);
  const group = layer.properties.position;
  for (const [i, property] of Array.from(group.objects).entries()) {
    property.animated = true;
    property.keyframes.push(new PZ.keyframe(10 + i, 24 + i, 1));
  }
  return { ...context, project, editor, group, ops: new PZ.ui.properties(editor) };
}
function roundTrip(s, work) {
  const before = JSON.stringify(s.project);
  s.editor.history.startOperation(); work(); s.editor.history.finishOperation();
  const after = JSON.stringify(s.project);
  assert.notEqual(after, before);
  assert.equal(s.editor.history.undoStack.length, 1);
  s.editor.history.undo(); assert.equal(JSON.stringify(s.project), before);
  s.editor.history.redo(); assert.equal(JSON.stringify(s.project), after);
}
for (const group of [false, true]) for (const expression of [false, true]) {
  test(`native value history restores stored ${group ? "group" : "scalar"} values with expression=${expression}`, () => {
    const s = setup(), p = group ? s.group : s.group.objects[0];
    if (expression) p.expression = new s.PZ.expression(group ? "[100,200,300]" : "100");
    roundTrip(s, () => s.ops.setValue({ property: p.getAddress(), frame: 12, value: group ? [20,30,40] : 20 }));
  });
}
test("live previews retain an independent stored value before the first write", () => {
  const s = setup(), p = s.group;
  const oldValue = s.PZ.ui.properties.getStoredValue(p, 12);
  roundTrip(s, () => {
    p.set([20,30,40], 12); p.set([30,40,50], 12);
    s.ops.setValue({ property: p.getAddress(), frame: 12, value: [40,50,60], oldValue });
  });
});
test("native startEdit still creates one undoable key between existing keys", () => {
  const s = setup(), p = s.group.objects[0];
  roundTrip(s, () => { s.ops.startEdit(p, 12); s.ops.setValue({ property: p.getAddress(), frame: 12, value: 20 }); });
  assert.equal(p.keyframes.length, 3);
});
