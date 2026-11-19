"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  classifyFile, isFileDrag, shouldHandleDrag, resolveDropZone, isEditableTarget, pasteSupported,
  pastedFilename, pastedMediaFilename, nextPasteIndex, needsPastedName, clipboardFiles,
  insertIndexFor, trackFits, unsupportedErrors, mediaForAssets, placeEntries, operationScope, createImportQueue,
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


test("overlapping imports finish in separate history operations", async () => {
  const { editor, history } = fakeTimeline();
  const enqueue = createImportQueue();
  let release;
  const first = enqueue(async () => {
    const finish = operationScope(editor);
    history.pushCommand({ kind: "first" });
    await new Promise(resolve => { release = resolve; });
    finish();
  });
  await Promise.resolve();
  const second = enqueue(async () => {
    const finish = operationScope(editor);
    history.pushCommand({ kind: "second" });
    finish();
  });
  await Promise.resolve();
  assert.equal(history.undoStack.length, 0);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(history.undoStack.map(operation => operation.map(command => command.kind)), [["first"], ["second"]]);
});

test("a failed queued import does not block later imports", async () => {
  const enqueue = createImportQueue();
  const first = enqueue(() => { throw new Error("failed"); });
  const second = enqueue(() => "complete");
  await assert.rejects(first, /failed/);
  assert.equal(await second, "complete");
});

test("separate file drops keep asynchronous imports in separate undo operations", async () => {
  const listeners = {};
  const project = { media: [] };
  const history = {
    operation: null,
    stack: [],
    startOperation() { this.operation = []; },
    finishOperation() { this.stack.push(this.operation); this.operation = null; },
    pushCommand(command) { if (this.operation) this.operation.push(command); },
    undo() { for (const command of (this.stack.pop() || []).reverse()) command(); },
  };
  const editor = { project, history };
  class MediaPanel {}
  const panel = new MediaPanel();
  panel.el = { classList: { remove() {} } };
  const target = { tagName: "DIV", closest: () => ({ pz_panel: panel }) };
  const document = {
    addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener() {},
    querySelectorAll() { return []; },
  };
  const pending = [];
  const api = { import: async ([file]) => {
    await new Promise(resolve => pending.push(resolve));
    const item = { assets: [{ key: file.name }] };
    project.media.push(item);
    history.pushCommand(() => project.media.splice(project.media.indexOf(item), 1));
    return { items: [{ id: file.name }], errors: [] };
  } };
  const host = { CM: editor, addEventListener() {}, removeEventListener() {} };
  const { activate } = require("../plugins/core/media-drop");
  const module = activate({ window: host, document, PZ: { ui: { media: MediaPanel } }, apis: { assets: api } });
  const drop = name => listeners.drop({ target, dataTransfer: { types: ["Files"], files: [file(name, "image/png")] },
    preventDefault() {}, stopPropagation() {} });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  drop("first.png");
  drop("second.png");
  await tick();
  assert.equal(pending.length, 1, "the second import waits until the first operation finishes");
  pending.shift()();
  await tick();
  assert.equal(pending.length, 1);
  pending.shift()();
  await tick();
  assert.equal(project.media.length, 2);
  assert.equal(history.stack.length, 2);
  history.undo();
  assert.deepEqual(project.media.map(item => item.assets[0].key), ["first.png"]);
  history.undo();
  assert.equal(project.media.length, 0);
  module.dispose();
});

test("queued clipboard images choose names after earlier imports finish", async () => {
  const listeners = {};
  const project = { media: [], assets: { list: {} } };
  const history = { operation: null, startOperation() { this.operation = []; }, finishOperation() { this.operation = null; } };
  const editor = { project, history };
  const document = { activeElement: null, addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener() {}, querySelectorAll() { return []; } };
  const pending = [];
  const api = { import: async ([input]) => {
    await new Promise(resolve => pending.push(resolve));
    project.assets.list[input.name] = { filename: input.name };
    project.media.push({ assets: [{ key: input.name }] });
    return { items: [{ id: input.name }], errors: [] };
  } };
  const host = { CM: editor, addEventListener() {}, removeEventListener() {},
    File: class { constructor(_parts, name, options) { this.name = name; this.type = options.type; } } };
  const { activate } = require("../plugins/core/media-drop");
  const module = activate({ window: host, document, PZ: { ui: {} }, apis: { assets: api } });
  const paste = () => listeners.paste({ target: { tagName: "DIV" }, clipboardData: { files: [file("image.png", "image/png")] },
    preventDefault() {}, stopPropagation() {} });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  paste(); paste(); await tick();
  pending.shift()(); await tick();
  pending.shift()(); await tick();
  assert.deepEqual(Object.keys(project.assets.list), ["Pasted image 1.png", "Pasted image 2.png"]);
  module.dispose();
});

test("a queued drop abandoned after a project change reports the failure", async () => {
  const listeners = {}, notices = [];
  let release;
  const editor = { project: { media: [] }, history: { operation: null,
    startOperation() { this.operation = []; }, finishOperation() { this.operation = null; } } };
  class MediaPanel {}
  const panel = new MediaPanel(); panel.el = { classList: { remove() {} } };
  const target = { tagName: "DIV", closest: () => ({ pz_panel: panel }) };
  const document = { addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener() {}, querySelectorAll() { return []; } };
  const host = { CM: editor, addEventListener() {}, removeEventListener() {},
    ZoidiumUI: { notify({ message }) { notices.push(message); } } };
  const api = { import: () => new Promise(resolve => { release = resolve; }) };
  const { activate } = require("../plugins/core/media-drop");
  const module = activate({ window: host, document, PZ: { ui: { media: MediaPanel } }, apis: { assets: api } });
  const drop = name => listeners.drop({ target, dataTransfer: { types: ["Files"], files: [file(name, "image/png")] },
    preventDefault() {}, stopPropagation() {} });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  drop("first.png"); drop("second.png"); await tick();
  editor.project = { media: [] }; editor.history.operation = null;
  release({ items: [], errors: [] }); await tick();
  assert.ok(notices.some(message => message.includes("project changed")));
  module.dispose();
});

function slowDropFixture() {
  const listeners = {}, timers = new Map(), notices = [], started = [];
  let timerId = 0, releaseFirst;
  const project = { media: [] };
  const history = { operation: null, stack: [],
    startOperation() { this.operation = []; },
    finishOperation() { if (this.operation.length) this.stack.push(this.operation); this.operation = null; },
    pushCommand(command) { this.operation.push(command); },
    undo() { for (const command of (this.stack.pop() || []).reverse()) command(); } };
  const editor = { project, history };
  class MediaPanel {}
  const panel = new MediaPanel(); panel.el = { classList: { remove() {} } };
  const target = { tagName: "DIV", closest: () => ({ pz_panel: panel }) };
  const document = { addEventListener(type, listener) { listeners[type] = listener; },
    removeEventListener() {}, querySelectorAll() { return []; } };
  const host = { CM: editor, addEventListener() {}, removeEventListener() {},
    setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    ZoidiumUI: { notify({ message }) { notices.push(message); } } };
  const api = { import: async ([input], options) => {
    started.push({ name: input.name, options });
    if (input.name === "slow.png") await new Promise(resolve => { releaseFirst = resolve; });
    const item = { assets: [{ key: input.name }] };
    project.media.push(item);
    history.pushCommand(() => project.media.splice(project.media.indexOf(item), 1));
    return { items: [{ id: input.name }], errors: [] };
  } };
  const { activate } = require("../plugins/core/media-drop");
  const module = activate({ window: host, document, PZ: { ui: { media: MediaPanel } }, apis: { assets: api } });
  const drop = name => listeners.drop({ target, dataTransfer: { types: ["Files"], files: [file(name, "image/png")] },
    preventDefault() {}, stopPropagation() {} });
  const advance = () => {
    for (const [id, timer] of timers) { timers.delete(id); timer.callback(); }
  };
  return { project, history, timers, notices, started, module, drop, advance, release: () => releaseFirst() };
}

test("a slow drop shows one notice and both drops remain separately undoable", async () => {
  const h = slowDropFixture();
  const tick = () => new Promise(resolve => setImmediate(resolve));
  h.drop("slow.png"); h.drop("second.png"); await tick();
  assert.equal(h.started.length, 1);
  assert.equal(h.started[0].options.waitForMedia, true);
  assert.equal([...h.timers.values()][0].delay, 60000);
  h.advance(); h.advance(); await tick();
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0], /still in progress.*continue when it finishes/i);
  assert.equal(h.started.length, 1, "the second drop waits");
  h.release(); await tick();
  assert.deepEqual(h.project.media.map(item => item.assets[0].key), ["slow.png", "second.png"]);
  assert.equal(h.history.stack.length, 2);
  assert.equal(h.timers.size, 0);
  h.history.undo();
  assert.deepEqual(h.project.media.map(item => item.assets[0].key), ["slow.png"]);
  h.history.undo();
  assert.equal(h.project.media.length, 0);
  h.module.dispose();
});

test("an ordinary drop finishes without a slow-import notice", async () => {
  const h = slowDropFixture();
  h.drop("ordinary.png");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.project.media.length, 1);
  assert.equal(h.timers.size, 0);
  h.advance();
  assert.deepEqual(h.notices, []);
  h.module.dispose();
});
