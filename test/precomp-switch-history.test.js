"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEnvironment, addClip } = require("./precomp-fixtures.js");

test("undo returns from a composition before undoing pre-compose", () => {
  const env = createEnvironment();
  const clip = addClip(env, 0, { start: 0, length: 60, name: "Original" });
  env.tracks.selectedClips = [clip];
  const { id } = env.engine.precompose(env.editor, "Nested");
  assert.equal(env.editor.history.undoStack.length, 1);
  env.engine.openComp(env.editor, id);
  assert.equal(env.editor.history.undoStack.length, 2);
  env.editor.history.undo();
  assert.equal(env.engine.isEditing(env.project), false);
  env.editor.history.undo();
  assert.equal(env.project.media.length, 0);
  assert.equal(env.project.sequence.videoTracks[0].clips[0].properties.name.v, "Original");
});
