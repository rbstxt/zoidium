"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { nativeHost, cache, core } = require("./expressions-plus-harness");

function serialized(sequence) {
  const data = JSON.parse(JSON.stringify(sequence));
  // Native history restores link members in inverse order. Membership is a set.
  for (const link of Object.values(data.clipLinks.links)) link.clips.sort();
  return JSON.stringify(data);
}

function fixture() {
  const { PZ, context } = nativeHost();
  Object.assign(context, { Image: class {}, CSS: { supports: () => true },
    window: { PZ, addEventListener() {} }, navigator: {} });
  vm.runInContext(fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(require.resolve("../plugins/core/object-history.js"), "utf8"), context);
  // Use plain clip payloads so the test needs no media decoder or WebGL.
  // The native track, clip-link, address, delete, and history logic stays intact.
  class Clip extends PZ.clip {
    constructor() { super(); this.link = null; }
    load(data) { this.start = data.start; this.length = data.length; }
    unload() {}
    toJSON() { return { start: this.start, length: this.length, link: this.link, object: { type: 0 } }; }
  }
  PZ.clip.create = () => new Clip();
  PZ.schedule.analyzeSequence = () => {};
  const editor = {};
  PZ.observable.defineObservableProp(editor, "project", "onProjectChanged");
  editor.history = new PZ.ui.history(editor);
  editor.project = new PZ.project();
  const sequence = editor.project.sequence;
  sequence.clipLinks = new PZ.clipLinks(sequence);
  const tracks = Object.create(PZ.ui.timeline.tracks.prototype);
  tracks.timeline = { sequence, editor };
  tracks.sequence = sequence;
  tracks.updateSequenceLength = () => {};
  const operation = fn => { editor.history.startOperation(); fn(); editor.history.finishOperation(); };
  const add = (type, trackIndex, link) => {
    const list = type ? sequence.audioTracks : sequence.videoTracks;
    if (!list[trackIndex]) list.push(PZ.track.create(type));
    const clip = new Clip(); list[trackIndex].clips.push(clip); clip.load({ start: 0, length: 60 });
    if (link !== undefined) clip.link = sequence.clipLinks.link(link, clip);
    return clip;
  };
  const liveLinks = () => {
    for (const link of Object.values(sequence.clipLinks.links)) {
      assert.ok(link.clips.length > 1, "singleton links are removed");
      for (const clip of link.clips) {
        assert.equal(editor.project.addressLookup(clip.getAddress()), clip, "linked clips remain in the project");
        assert.equal(clip.link, link);
      }
    }
  };
  return { PZ, context, editor, sequence, tracks, operation, add, liveLinks };
}

for (const type of [0, 1]) test(`deleting a linked ${type ? "audio" : "video"} track restores links through undo and redo`,
  { skip: !fs.existsSync(core) }, () => {
    const { PZ, editor, sequence, tracks, operation, add, liveLinks } = fixture();
    add(type, 0, 0);
    const survivor = add(1 - type, 0, 0);
    const before = serialized(sequence);
    operation(() => {
      // This is the native track button's call path. It omits unlinkBeforeDeletion.
      tracks.deleteClip({ type, oldTrackIdx: 0, oldIdx: 0 });
      tracks.deleteTrack({ type, oldTrackIdx: 0 });
    });
    assert.equal(survivor.link, null);
    liveLinks();
    const deleted = serialized(sequence);
    for (let cycle = 0; cycle < 3; cycle++) {
      editor.history.undo(); liveLinks();
      assert.equal(serialized(sequence), before);
      editor.history.redo(); liveLinks();
      assert.equal(serialized(sequence), deleted);
    }
    editor.history.undo();
    const reopened = new PZ.project();
    reopened.load({ assets: {}, media: [], sequence: JSON.parse(JSON.stringify(sequence)) });
    const v = reopened.sequence.videoTracks[0].clips[0], a = reopened.sequence.audioTracks[0].clips[0];
    assert.equal(v.link, a.link);
    assert.equal(v.link.clips.length, 2);
    for (const clip of v.link.clips) assert.equal(reopened.addressLookup(clip.getAddress()), clip);
  });

test("deleting a clip from a larger link keeps the other members linked", { skip: !fs.existsSync(core) }, () => {
  const { editor, sequence, tracks, operation, add, liveLinks } = fixture();
  add(0, 0, 0); const audio = add(1, 0, 0), other = add(0, 1, 0);
  operation(() => tracks.deleteClip({ type: 0, oldTrackIdx: 0, oldIdx: 0 }));
  liveLinks();
  assert.equal(audio.link, other.link);
  assert.equal(audio.link.clips.length, 2);
  editor.history.undo(); liveLinks();
  assert.equal(sequence.videoTracks[0].clips[0].link, audio.link);
  assert.equal(audio.link.clips.length, 3);
});

test("callers that already unlink a clip do not add duplicate history commands", { skip: !fs.existsSync(core) }, () => {
  const { editor, sequence, tracks, operation, add, liveLinks } = fixture();
  add(0, 0, 0); add(1, 0, 0);
  operation(() => {
    const params = { type: 0, oldTrackIdx: 0, oldIdx: 0 };
    tracks.unlinkBeforeDeletion(params);
    tracks.deleteClip(params);
  });
  liveLinks();
  editor.history.undo(); liveLinks();
  assert.equal(sequence.videoTracks[0].clips[0].link.clips.length, 2);
});

test("unlinked clip deletion keeps the native history behavior", { skip: !fs.existsSync(core) }, () => {
  const { editor, sequence, tracks, operation, add, liveLinks } = fixture();
  add(0, 0); add(1, 0);
  const before = JSON.stringify(sequence);
  operation(() => tracks.deleteClip({ type: 0, oldTrackIdx: 0, oldIdx: 0 }));
  assert.equal(sequence.videoTracks[0].clips.length, 0); liveLinks();
  editor.history.undo(); liveLinks();
  assert.equal(JSON.stringify(sequence), before);
});

test("undoing linked media creation records only its native inverse operation", { skip: !fs.existsSync(core) }, () => {
  const { editor, sequence, tracks, operation, add, liveLinks } = fixture();
  // Empty native tracks already exist when media is added to the timeline.
  add(0, 0); add(1, 0);
  sequence.videoTracks[0].clips.splice(0, 1); sequence.audioTracks[0].clips.splice(0, 1);
  operation(() => {
    for (const type of [0, 1]) tracks.createClip({ type, newTrackIdx: 0, newIdx: 0,
      start: 0, length: 60, data: { start: 0, length: 60, object: { type: 0 } } });
    for (const type of [0, 1]) tracks.linkClip({ clip: [0, type + 1, 0, 0, 0], link: 0 });
  });
  const before = serialized(sequence);
  assert.equal(editor.history.undoStack.stack[0].length, 4);
  for (let cycle = 0; cycle < 3; cycle++) {
    editor.history.undo();
    assert.equal(sequence.videoTracks[0].clips.length, 0);
    assert.equal(sequence.audioTracks[0].clips.length, 0);
    assert.equal(editor.history.undoStack.length, 0);
    assert.equal(editor.history.redoStack.length, 1);
    assert.equal(editor.history.redoStack.stack[0].length, 4);
    assert.equal(editor.history.operation, null);
    editor.history.redo(); liveLinks();
    assert.equal(serialized(sequence), before);
    assert.equal(editor.history.undoStack.length, 1);
    assert.equal(editor.history.undoStack.stack[0].length, 4);
    assert.equal(editor.history.redoStack.length, 0);
    assert.equal(editor.history.operation, null);
  }
});

test("nested track deletion and its replay keep one operation without extra inverse commands", { skip: !fs.existsSync(core) }, () => {
  const { editor, tracks, operation, add, liveLinks } = fixture();
  add(0, 0, 0); add(1, 0, 0);
  const remove = () => {
    tracks.deleteClip({ type: 0, oldTrackIdx: 0, oldIdx: 0 });
    tracks.deleteTrack({ type: 0, oldTrackIdx: 0 });
  };
  operation(() => { const active = editor.history.operation; remove(); assert.equal(editor.history.operation, active); });
  for (let cycle = 0; cycle < 3; cycle++) {
    assert.equal(editor.history.undoStack.length, 1);
    assert.equal(editor.history.undoStack.stack[0].length, 4);
    editor.history.undo(); liveLinks();
    assert.equal(editor.history.redoStack.length, 1);
    assert.equal(editor.history.redoStack.stack[0].length, 4);
    editor.history.redo(); liveLinks();
    assert.equal(editor.history.redoStack.length, 0);
    assert.equal(editor.history.operation, null);
  }
});

for (const nested of [false, true]) test(`asset removal of a linked clip joins ${nested ? "an existing" : "one new"} history operation`,
  { skip: !fs.existsSync(core) }, async () => {
    const { PZ, context, editor, sequence, tracks, add, liveLinks } = fixture();
    const video = add(0, 0, 0); add(1, 0, 0);
    video.properties = { media: { get: () => "footage" } };
    const before = serialized(sequence), usage = {};
    context.CM = editor;
    context.ZoidiumAssetRegistryParts = { panelsOf: () => ({ tracks }) };
    vm.runInContext(fs.readFileSync(require.resolve("../plugins/core/asset-registry-edits.js"), "utf8"), context);
    const edits = context.ZoidiumAssetRegistryParts.createEdits({ PZ,
      snapshot: () => ({ items: [{ id: "footage", source: "embedded", usages: [usage] }] }),
      refresh() {}, adapters: new Map(), usageRecords: new WeakMap([[usage, { clip: video }]]) });
    if (nested) editor.history.startOperation();
    const active = editor.history.operation;
    assert.equal((await edits.removeItems(["footage"])).ok, true);
    if (nested) {
      assert.equal(editor.history.operation, active);
      assert.equal(editor.history.undoStack.length, 0);
      editor.history.finishOperation();
    }
    const removed = serialized(sequence);
    assert.equal(sequence.videoTracks[0].clips.length, 0); liveLinks();
    for (let cycle = 0; cycle < 3; cycle++) {
      assert.equal(editor.history.undoStack.length, 1);
      assert.equal(editor.history.undoStack.stack[0].length, 3);
      editor.history.undo(); liveLinks();
      assert.equal(serialized(sequence), before);
      assert.equal(editor.history.redoStack.stack[0].length, 3);
      editor.history.redo(); liveLinks();
      assert.equal(serialized(sequence), removed);
      assert.equal(editor.history.operation, null);
    }
  });
