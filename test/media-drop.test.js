"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  classifyFile, isFileDrag, shouldHandleDrag, resolveDropZone, isEditableTarget, pasteSupported,
  pastedFilename, pastedMediaFilename, nextPasteIndex, needsPastedName, clipboardFiles,
  insertIndexFor, trackFits, unsupportedErrors, mediaForAssets, placeEntries, operationScope,
  IMPORT_FAILURE, HIGHLIGHT_CLASS,
} = require("../plugins/core/media-drop");

function file(name, type = "") {
  return { name, type };
}

test("file kinds follow the MIME type, then the extension", () => {
  assert.equal(classifyFile(file("photo.png", "image/png")), "image");
  assert.equal(classifyFile(file("clip.MOV", "")), "video");
  assert.equal(classifyFile(file("clip.webm", "video/webm")), "video");
  assert.equal(classifyFile(file("voice.m4a", "")), "audio");
  assert.equal(classifyFile(file("track.mp3", "audio/mpeg")), "audio");
  assert.equal(classifyFile(file("brand.otf", "")), "font");
  assert.equal(classifyFile(file("brand.woff2", "font/woff2")), "font");
  assert.equal(classifyFile(file("project.pz", "")), "archive");
  assert.equal(classifyFile(file("notes.txt", "text/plain")), null);
  assert.equal(classifyFile(file("no-extension", "")), null);
});

test("only file drags are claimed as imports", () => {
  assert.equal(isFileDrag({ types: ["Files"] }), true);
  assert.equal(isFileDrag({ types: ["files"] }), true);
  assert.equal(isFileDrag({ types: ["text/plain"] }), false);
  assert.equal(isFileDrag({ types: ["text/plain", "text/html"] }), false);
  assert.equal(isFileDrag({ types: [] }), false);
  assert.equal(isFileDrag(null), false);
  assert.equal(isFileDrag({ types: ["Files"] }, { draggingData: [{}] }), false,
    "CM3 media drags stay internal even if a type list looks like files");
  assert.equal(isFileDrag({ types: ["text/plain"] }, { draggingData: [{}] }), false);
});

test("drops over editable fields keep the browser's native behaviour", () => {
  const files = { types: ["Files"] };
  assert.equal(shouldHandleDrag({ target: { tagName: "INPUT" }, dataTransfer: files }), false);
  assert.equal(shouldHandleDrag({ target: { tagName: "TEXTAREA" }, dataTransfer: files }), false);
  assert.equal(shouldHandleDrag({ target: { tagName: "SELECT" }, dataTransfer: files }), false);
  assert.equal(shouldHandleDrag({ target: { isContentEditable: true }, dataTransfer: files }), false);
  assert.equal(shouldHandleDrag({ target: { tagName: "SPAN", getAttribute: () => "true" }, dataTransfer: files }), false);
  assert.equal(shouldHandleDrag({ target: { tagName: "DIV" }, dataTransfer: files }), true);
  assert.equal(shouldHandleDrag({ target: { tagName: "DIV" }, dataTransfer: { types: ["text/plain"] } }), false);
  assert.equal(shouldHandleDrag({ target: { tagName: "DIV" }, dataTransfer: files }, { draggingData: [{}] }), false);
});

test("drop routing picks the zone that contains the event target", () => {
  const mediaTarget = {};
  const media = { kind: "media", el: { contains: target => target === mediaTarget } };
  const clip = {};
  const timeline = { kind: "timeline", el: { contains: target => target === clip } };
  const canvas = {};
  const viewport = { kind: "viewport", el: { contains: target => target === canvas } };
  const zones = [media, timeline, viewport];
  assert.equal(resolveDropZone(zones, mediaTarget), media);
  assert.equal(resolveDropZone(zones, clip), timeline);
  assert.equal(resolveDropZone(zones, canvas), viewport);
  assert.equal(resolveDropZone(zones, {}), null);
  assert.equal(resolveDropZone(zones, null), null);
});

test("text inputs keep their native paste", () => {
  assert.equal(isEditableTarget({ tagName: "INPUT" }), true);
  assert.equal(isEditableTarget({ tagName: "TEXTAREA" }), true);
  assert.equal(isEditableTarget({ tagName: "SPAN", isContentEditable: true }), true);
  assert.equal(isEditableTarget({ tagName: "SPAN", getAttribute: key => key === "contenteditable" ? "true" : null }), true);
  assert.equal(isEditableTarget({ tagName: "SPAN", getAttribute: () => "false" }), false);
  assert.equal(isEditableTarget({ tagName: "DIV" }), false);
  assert.equal(isEditableTarget(null), false);
});

test("pasted bitmaps receive an unused name", () => {
  assert.equal(pastedFilename(1, "image/png"), "Pasted image 1.png");
  assert.equal(pastedFilename(4, "image/jpeg"), "Pasted image 4.jpg");
  assert.equal(pastedFilename(2, ""), "Pasted image 2.png");
  assert.equal(nextPasteIndex([]), 1);
  assert.equal(nextPasteIndex(["Pasted image 1.png", "Pasted image 7.png", "photo.png"]), 8);
  assert.equal(nextPasteIndex(["Pasted media 7.mp4"]), 8);
  assert.equal(needsPastedName({ name: "image.png" }), true);
  assert.equal(needsPastedName({ name: "" }), true);
  assert.equal(needsPastedName({ name: "screenshot" }), true);
  assert.equal(needsPastedName({ name: "My photo.png" }), false);
  assert.equal(pastedMediaFilename(3, { name: "", type: "video/mp4" }), "Pasted media 3.mp4");
  assert.equal(pastedMediaFilename(5, { name: "", type: "" }), "Pasted media 5.bin");
});

test("paste accepts only image, video, and audio files", () => {
  assert.equal(pasteSupported(file("a.png", "image/png")), true);
  assert.equal(pasteSupported(file("b.mp4", "video/mp4")), true);
  assert.equal(pasteSupported(file("c.mp3", "audio/mpeg")), true);
  assert.equal(pasteSupported(file("d.ttf", "")), false);
  assert.equal(pasteSupported(file("e.pz", "")), false);
  assert.equal(pasteSupported(file("f.txt", "text/plain")), false);
});

test("clipboard files come from files or file items", () => {
  const direct = { name: "a.png", type: "image/png" };
  assert.deepEqual(clipboardFiles({ files: [direct], items: [] }), [direct]);
  const item = { name: "b.png", type: "image/png" };
  assert.deepEqual(clipboardFiles({ files: [], items: [{ kind: "file", getAsFile: () => item }, { kind: "string" }] }), [item]);
  assert.deepEqual(clipboardFiles({ files: [], items: [{ kind: "file", getAsFile: () => null }] }), []);
  assert.deepEqual(clipboardFiles(null), []);
});

test("unsupported files are reported with the import message and supported files pass", () => {
  const errors = unsupportedErrors([file("photo.png", "image/png"), file("notes.txt", "text/plain")]);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].name, "notes.txt");
  assert.equal(errors[0].message, IMPORT_FAILURE);
  assert.deepEqual(unsupportedErrors([file("photo.png", "image/png")]), []);
});

test("timeline placement keeps clips in order and avoids an occupied track", () => {
  assert.equal(insertIndexFor([{ start: 0 }, { start: 30 }], 10), 1);
  assert.equal(insertIndexFor([{ start: 0 }, { start: 30 }], 40), 2);
  assert.equal(insertIndexFor([{ start: 0 }, { start: 30 }], 30), 2);
  const track = { clips: [{ start: 0, length: 20 }] };
  assert.equal(trackFits(track, 20, 10), true);
  assert.equal(trackFits(track, 10, 15), false);
  assert.equal(trackFits(null, 0, 1), false);
  assert.equal(HIGHLIGHT_CLASS, "zoidium-media-drop-target");
});

test("imported footage finds its new media item before an older one", () => {
  const key = "asset-key";
  const older = { assets: [{ key }] };
  const fresh = { assets: [{ key }] };
  const project = { media: [older, fresh] };
  const found = mediaForAssets(project, [key], new Set([older]));
  assert.equal(found.get(key), fresh);
  assert.equal(mediaForAssets({ media: [older] }, [key], new Set()).get(key), older);
});

function fakeTimeline() {
  const history = {
    operation: null,
    undoStack: [],
    startOperation() { this.operation = []; },
    finishOperation() {
      const operation = this.operation;
      this.operation = null;
      if (operation && operation.length) this.undoStack.push(operation);
    },
    pushCommand(command) {
      if (!this.operation) throw new Error("no history operation");
      this.operation.push(command);
    },
  };
  const editor = {
    project: { sequence: { videoTracks: [{ clips: [] }], audioTracks: [{ clips: [] }] } },
    history,
  };
  const videoContainer = { children: [], clientHeight: 100, scrollTop: 0 };
  const audioContainer = { children: [], clientHeight: 100, scrollTop: 0 };
  const tracks = {
    timeline: { editor },
    container: { getBoundingClientRect: () => ({ left: 0 }) },
    videoContainer,
    audioContainer,
    createTrack({ type, newTrackIdx }) {
      const list = type === 1 ? editor.project.sequence.audioTracks : editor.project.sequence.videoTracks;
      list.splice(newTrackIdx, 0, { clips: [] });
      const container = type === 1 ? audioContainer : videoContainer;
      container.children.splice(newTrackIdx, 0, { style: { top: "0px", height: "30px" } });
      history.pushCommand({ kind: "track", type, index: newTrackIdx });
    },
    createClip({ type, newTrackIdx, newIdx, start, length }) {
      const list = type === 1 ? editor.project.sequence.audioTracks : editor.project.sequence.videoTracks;
      list[newTrackIdx].clips.splice(newIdx, 0, { start, length });
      history.pushCommand({ kind: "clip", type, index: newTrackIdx, start, length });
    },
    linkAfterCreation() {},
  };
  return { editor, history, tracks };
}

const mediaEntry = length => ({ media: { data: [{ type: 0, clips: [{ start: 0, length }] }] } });

test("placement keeps several files in order on one track", () => {
  const { editor, history, tracks } = fakeTimeline();
  const finish = operationScope(editor);
  assert.equal(placeEntries(tracks, [mediaEntry(30), mediaEntry(40)], 20, null), 2);
  finish();
  assert.equal(editor.project.sequence.videoTracks.length, 2, "one new top track serves both files");
  const newTrack = editor.project.sequence.videoTracks[1];
  assert.deepEqual(newTrack.clips.map(clip => clip.start), [20, 50]);
  assert.equal(history.undoStack.length, 1);
  assert.deepEqual(history.undoStack[0].map(command => command.kind), ["track", "clip", "clip"]);
});

test("an occupied target track receives a new top track", () => {
  const { editor, history, tracks } = fakeTimeline();
  editor.project.sequence.videoTracks[0].clips.push({ start: 0, length: 100 });
  const finish = operationScope(editor);
  assert.equal(placeEntries(tracks, [mediaEntry(30)], 20, { type: 0, index: 0 }), 1);
  finish();
  assert.equal(editor.project.sequence.videoTracks.length, 2);
  assert.deepEqual(editor.project.sequence.videoTracks[1].clips.map(clip => clip.start), [20]);
  assert.deepEqual(history.undoStack[0].map(command => command.kind), ["track", "clip"]);
});

test("one operation groups the import and its placement commands", () => {
  const { editor, history, tracks } = fakeTimeline();
  const finish = operationScope(editor);
  history.pushCommand({ kind: "asset" });
  history.pushCommand({ kind: "media" });
  placeEntries(tracks, [mediaEntry(30)], 20, null);
  finish();
  assert.equal(history.undoStack.length, 1, "undo sees a single operation");
  assert.deepEqual(history.undoStack[0].map(command => command.kind), ["asset", "media", "track", "clip"]);
});

test("a nested scope leaves the caller's operation open", () => {
  const { editor, history } = fakeTimeline();
  history.startOperation();
  const finish = operationScope(editor);
  history.pushCommand({ kind: "edited" });
  finish();
  assert.ok(history.operation, "the outer operation stays open");
  assert.equal(history.undoStack.length, 0);
  history.finishOperation();
  assert.equal(history.undoStack.length, 1);
});

test("a project change abandons the scope without finishing the old operation", () => {
  const { editor, history } = fakeTimeline();
  const finish = operationScope(editor);
  editor.project = { sequence: { videoTracks: [], audioTracks: [] } };
  history.operation = null;
  assert.doesNotThrow(finish);
  assert.equal(history.undoStack.length, 0);
});
