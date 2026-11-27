"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { planBoundaryInsert, applyBoundaryInsert, planNoOverwrite, applyNoOverwrite } =
  require("../plugins/core/timeline-track-insert");
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

// The real createTrack only splices the sequence; the timeline UI inserts the
// row element from its trackCreated handler. Emulate that so the following
// moveClipProxies call sees the same DOM the browser builds.
function installTrackCreated(tracks, sequence, videoContainer) {
  const createTrack = tracks.createTrack;
  tracks.createTrack = function (command) {
    createTrack.call(this, command);
    const list = command.type === 0 ? sequence.videoTracks : sequence.audioTracks;
    const container = command.type === 0 ? videoContainer : tracks.audioContainer;
    const node = element("new row");
    node.pz_object = list[command.newTrackIdx];
    container.children.splice(command.newTrackIdx, 0, node);
    node.parentElement = container;
  };
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

test("the real moveClipProxies leaves a neighbour untouched on an overlapping row drop", { skip }, () => {
  const { sequence, tracks, history, color, thyro, proxy, trackElements, videoContainer } = setup();
  installTrackCreated(tracks, sequence, videoContainer);

  // The native drag has moved the proxy onto V2 at the dropped time, where it
  // overlaps the neighbour clip THYRO 0..100.
  proxy.remove();
  trackElements[1].appendChild(proxy);
  proxy.style.left = "10px";
  proxy.style.width = "30px";

  const plan = planNoOverwrite(tracks, [proxy], undefined);
  assert.ok(plan, "the overlap produces a plan");
  assert.deepEqual(plan.entries.map(entry => [entry.type, entry.destIndex]), [[0, 1]]);

  history.startOperation();
  applyNoOverwrite(tracks, plan, [proxy], false);
  history.finishOperation();

  assert.equal(sequence.videoTracks.length, 4);
  assert.equal(sequence.videoTracks[2].clips[0], color, "the clip lands on the new row");
  assert.equal(color.start, 10, "the dragged time survives");
  assert.equal(sequence.videoTracks[1].clips[0], thyro, "the neighbour keeps its clip");
  assert.equal(thyro.start, 0, "the neighbour keeps its start");
  assert.equal(thyro.length, 100, "the neighbour is not trimmed");
  assert.equal(history.undoStack.length, 1, "the row and the move are one operation");
});

test("one undo reverts an overlapping row drop and redo repeats it", { skip }, () => {
  const { sequence, tracks, history, color, thyro, proxy, trackElements, videoContainer } = setup();
  installTrackCreated(tracks, sequence, videoContainer);
  proxy.remove();
  trackElements[1].appendChild(proxy);
  proxy.style.left = "10px";
  proxy.style.width = "30px";

  const plan = planNoOverwrite(tracks, [proxy], undefined);
  history.startOperation();
  applyNoOverwrite(tracks, plan, [proxy], false);
  history.finishOperation();
  assert.equal(sequence.videoTracks.length, 4);

  assert.equal(history.undo(), true);
  assert.equal(sequence.videoTracks.length, 3, "undo removes the new row");
  assert.equal(sequence.videoTracks[0].clips[0], color, "the clip returns to V1");
  assert.equal(sequence.videoTracks[0].clips[0].start, 10);
  assert.equal(sequence.videoTracks[1].clips[0], thyro);
  assert.equal(thyro.length, 100);

  assert.equal(history.redo(), true);
  assert.equal(sequence.videoTracks.length, 4, "redo recreates the row");
  assert.equal(sequence.videoTracks[2].clips[0], color);
  assert.equal(sequence.videoTracks[1].clips[0], thyro);
  assert.equal(thyro.length, 100);
});

test("the plan leaves a row drop onto empty space alone", { skip }, () => {
  const { sequence, tracks, proxy, trackElements } = setup();
  installTrackCreated(tracks, sequence, trackElements[0].parentElement);
  proxy.remove();
  trackElements[2].appendChild(proxy);
  proxy.style.left = "10px";
  proxy.style.width = "30px";

  assert.equal(planNoOverwrite(tracks, [proxy], undefined), null);
  assert.equal(sequence.videoTracks.length, 3);
});

// A project with the requested number of empty video and audio tracks, the
// real track/clip classes, and a row element for every track.
function setupRows({ video = 3, audio = 0 } = {}) {
  const PZ = host().PZ;
  const project = new PZ.project();
  project.sequence.properties.load();
  const sequence = project.sequence;
  const history = createHistory();
  const tracks = Object.create(PZ.ui.timeline.tracks.prototype);
  const videoContainer = element("video");
  const audioContainer = element("audio");
  tracks.timeline = {
    sequence,
    editor: { history },
    pxToFrame: px => Math.round(px),
    frameToPx: frames => frames,
  };
  tracks.sequence = sequence;
  tracks.videoContainer = videoContainer;
  tracks.audioContainer = audioContainer;

  const videoRows = [];
  for (let index = 0; index < video; index += 1) {
    const track = new PZ.track.video();
    sequence.videoTracks.push(track);
    const node = element("V" + (index + 1));
    node.pz_object = track;
    node.top = (video - 1 - index) * 40;
    videoContainer.appendChild(node);
    videoRows.push(node);
  }
  const audioRows = [];
  for (let index = 0; index < audio; index += 1) {
    const track = new PZ.track.audio();
    sequence.audioTracks.push(track);
    const node = element("A" + (index + 1));
    node.pz_object = track;
    node.top = index * 40;
    audioContainer.appendChild(node);
    audioRows.push(node);
  }

  function videoClip(trackIndex, start, length) {
    const clip = new PZ.clip.video(6);
    clip.start = start;
    clip.length = length;
    sequence.videoTracks[trackIndex].clips.push(clip);
    clip.properties.load();
    const node = element("clip");
    node.pz_object = clip;
    videoRows[trackIndex].appendChild(node);
    return { clip, node };
  }
  function audioClip(trackIndex, start, length) {
    const clip = new PZ.clip.audio();
    clip.start = start;
    clip.length = length;
    sequence.audioTracks[trackIndex].clips.push(clip);
    clip.properties.load();
    const node = element("clip");
    node.pz_object = clip;
    audioRows[trackIndex].appendChild(node);
    return { clip, node };
  }
  function proxyFor(target, type, left, width) {
    const proxy = element("proxy");
    proxy.proxy = true;
    proxy.pz_clip = target.node;
    proxy.pz_object = target.clip;
    proxy.pz_type = type;
    proxy.style.left = left + "px";
    proxy.style.width = width + "px";
    target.node.parentElement.appendChild(proxy);
    return proxy;
  }

  return {
    PZ, sequence, tracks, history, videoRows, audioRows, videoClip, audioClip, proxyFor,
    videoContainer, audioContainer,
  };
}

// Runs the drop either through the module's plan or through the original move
// path, so the same neighbour assertion can be shown to fail without the fix.
function drop(tracks, history, proxies, useNoOverwrite) {
  const plan = useNoOverwrite ? planNoOverwrite(tracks, proxies, undefined) : null;
  if (useNoOverwrite && !plan) return false;
  history.startOperation();
  if (plan) applyNoOverwrite(tracks, plan, proxies, false);
  else tracks.moveClipProxies(proxies, false, false);
  history.finishOperation();
  return true;
}

function overlapSetup({ video, audio }) {
  const context = setupRows({ video, audio });
  installTrackCreated(context.tracks, context.sequence, context.videoContainer);
  return context;
}

test("Shift keeps the old overwrite, which really trims the neighbour", { skip }, () => {
  const build = () => {
    const context = overlapSetup({ video: 3, audio: 0 });
    const neighbour = context.videoClip(1, 0, 100);
    const dragged = context.videoClip(0, 10, 90);
    const proxy = context.proxyFor(dragged, 0, 10, 90);
    proxy.remove();
    context.videoRows[1].appendChild(proxy);
    return { ...context, neighbour, dragged, proxy };
  };

  const native = build();
  drop(native.tracks, native.history, [native.proxy], false);
  assert.equal(native.sequence.videoTracks.length, 3, "the overwrite path creates no row");
  assert.equal(native.neighbour.clip.start, 0);
  assert.equal(native.neighbour.clip.length, 10, "the overwrite path trims the neighbour");
  assert.equal(native.sequence.videoTracks[1].clips.includes(native.dragged.clip), true);

  const guarded = build();
  assert.equal(drop(guarded.tracks, guarded.history, [guarded.proxy], true), true);
  assert.equal(guarded.sequence.videoTracks.length, 4, "the guarded path creates the row");
  assert.equal(guarded.neighbour.clip.start, 0, "the neighbour keeps its start");
  assert.equal(guarded.neighbour.clip.length, 100, "the neighbour is not trimmed");
  assert.equal(guarded.sequence.videoTracks[2].clips[0], guarded.dragged.clip);
});

test("a multi-row overlap drop leaves both neighbours untouched", { skip }, () => {
  const build = () => {
    const context = overlapSetup({ video: 4, audio: 0 });
    const lowerNeighbour = context.videoClip(2, 0, 100);
    const upperNeighbour = context.videoClip(3, 0, 100);
    const lower = context.videoClip(0, 10, 90);
    const upper = context.videoClip(1, 10, 90);
    const lowerProxy = context.proxyFor(lower, 0, 10, 90);
    const upperProxy = context.proxyFor(upper, 0, 10, 90);
    lowerProxy.remove();
    context.videoRows[2].appendChild(lowerProxy);
    upperProxy.remove();
    context.videoRows[3].appendChild(upperProxy);
    return { ...context, lowerNeighbour, upperNeighbour, lower, upper, lowerProxy, upperProxy };
  };

  const native = build();
  drop(native.tracks, native.history, [native.lowerProxy, native.upperProxy], false);
  assert.equal(native.lowerNeighbour.clip.length, 10, "the native path trims the lower neighbour");
  assert.equal(native.upperNeighbour.clip.length, 10, "the native path trims the upper neighbour");

  const guarded = build();
  assert.equal(drop(guarded.tracks, guarded.history,
    [guarded.lowerProxy, guarded.upperProxy], true), true);
  assert.equal(guarded.sequence.videoTracks.length, 6, "one new row per destination row");
  assert.equal(guarded.lowerNeighbour.clip.start, 0);
  assert.equal(guarded.lowerNeighbour.clip.length, 100, "the lower neighbour is untouched");
  assert.equal(guarded.upperNeighbour.clip.start, 0);
  assert.equal(guarded.upperNeighbour.clip.length, 100, "the upper neighbour is untouched");
  assert.equal(guarded.sequence.videoTracks[3].clips[0], guarded.lower.clip);
  assert.equal(guarded.sequence.videoTracks[5].clips[0], guarded.upper.clip);
});

test("a linked-audio overlap drop leaves both neighbours untouched", { skip }, () => {
  const build = () => {
    const context = overlapSetup({ video: 3, audio: 2 });
    const videoNeighbour = context.videoClip(1, 0, 100);
    const audioNeighbour = context.audioClip(1, 0, 100);
    const video = context.videoClip(0, 10, 90);
    const audio = context.audioClip(0, 10, 90);
    const videoProxy = context.proxyFor(video, 0, 10, 90);
    const audioProxy = context.proxyFor(audio, 1, 10, 90);
    videoProxy.remove();
    context.videoRows[1].appendChild(videoProxy);
    audioProxy.remove();
    context.audioRows[1].appendChild(audioProxy);
    return { ...context, videoNeighbour, audioNeighbour, video, audio, videoProxy, audioProxy };
  };

  const native = build();
  drop(native.tracks, native.history, [native.videoProxy, native.audioProxy], false);
  assert.equal(native.videoNeighbour.clip.length, 10, "the native path trims the video neighbour");
  assert.equal(native.audioNeighbour.clip.length, 10, "the native path trims the audio neighbour");

  const guarded = build();
  assert.equal(drop(guarded.tracks, guarded.history,
    [guarded.videoProxy, guarded.audioProxy], true), true);
  assert.equal(guarded.sequence.videoTracks.length, 4, "one new video row");
  assert.equal(guarded.sequence.audioTracks.length, 3, "one new audio row");
  assert.equal(guarded.videoNeighbour.clip.length, 100, "the video neighbour is untouched");
  assert.equal(guarded.audioNeighbour.clip.length, 100, "the audio neighbour is untouched");
  assert.equal(guarded.sequence.videoTracks[2].clips[0], guarded.video.clip);
  assert.equal(guarded.sequence.audioTracks[2].clips[0], guarded.audio.clip);
});
