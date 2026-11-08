"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { host, editorFor } = require("./helpers/editor-identity-host.cjs");
const { loadEngine } = require("./precomp-fixtures.js");

function fixture() {
  const context = host(), { PZ } = context;
  vm.runInContext(fs.readFileSync(require.resolve("../plugins/core/object-history.js"), "utf8"), context);
  PZ.schedule.analyzeSequence = () => {};
  // No GPU or shader assets are loaded in this native history fixture.
  PZ.layer.prototype.load = function () {};
  PZ.layer.prototype.unload = function () {};
  const project = new PZ.project(), seq = project.sequence;
  seq.properties.load(); seq.length = 60; seq.clipLinks = new PZ.clipLinks(seq);
  const editor = editorFor(PZ, project); editor.windows = [];
  const tracks = Object.create(PZ.ui.timeline.tracks.prototype);
  tracks.timeline = { editor, sequence: seq }; tracks.sequence = seq;
  tracks.selection = new PZ.objectList();
  tracks.videoContainer = { children: [] }; tracks.audioContainer = { children: [] };
  tracks.container = { getElementsByClassName: () => tracks.elements };
  const nodes = new WeakMap(), elements = new WeakMap();
  tracks.redraw = () => {
    tracks.elements = [];
    for (const [list, container] of [[seq.videoTracks, tracks.videoContainer], [seq.audioTracks, tracks.audioContainer]]) {
      container.children = list.map(track => {
        const node = nodes.get(track) || { parentElement: container, children: [] };
        nodes.set(track, node);
        node.children = Array.from(track.clips, clip => {
          const element = elements.get(clip) || { parentElement: node, pz_object: clip };
          elements.set(clip, element);
          tracks.elements.push(element); return element;
        });
        return node;
      });
    }
  };
  tracks.zoom = tracks.deselectClips = () => {};
  tracks.selectClips = () => {};
  seq.ui.onClipDeleted.watch(tracks.redraw);
  seq.ui.onClipCreated.watch(tracks.redraw);
  seq.ui.onTrackDeleted.watch(tracks.redraw);
  seq.ui.onTrackCreated.watch(tracks.redraw);
  tracks.updateSequenceLength = () => {};
  editor.panel = tracks;
  const videoTrack = new PZ.track.video(), audioTrack = new PZ.track.audio();
  seq.videoTracks.push(videoTrack); seq.audioTracks.push(audioTrack);
  const video = new PZ.clip.video(2), audio = new PZ.clip.audio();
  videoTrack.clips.push(video); audioTrack.clips.push(audio);
  for (const clip of [video, audio]) {
    clip.start = 0; clip.length = 60; clip.properties.load(); clip.object.properties.load();
    clip.link = seq.clipLinks.link(0, clip);
  }
  video.object.properties.resolution.set([1920, 1080]);
  tracks.redraw(); tracks.selection.push(video, audio);
  const engine = loadEngine(PZ); engine.install();
  const serialized = () => {
    const json = JSON.parse(JSON.stringify(project));
    for (const link of Object.values(json.sequence.clipLinks.links)) link.clips.sort();
    return JSON.stringify(json);
  };
  return { context, PZ, project, seq, editor, tracks, engine, video, audio, serialized };
}

test("pre-compose of linked video and audio keeps native undo and redo across source switches", () => {
  const { project, seq, editor, engine, serialized } = fixture();
  const original = serialized();
  const result = engine.precompose(editor, "Nested");
  assert.equal(result.ok, true, result.message);
  assert.equal(result.moved, 1); assert.equal(result.movedAudio, 1);
  assert.equal(editor.history.undoStack.length, 1);
  const commands = editor.history.undoStack.stack[0].length;
  const composed = serialized();
  assert.equal(seq.videoTracks[0].clips.length, 1);
  assert.equal(seq.audioTracks[0].clips.length, 0);
  assert.equal(Object.keys(seq.clipLinks.links).length, 0);
  for (let cycle = 0; cycle < 3; cycle++) {
    assert.equal(engine.openComp(editor, result.id).ok, true);
    assert.equal(seq.videoTracks[0].clips.length, 1);
    assert.equal(seq.audioTracks[0].clips.length, 1);
    assert.equal(engine.openComp(editor, null).ok, true);
    editor.history.undo(); editor.history.undo();
    assert.equal(serialized(), composed);
    editor.history.undo();
    assert.equal(serialized(), original);
    assert.equal(project.media.length, 0);
    const video = seq.videoTracks[0].clips[0], audio = seq.audioTracks[0].clips[0];
    assert.equal(video.link, audio.link); assert.equal(video.link.clips.length, 2);
    editor.history.redo();
    assert.equal(serialized(), composed);
    assert.equal(editor.history.undoStack.length, 1);
    assert.equal(editor.history.undoStack.stack[0].length, commands);
    assert.equal(editor.history.redoStack.length, 2, "the two undone composition switches remain redoable");
    assert.equal(editor.history.operation, null);
  }
});
