"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host, editorFor } = require("./helpers/editor-identity-host.cjs");
const { createModel } = require("../plugins/shape-plus/model.js");
const { createEditorModel } = require("../plugins/shape-plus/editor-model.js");
const plain = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const { PZ, THREE } = host(), { Content } = createModel(PZ);
  const project = new PZ.project(); project.ui = { onChanged: new PZ.observable() };
  project.threeObj = new THREE.Object3D();
  project.objects = new PZ.objectList(project, PZ.object3d); project.children.push(project.objects);
  const layer = new PZ.object3d.group(); project.objects.push(layer); layer.load({ objects: [] });
  layer.contents = new PZ.objectList(layer, Content); layer.children.push(layer.contents);
  const item = new Content("rectangle", { id: "shape" });
  layer.contents.push(item); item.load({ id: "shape" });
  const editor = editorFor(PZ, project);
  const s = createEditorModel({ PZ, Content, layer, editor, project, message: text => { throw Error(text); } });
  const replacement = () => { const next = new PZ.project(); next.ui = { onChanged: new PZ.observable() }; return next; };
  return { s, layer, editor, replacement };
}

for (const cancel of [false, true]) {
  test(`settling an old Shape Editor gesture leaves replacement history untouched, cancel=${cancel}`, () => {
    const { s, layer, editor, replacement } = fixture();
    assert.equal(s.gesture.begin(), true);
    s.setValue(layer.contents[0].properties.position, [10, 0]);
    editor.onProjectChanged.watch(() => s.gesture.finish(cancel));
    editor.project = replacement();
    assert.equal(s.valid(), false);
    assert.equal(s.gesture.active, false);
    assert.equal(editor.history.operation, null);
    assert.equal(editor.history.undoStack.length, 0);
    assert.equal(editor.history.redoStack.length, 0);
    assert.deepEqual(plain(layer.contents[0].properties.position.get(0)), [10, 0]);
    assert.equal(s.gesture.begin(), false, "the disposed model cannot begin another gesture");
  });
}

test("Shape Editor history callbacks refuse another current project", () => {
  const { s, layer, editor, replacement } = fixture();
  s.gesture.begin(); s.setValue(layer.contents[0].properties.position, [10, 0]); s.gesture.finish();
  const command = editor.history.undoStack.stack[0][0];
  editor.project = replacement();
  editor.history.startOperation();
  // Replay the saved native operation as a stale callback after its history was reset.
  command.fn(command.params);
  editor.history.finishOperation();
  assert.equal(s.read(true), null);
  command.params.write(command.params.data, true);
  assert.deepEqual(plain(layer.contents[0].properties.position.get(0)), [10, 0]);
  assert.equal(editor.history.undoStack.length, 0);
  assert.equal(editor.history.redoStack.length, 0);
});

for (const cancel of [false, true]) {
  test(`Shape Editor recovers a closed operation in the same project, cancel=${cancel}`, () => {
    const { s, layer, editor } = fixture();
    s.gesture.begin(); s.setValue(layer.contents[0].properties.position, [10, 0]);
    editor.history.finishOperation();
    s.gesture.finish(cancel);
    assert.equal(editor.history.operation, null);
    assert.equal(editor.history.undoStack.length, cancel ? 0 : 1);
    if (!cancel) editor.history.undo();
    assert.deepEqual(plain(layer.contents[0].properties.position.get(0)), [0, 0]);
    if (!cancel) {
      editor.history.redo();
      assert.deepEqual(plain(layer.contents[0].properties.position.get(0)), [10, 0]);
    }
  });
}


test("settling an old Shape Editor gesture preserves an operation in the new project", () => {
  const { s, layer, editor, replacement } = fixture();
  s.gesture.begin(); s.setValue(layer.contents[0].properties.position, [10, 0]);
  editor.project = replacement();
  editor.history.startOperation();
  const operation = editor.history.operation;
  s.gesture.finish();
  assert.equal(editor.history.operation, operation);
  assert.equal(operation.length, 0);
  assert.equal(editor.history.undoStack.length, 0);
  assert.equal(editor.history.redoStack.length, 0);
  editor.history.finishOperation();
});
