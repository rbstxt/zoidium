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

function nativeEnvironment() {
  const { PZ } = require("./helpers/editor-identity-host.cjs").host();
  // These tests exercise native parenting and command execution without GPU work.
  PZ.schedule.analyzeSequence = () => {};
  const { loadEngine } = require("./precomp-fixtures.js");
  const engine = loadEngine(PZ), project = new PZ.project();
  project.sequence.properties.load();
  const editor = { project, windows: [], onProjectChanged: new PZ.observable() };
  editor.history = new PZ.ui.history(editor); editor.history.projectChanged();
  engine.install();
  function clip(name) {
    const track = new PZ.track.video(), clip = new PZ.clip.video(5);
    project.sequence.videoTracks.push(track); track.clips.push(clip);
    clip.start = 0; clip.length = 60; clip.properties.load();
    clip.object.properties.load(); clip.properties.name.set(name);
    return clip;
  }
  return { PZ, engine, project, editor, clip };
}

test("native commands restore the exact object and keys across interleaved timeline switches", () => {
  const f = nativeEnvironment(), { editor, project, engine } = f;
  const first = engine.newEmptyComp(editor).id, second = engine.newEmptyComp(editor).id;
  const mainClip = f.clip("Main"), sequence = project.sequence;
  const property = sequence.properties.motionBlurSamples;
  const mainKey = property.keyframes[0];
  const states = [], check = () => JSON.stringify({ project, active: engine.activeName(editor) });
  function exchange({ address, expected, value }) {
    const target = project.addressLookup(address);
    assert.equal(target, expected, "the command cannot resolve a sibling composition's object");
    const previous = target.get(0); target.set(value);
    editor.history.pushCommand(exchange, { address, expected, value: previous });
  }
  const edit = (target, value) => {
    editor.history.startOperation();
    exchange({ address: target.getAddress(), expected: target, value });
    editor.history.finishOperation(); states.push(check());
  };
  const open = id => { assert.equal(engine.openComp(editor, id).ok, true); states.push(check()); };
  states.push(check());
  edit(mainClip.properties.name, "Main edited");
  open(first); const firstClip = f.clip("First");
  // Adding a fixture clip is outside history. Start the checked history here.
  editor.history.undoStack.clear(); states.length = 0; states.push(check());
  edit(firstClip.properties.name, "First edited");
  open(null); edit(mainClip.properties.name, "Main edited again");
  open(second); const secondClip = f.clip("Second");
  editor.history.undoStack.clear(); states.length = 0; states.push(check());
  edit(secondClip.properties.name, "Second edited");
  open(first); edit(firstClip.properties.name, "First edited again");
  open(null); edit(property, 32);
  open(second); edit(secondClip.properties.name, "Second final");
  open(null);
  const undoCount = editor.history.undoStack.length;
  assert.equal(undoCount, states.length - 1);
  for (let i = states.length - 2; i >= 0; i--) {
    editor.history.undo(); assert.equal(check(), states[i]);
    assert.equal(project.sequence, sequence);
  }
  for (let i = 1; i < states.length; i++) {
    editor.history.redo(); assert.equal(check(), states[i]);
  }
  assert.equal(property.keyframes[0], mainKey);
  assert.equal(mainClip.parentProject, project);
  assert.equal(firstClip.parentProject, project);
  assert.equal(secondClip.parentProject, project);
});

test("opening the current timeline is inert and a switch refuses unfinished edits", () => {
  const f = nativeEnvironment(), id = f.engine.newEmptyComp(f.editor).id;
  f.engine.openComp(f.editor, id);
  const count = f.editor.history.undoStack.length;
  assert.equal(f.engine.openComp(f.editor, id).ok, true);
  assert.equal(f.editor.history.undoStack.length, count);
  f.editor.history.startOperation(); const operation = f.editor.history.operation;
  assert.equal(f.engine.openComp(f.editor, null).ok, false);
  assert.equal(f.editor.history.operation, operation);
  assert.equal(f.engine.activeName(f.editor), "Comp 1");
  f.editor.history.finishOperation();
});

test("undoing deletion reopens its source with its original live objects", () => {
  const f = nativeEnvironment(), id = f.engine.newEmptyComp(f.editor).id;
  f.engine.openComp(f.editor, id);
  const original = f.clip("Inside");
  assert.equal(f.engine.removeComp(f.editor, id).ok, true);
  assert.equal(f.engine.isEditing(f.project), false);
  f.editor.history.undo(); // Restore the media before reopening its source.
  assert.equal(f.engine.activeName(f.editor), "Comp 1");
  assert.ok(f.project.sequence.videoTracks.some(track => track.clips.includes(original)));
  f.editor.history.redo();
  assert.equal(f.project.media.length, 0);
  assert.equal(f.engine.isEditing(f.project), false);
});

test("frame rate edits update parked compositions without replacing native command targets", () => {
  const f = nativeEnvironment(), { PZ, editor, engine, project } = f;
  editor.sequence = project.sequence; editor.playback = { currentFrame: 12 };
  const vm = require("node:vm"), fs = require("node:fs");
  vm.runInNewContext(fs.readFileSync(require.resolve("../plugins/core/sequence-timing.js"), "utf8"),
    { PZ, window: { PZ }, console, Promise });
  const id = engine.newEmptyComp(editor).id;
  const main = f.clip("Main");
  engine.openComp(editor, id); const inside = f.clip("Inside");
  const sourceKey = inside.object.properties.position.objects[0].keyframes[0];
  engine.openComp(editor, null);
  const before = JSON.stringify(project);
  editor.history.startOperation();
  new PZ.ui.properties(editor).setValue({ property: project.sequence.properties.rate.getAddress(), value: 60 });
  editor.history.finishOperation();
  const after = JSON.stringify(project);
  assert.equal(main.length, 120); assert.equal(inside.length, 120);
  engine.openComp(editor, id);
  assert.equal(project.sequence.videoTracks.at(-1).clips[0], inside);
  assert.equal(project.sequence.properties.rate.get(), 60);
  editor.history.undo(); editor.history.undo();
  assert.equal(JSON.stringify(project), before);
  assert.equal(inside.object.properties.position.objects[0].keyframes[0], sourceKey);
  editor.history.redo(); assert.equal(JSON.stringify(project), after);
  editor.history.redo();
  assert.equal(project.sequence.videoTracks.at(-1).clips[0], inside);
});

test("a new edit after undoing a switch discards redo without touching the closed timeline", () => {
  const f = nativeEnvironment(), { editor, project, engine, PZ } = f;
  const main = f.clip("Main"), id = engine.newEmptyComp(editor).id;
  engine.openComp(editor, id); const inside = f.clip("Inside");
  engine.openComp(editor, null); editor.history.undo();
  assert.ok(editor.history.redoStack.length);
  editor.history.startOperation();
  new PZ.ui.properties(editor).setValue({ property: inside.properties.name.getAddress(), value: "Branched" });
  editor.history.finishOperation();
  assert.equal(editor.history.redoStack.length, 0);
  editor.history.redo();
  assert.equal(inside.properties.name.get(), "Branched");
  assert.equal(main.properties.name.get(), "Main");
  assert.equal(project.sequence.videoTracks.at(-1).clips[0], inside);
});
