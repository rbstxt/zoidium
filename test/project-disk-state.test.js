"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const { host, fixture, editorFor } = require("./helpers/editor-identity-host.cjs");
function setup() {
  const c = host(), { PZ } = c, { project, layer } = fixture(c);
  const editor = editorFor(PZ, project); editor.name = "saved"; editor.revision = 0;
  const listeners = {};
  c.addEventListener = (name, fn) => { listeners[name] = fn; };
  vm.runInContext(fs.readFileSync("plugins/core/project-files-shared.js", "utf8"), c);
  PZ.zoidium.projectFiles = { getProjectName: e => e.name.trim(), getProjectRevision: e => e.revision };
  const state = PZ.zoidium.projectFilesShared;
  project.ui.onChanged.watch(() => { editor.revision++; state.projectEdited(editor); });
  const property = layer.properties.position.objects[0], ops = new PZ.ui.properties(editor);
  const edit = value => {
    editor.history.startOperation();
    ops.setValue({ property: property.getAddress(), value, frame: 0 });
    editor.history.finishOperation();
  };
  const changed = reason => listeners['zoidium:project-changed']({detail:{editor,reason}});
  return { state, editor, project, property, edit, changed };
}
test("an unchanged loaded project saves clean and a rename can return to the saved name", () => {
  const { state, editor, changed, project } = setup();
  changed("open");
  state.recordDiskSave(editor, state.captureDiskState(editor));
  assert.equal(project.ui.dirty, false); assert.equal(state.diskUnsaved(editor), false);
  editor.name = "renamed"; state.updateProjectDirty(editor, false);
  assert.equal(project.ui.dirty, true); assert.equal(state.diskUnsaved(editor), true);
  editor.name = "saved"; state.updateProjectDirty(editor, false);
  assert.equal(project.ui.dirty, false); assert.equal(state.diskUnsaved(editor), false);
});
test("native undo back to the saved content clears dirty; redo and a rename keep it dirty", () => {
  const { state, editor, project, edit, changed } = setup(); changed("open");
  edit(10); state.recordDiskSave(editor, state.captureDiskState(editor));
  edit(20); assert.equal(project.ui.dirty, true);
  editor.history.undo(); assert.equal(project.ui.dirty, false);
  editor.history.redo(); assert.equal(project.ui.dirty, true);
  editor.name = "renamed"; editor.history.undo(); assert.equal(project.ui.dirty, true);
  editor.name = "saved"; state.updateProjectDirty(editor, false); assert.equal(project.ui.dirty, false);
});
test("edits or a rename during delivery remain dirty against the delivered snapshot", () => {
  const { state, editor, edit, changed, project } = setup(); changed("open");
  const saved = state.captureDiskState(editor); edit(10);
  state.recordDiskSave(editor, saved); assert.equal(project.ui.dirty, true);
  editor.history.undo(); assert.equal(project.ui.dirty, false);
  const next = state.captureDiskState(editor); editor.name = "later";
  state.recordDiskSave(editor, next); assert.equal(project.ui.dirty, true);
});
test("restore invalidates the disk baseline and a new project releases it", () => {
  const { state, editor, project, changed } = setup(); changed("open"); changed("restore");
  assert.equal(project.ui.dirty, true); assert.equal(state.diskUnsaved(editor), null);
  state.recordDiskSave(editor, state.captureDiskState(editor)); assert.equal(project.ui.dirty, false);
  changed("new"); assert.equal(state.diskUnsaved(editor), null);
});
