"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const { harness, clone } = require("./text-plus-2d-harness.js");
const { install } = require("../plugins/text-plus/text-plus-2d.js");
const { host, editorFor } = require("./helpers/editor-identity-host.cjs");

test("2D character mode and rotation replay through native history after disabling Text+", async () => {
  const h = harness(), layer = h.add(), dispose = install(h), PZ = host().PZ;
  const project = new PZ.project(), editor = editorFor(PZ, project);
  project.addressLookup = address => layer.addressLookup(address);
  const first = layer.textPlusCharacterStack[0], ops = new PZ.ui.properties(editor);
  function edit(property, value) {
    editor.history.startOperation();
    ops.setValue({ property: property.getAddress(), frame: 0, value });
    editor.history.finishOperation();
  }
  try {
    edit(first.mode, 1);
    edit(first.charRotation, 0.75);
    assert.equal(editor.history.undoStack.length, 2);
    const saved = clone(layer).zoidiumTextPlus2D;
    dispose();
    editor.history.undo();
    assert.equal(first.charRotation.get(0), 0);
    editor.history.undo();
    assert.equal(first.mode.get(0), 0);
    editor.history.redo(); editor.history.redo();
    assert.equal(first.mode.get(0), 1);
    assert.equal(first.charRotation.get(0), 0.75);
    assert.deepEqual(clone(layer).zoidiumTextPlus2D, saved);
    await Promise.resolve();
  } finally { dispose(); }
});
