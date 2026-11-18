"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  classifyFile, isFileDrag, resolveDropZone, isEditableTarget, pastedFilename,
  nextPasteIndex, needsPastedName, clipboardFiles, insertIndexFor, trackFits,
  unsupportedErrors, mediaForAssets, HIGHLIGHT_CLASS,
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
  assert.equal(needsPastedName({ name: "image.png" }), true);
  assert.equal(needsPastedName({ name: "" }), true);
  assert.equal(needsPastedName({ name: "screenshot" }), true);
  assert.equal(needsPastedName({ name: "My photo.png" }), false);
});

test("clipboard files come from files or file items", () => {
  const direct = { name: "a.png", type: "image/png" };
  assert.deepEqual(clipboardFiles({ files: [direct], items: [] }), [direct]);
  const item = { name: "b.png", type: "image/png" };
  assert.deepEqual(clipboardFiles({ files: [], items: [{ kind: "file", getAsFile: () => item }, { kind: "string" }] }), [item]);
  assert.deepEqual(clipboardFiles({ files: [], items: [{ kind: "file", getAsFile: () => null }] }), []);
  assert.deepEqual(clipboardFiles(null), []);
});

test("unsupported files are reported and supported files pass", () => {
  const errors = unsupportedErrors([file("photo.png", "image/png"), file("notes.txt", "text/plain")]);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /notes\.txt/);
  assert.match(errors[0].message, /not a supported media type/);
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
