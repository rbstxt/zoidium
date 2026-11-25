"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { planBoundaryInsert, applyBoundaryInsert } = require("../plugins/core/timeline-track-insert");
const { host, fixture } = require("./helpers/editor-identity-host.cjs");

const root = path.resolve(__dirname, "..");
const cache = process.env.ZOIDIUM_RESOURCE_DIR || path.join(root, ".zoidium-resources");
const hasCache = ["three.r91.min.js", "core-1.0.102.js", "ui-1.0.72.js"]
  .every(file => fs.existsSync(path.join(cache, file)));

// These checks run the real minified CM3 createTrack / moveClipProxies, so
// they skip in a checkout that has not staged the Git-ignored resource cache.
const skip = !hasCache && "the CM3 resource cache is not staged";

function element(label) {
  const node = {
    label,
    style: {},
    children: [],
    pz_object: null,
    top: 0,
    height: 40,
    appendChild(child) {
      if (child.parentElement) child.parentElement.remove(child);
      child.parentElement = node;
      node.children.push(child);
      return child;
    },
    remove(child) {
      if (child && child !== node && child.parentElement) {
        const index = child.parentElement.children.indexOf(child);
        if (index >= 0) child.parentElement.children.splice(index, 1);
        child.parentElement = null;
        return;
      }
      node.removed = true;
    },
    getBoundingClientRect() {
      return { top: node.top, height: node.height, left: 0, width: 800 };
    },
  };
  node.classList = { contains: name => name === "proxy" && node.proxy === true };
  return node;
}

function createHistory() {
  const undoStack = [];
  const redoStack = [];
  let operation = null;
  const replay = commands => {
    operation = [];
    for (let index = commands.length - 1; index >= 0; index -= 1) {
      commands[index].fn(commands[index].arg);
    }
  };
  return {
    undoStack,
    redoStack,
    get operation() { return operation; },
    startOperation() { operation = []; },
    pushCommand(fn, arg) { operation.push({ fn, arg }); },
    finishOperation(redo) {
      if (operation.length) {
        if (redo === true) redoStack.push(operation);
        else undoStack.push(operation);
      }
      operation = null;
    },
    undo() {
      const commands = undoStack.pop();
      if (!commands) return false;
      replay(commands);
      if (operation.length) redoStack.push(operation);
      operation = null;
      return true;
    },
    redo() {
      const commands = redoStack.pop();
      if (!commands) return false;
      replay(commands);
      if (operation.length) undoStack.push(operation);
      operation = null;
      return true;
    },
  };
}

function setup() {
  const PZ = host().PZ;
  const { project, track: first, clip: color } = fixture({ PZ });
  const sequence = project.sequence;
  color.properties.load();
  color.start = 10;
  color.length = 30;

  const second = new PZ.track.video();
  const third = new PZ.track.video();
  sequence.videoTracks.push(second, third);
  const thyro = new PZ.clip.video(6);
  thyro.start = 0;
  thyro.length = 100;
  second.clips.push(thyro);
  thyro.properties.load();

  const videoContainer = element("video");
  const audioContainer = element("audio");
  const trackElements = sequence.videoTracks.map((item, index) => {
    const node = element("V" + (index + 1));
    node.pz_object = item;
    node.top = (sequence.videoTracks.length - 1 - index) * 40;
    videoContainer.appendChild(node);
    return node;
  });

  const clipElement = element("COLOR");
  clipElement.pz_object = color;
  trackElements[0].appendChild(clipElement);

  const history = createHistory();
  const tracks = Object.create(PZ.ui.timeline.tracks.prototype);
  tracks.timeline = {
    sequence,
    editor: { history },
    pxToFrame: px => Math.round(px),
    frameToPx: frames => frames,
  };
  tracks.sequence = sequence;
  tracks.videoContainer = videoContainer;
  tracks.audioContainer = audioContainer;

  const proxy = element("proxy");
  proxy.proxy = true;
  proxy.pz_clip = clipElement;
  proxy.pz_object = color;
  proxy.pz_type = 0;
  proxy.style.left = "10px";
  proxy.style.width = "30px";
  trackElements[0].appendChild(proxy);

  return { PZ, sequence, tracks, history, color, thyro, proxy, first, second, third, trackElements, videoContainer };
}

test("the real moveClipProxies moves the clip into the inserted empty row", { skip }, () => {
  const { sequence, tracks, history, color, thyro, proxy, first, second } = setup();

  const plan = planBoundaryInsert(tracks, [proxy], 0, 1, undefined);
  assert.deepEqual(plan.entries.map(entry => [entry.sourceIndex, entry.newIndex]), [[0, 1]]);

  history.startOperation();
  applyBoundaryInsert(tracks, plan, false);
  history.finishOperation();

  assert.equal(sequence.videoTracks.length, 4);
  assert.equal(sequence.videoTracks[0].clips.length, 0);
  assert.equal(sequence.videoTracks[1].clips[0], color, "the clip lands on the new row");
  assert.equal(color.start, 10, "the dragged time survives");
  assert.equal(sequence.videoTracks[2].clips[0], thyro, "the neighbour keeps its clip");
  assert.equal(thyro.start, 0, "the neighbour keeps its start");
  assert.equal(thyro.length, 100, "the neighbour is not trimmed");
  assert.equal(history.undoStack.length, 1, "the insert and move are one operation");
  assert.equal(first.clips.length, 0);
  assert.equal(second.clips[0], thyro);
});

test("the real createTrack inverse restores the row and the clip", { skip }, () => {
  const { sequence, tracks, history, color, thyro, first, second, proxy } = setup();
  const plan = planBoundaryInsert(tracks, [proxy], 0, 1, undefined);
  history.startOperation();
  applyBoundaryInsert(tracks, plan, false);
  history.finishOperation();
  assert.equal(sequence.videoTracks.length, 4);

  assert.equal(history.undo(), true);
  assert.equal(sequence.videoTracks.length, 3, "undo removes the inserted row");
  assert.equal(sequence.videoTracks[0].clips[0], color, "the clip returns to V1");
  assert.equal(color.start, 10);
  assert.equal(sequence.videoTracks[1].clips[0], thyro, "the neighbour is back on V2");
  assert.equal(first.clips[0], color);
  assert.equal(second.clips[0], thyro);

  assert.equal(history.redo(), true);
  assert.equal(sequence.videoTracks.length, 4, "redo recreates the row");
  assert.equal(sequence.videoTracks[1].clips[0], color, "redo moves the clip again");
  assert.equal(sequence.videoTracks[0].clips.length, 0);
  assert.equal(sequence.videoTracks[2].clips[0], thyro);
});
