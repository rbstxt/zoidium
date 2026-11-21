"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  class Track {
    load() {}
    toJSON() { return { type: 0 }; }
  }
  const locked = Object.assign(new Track(), { zoidiumLocked: true });
  const free = new Track();
  const clip = { parent: { parent: locked } };
  const property = { parent: { parent: clip } };
  const editor = { history: {}, project: { addressLookup: address => [property, clip, locked, free][address] } };
  const calls = [];
  function host(...names) {
    class Host {}
    for (const name of names) Host.prototype[name] = function (...args) { calls.push({ name, args }); };
    return Host;
  }
  const tracks = host("clipDragStart", "handleDragStart", "moveClip", "createClip", "deleteClip",
    "deleteTrack", "moveClipProxies", "clipContextMenu", "splitClips");
  const keyframes = host("keyframeDragStart");
  const widget2d = host("dragStart", "resizeDragStart");
  const widget3d = host("dragStart", "updateMode", "dragEnd");
  const properties = host("setValue", "moveKeyframe", "deleteKeyframe", "setControlPoints",
    "setExpression", "pasteKeyframes", "startEdit");
  const edit = host("createObject", "deleteObject", "moveObject", "generateAdd");
  const context = { PZ: { track: Track, ui: { timeline: { tracks, keyframes }, widget2d, widget3d, properties, edit } } };
  context.window = context;
  for (const script of ["timeline-track-state", "timeline-track-lock"]) {
    const path = "plugins/core/" + script + ".js";
    if (fs.existsSync(path)) vm.runInNewContext(fs.readFileSync(path, "utf8"), context);
  }
  const panel = new tracks();
  panel.timeline = { editor, sequence: { videoTracks: [locked, free] } };
  panel.container = { querySelectorAll: () => [] };
  panel.selectClips = panel.deselectClips = panel.deselectHandles = () => {};
  panel.el = { focus() {} };
  const propertyOps = Object.assign(new properties(), { editor });
  const objectOps = Object.assign(new edit(), { editor });
  const element = { pz_object: clip, classList: { add() {}, contains: () => false } };
  return { panel, locked, free, clip, property, element, keyframes, widget2d, widget3d, propertyOps, objectOps, calls, Track };
}

test("locked tracks reject timeline movement, trim, deletion, split and paste", () => {
  const { panel, element, calls, locked } = setup();
  const event = { currentTarget: element, stopPropagation() {}, preventDefault() {} };
  const ctx = { ctx: panel };
  assert.equal(panel.clipDragStart.call(ctx, event), false);
  assert.equal(panel.handleDragStart.call(ctx, { ...event, currentTarget: { parentElement: element } }), false);
  panel.moveClip({ type: 0, oldTrackIdx: 0, newTrackIdx: 1 });
  panel.moveClip({ type: 0, oldTrackIdx: 1, newTrackIdx: 0 });
  panel.createClip({ type: 0, newTrackIdx: 0 });
  panel.deleteClip({ type: 0, oldTrackIdx: 0 });
  panel.splitClips([element]);
  panel.deleteTrack({ type: 0, oldTrackIdx: 0 });
  panel.moveClipProxies([{ parentElement: { pz_object: locked } }], true);
  assert.deepEqual(calls, []);
  locked.zoidiumLocked = false;
  panel.moveClip({ type: 0, oldTrackIdx: 0 });
  assert.equal(calls[0].name, "moveClip");
});

test("locked tracks reject viewport transforms, property writes and keyframe edits", () => {
  const { panel, property, keyframes, widget2d, widget3d, propertyOps, objectOps, calls, locked } = setup();
  const keyPanel = { timeline: panel.timeline, container: panel.container };
  const keys = new keyframes();
  assert.equal(keys.keyframeDragStart.call({ ctx: keyPanel }, { currentTarget: { parentElement: { pz_object: property } } }), false);
  const widget = Object.assign(new widget2d(), { position: property });
  assert.equal(widget.dragStart.call({ ctx: widget }), false);
  assert.equal(widget.resizeDragStart.call({ ctx: widget }), false);
  const gizmo = Object.assign(new widget3d(), { position: property });
  assert.equal(gizmo.dragStart(), false);
  for (const method of ["setValue", "moveKeyframe", "deleteKeyframe", "setControlPoints", "setExpression"]) {
    propertyOps[method]({ property: 0 });
  }
  propertyOps.pasteKeyframes(property, []);
  propertyOps.startEdit(property);
  objectOps.createObject({ newParentAddress: 1 });
  objectOps.deleteObject({ oldParentAddress: 1 });
  objectOps.moveObject({ oldParentAddress: 3, newParentAddress: 1 });
  assert.deepEqual(calls, []);
  locked.zoidiumLocked = false;
  propertyOps.setValue({ property: 0 });
  assert.equal(calls[0].name, "setValue");
});

test("locked property lists reject generateAdd while unlocked lists allow it", () => {
  const { objectOps, calls, locked, free, clip } = setup();
  const listOnLocked = { parent: clip };
  const listOnFree = { parent: { parent: free } };
  assert.equal(objectOps.generateAdd(listOnLocked), false);
  assert.deepEqual(calls.filter(call => call.name === "generateAdd"), []);
  objectOps.generateAdd(listOnFree);
  assert.equal(calls[calls.length - 1].name, "generateAdd");
  locked.zoidiumLocked = false;
  objectOps.generateAdd(listOnLocked);
  assert.equal(calls[calls.length - 1].name, "generateAdd");
});

test("track locks serialize and older tracks restore unlocked", () => {
  const { locked, Track } = setup();
  const restored = new Track();
  restored.load(JSON.parse(JSON.stringify(locked)));
  assert.equal(restored.zoidiumLocked, true);
  restored.load({});
  assert.equal(restored.zoidiumLocked, false);
  assert.equal(JSON.stringify(restored).includes("zoidiumLocked"), false);
});
