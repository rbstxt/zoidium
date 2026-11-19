"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  TRIM_PATCH_MARKER,
  TRIM_STATE_KEY,
  MIN_HANDLE_WIDTH,
  MAX_HANDLE_WIDTH,
  handleWidthPx,
  trimBounds,
  resolveTrimDelta,
  collectTrimTargets,
  installTrimPatch,
} = require("../plugins/core/videoeditor-timeline-defaults");

const RATE = 30;

function makeClip(options) {
  const rate = options.rate === undefined ? RATE : options.rate;
  const timeEnd = options.timeEnd === undefined ? options.length / rate : options.timeEnd;
  return {
    start: options.start === undefined ? 0 : options.start,
    length: options.length === undefined ? 60 : options.length,
    mediaLength: options.mediaLength === undefined ? Infinity : options.mediaLength,
    properties: {
      time: {
        animated: false,
        keyframes: [
          { value: options.timeStart === undefined ? 0 : options.timeStart },
          { value: timeEnd },
        ],
      },
    },
  };
}

function endTask(clip) {
  return { clip, edge: "end" };
}

function startTask(clip) {
  return { clip, edge: "start" };
}

// A minimal DOM: classList, style, parent/child links, and the two selectors
// the trim patch reads (".clip" and ".clip.selected").
class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.parentElement = null;
    this.style = {};
    this.pz_object = null;
    this.classList = {
      values: new Set(),
      add: (...names) => names.forEach(name => this.classList.values.add(name)),
      remove: (...names) => names.forEach(name => this.classList.values.delete(name)),
      contains: name => this.classList.values.has(name),
    };
  }

  appendChild(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  descendants() {
    const result = [];
    const walk = element => {
      for (const child of element.children) {
        result.push(child);
        walk(child);
      }
    };
    walk(this);
    return result;
  }

  getElementsByClassName(name) {
    const names = name.split(/\s+/).filter(Boolean);
    return this.descendants().filter(element => names.every(part => element.classList.contains(part)));
  }

  querySelectorAll(selector) {
    const names = selector.split(".").filter(Boolean);
    return this.descendants().filter(element => names.every(name => element.classList.contains(name)));
  }
}

function buildScene(specs) {
  const container = new FakeElement("div");
  const video = new FakeElement("div");
  container.appendChild(video);
  const tracks = new Map();
  const trackFor = index => {
    if (!tracks.has(index)) {
      const track = new FakeElement("div");
      video.appendChild(track);
      tracks.set(index, track);
    }
    return tracks.get(index);
  };
  const elements = specs.map(spec => {
    const element = new FakeElement("div");
    element.classList.add("clip");
    if (spec.selected) element.classList.add("selected");
    element.pz_object = makeClip(spec);
    if (spec.width) element.style.width = spec.width;
    const left = new FakeElement("div");
    left.classList.add("handle");
    left.style.left = "0";
    left.style.right = "";
    const right = new FakeElement("div");
    right.classList.add("handle");
    right.style.right = "0";
    right.style.left = "";
    element.appendChild(left);
    element.appendChild(right);
    trackFor(spec.track || 0).appendChild(element);
    return { element, left, right, clip: element.pz_object };
  });
  return { container, video, tracks, elements };
}

const HANDLE_RIGHT = "end";
const HANDLE_LEFT = "start";

function handleFor(entry, edge) {
  return edge === HANDLE_RIGHT ? entry.right : entry.left;
}

// Mirrors the native gesture enough for the patch: handle drags build one
// proxy per selected handle, and the end applies every proxy in one history
// operation.
function createTracks(scene) {
  const history = {
    operations: 0,
    open: false,
    undos: [],
    startOperation() {
      this.operations += 1;
      this.open = true;
    },
    finishOperation() {
      this.open = false;
    },
    pushUndo(undo) {
      this.undos.push(undo);
    },
    undo() {
      const undo = this.undos.pop();
      if (undo) undo();
    },
  };

  function Tracks() {}

  Tracks.prototype.deselectHandles = function deselectHandles() {
    for (const handle of tracks.container.getElementsByClassName("handle selected")) {
      handle.classList.remove("selected");
    }
  };

  Tracks.prototype.selectClips = function selectClips() {
    this.selection = this.container.querySelectorAll(".clip.selected").map(element => element.pz_object);
  };

  Tracks.prototype.addressToEl = function addressToEl(address) {
    return this.addressMap[address] || null;
  };

  Tracks.prototype.handleDragStart = function handleDragStart(event) {
    const tracks = this.ctx;
    tracks.startCalls = (tracks.startCalls || 0) + 1;
    this.clip = event.currentTarget.parentElement;
    this.isRightHandle = parseFloat(event.currentTarget.style.right) === 0;
    this.rate = RATE;
    this.adjustTime = true;
    this.rateStretch = false;
    this.offset = 0;
    this.snap = false;
    this.moved = false;
    this.currentPt = { x: 0 };
    this.clip_proxies = [];
    for (const handle of tracks.container.getElementsByClassName("handle selected")) {
      const clipElement = handle.parentElement;
      this.clip_proxies.push({
        pz_object: clipElement.pz_object,
        pz_clip: clipElement,
        leftHandle: parseFloat(handle.style.right) !== 0,
        rightHandle: parseFloat(handle.style.right) === 0,
        style: {},
      });
    }
    return true;
  };

  Tracks.prototype.handleDragUpdate = function handleDragUpdate() {
    this.ctx.originalUpdates = (this.ctx.originalUpdates || 0) + 1;
  };

  Tracks.prototype.handleDragEnd = function handleDragEnd() {
    const tracks = this.ctx;
    tracks.endCalls = (tracks.endCalls || 0) + 1;
    tracks.history.startOperation();
    tracks.moveClipProxies(this.clip_proxies);
    tracks.history.finishOperation();
    tracks.selectClips();
    return "ended";
  };

  Tracks.prototype.moveClipProxies = function moveClipProxies(proxies) {
    this.moveCalls = (this.moveCalls || 0) + 1;
    const before = proxies.map(proxy => ({
      clip: proxy.pz_object,
      start: proxy.pz_object.start,
      length: proxy.pz_object.length,
    }));
    for (const proxy of proxies) {
      if (Number.isFinite(proxy.pz_start)) proxy.pz_object.start = proxy.pz_start;
      if (Number.isFinite(proxy.pz_length)) proxy.pz_object.length = proxy.pz_length;
    }
    this.history.pushUndo(() => {
      for (const state of before) {
        state.clip.start = state.start;
        state.clip.length = state.length;
      }
    });

    // CM3 resolves overlaps after applying the moves by shortening or
    // removing the clips that follow on each track.
    const touchedTracks = new Set(proxies.map(proxy => proxy.pz_clip && proxy.pz_clip.parentElement));
    for (const track of touchedTracks) {
      if (!track) continue;
      const clips = track.children.map(element => element.pz_object)
        .sort((left, right) => left.start - right.start);
      for (let index = 0; index < clips.length - 1; index += 1) {
        const current = clips[index];
        const next = clips[index + 1];
        const end = current.start + current.length;
        if (next.start >= end) continue;
        const nextEnd = next.start + next.length;
        next.start = end;
        next.length = nextEnd - end;
      }
    }
  };

  // The native sizing the patch refines: 20% of the clip, at most 50 px.
  Tracks.prototype.resizeClip = function resizeClip(clipElement) {
    this.resizeCalls = (this.resizeCalls || 0) + 1;
    const clipWidth = parseFloat(clipElement.style.width);
    if (Number.isFinite(clipWidth)) {
      const nativeWidth = Math.min(50, 0.2 * clipWidth) + "px";
      for (const handle of clipElement.getElementsByClassName("handle")) {
        handle.style.width = nativeWidth;
      }
    }
  };

  assert.equal(
    installTrimPatch({ ui: { timeline: { tracks: Tracks } } }),
    true,
    "the trim patch installs on the fixture prototype",
  );

  const tracks = new Tracks();
  tracks.container = scene.container;
  tracks.selection = [];
  tracks.history = history;
  tracks.addressMap = {};
  tracks.timeline = {
    zoom: 1,
    scrollBar: { scrollLeft: 0 },
    frameToPx: value => value,
    keepInView() {},
  };
  tracks.snap = pixels => Math.round(pixels);
  return { Tracks, tracks, history };
}

function beginTrim(tracks, entry, edge) {
  const dragCtx = { ctx: tracks, currentPt: { x: 0 } };
  const handle = handleFor(entry, edge);
  tracks.handleDragStart.call(dragCtx, {
    currentTarget: handle,
    altKey: false,
    shiftKey: false,
  });
  return dragCtx;
}

function moveTrim(dragCtx, pixels) {
  dragCtx.currentPt.x = pixels;
  dragCtx.ctx.handleDragUpdate.call(dragCtx);
}

test("one delta keeps every selected clip aligned", () => {
  const tasks = [
    endTask(makeClip({ start: 0, length: 60 })),
    endTask(makeClip({ start: 100, length: 90 })),
    endTask(makeClip({ start: 220, length: 40 })),
  ];
  assert.equal(resolveTrimDelta(tasks, 25, RATE, true), 25);
  assert.equal(resolveTrimDelta(tasks, -20, RATE, true), -20);
});

test("the media length of a selected video caps the whole trim", () => {
  const tasks = [
    endTask(makeClip({ start: 0, length: 60 })),
    endTask(makeClip({ start: 120, length: 90, mediaLength: 100, timeEnd: 2 })),
    endTask(makeClip({ start: 260, length: 40 })),
  ];
  // timeEnd * rate is 60 frames, so this clip can grow by 40 frames.
  assert.equal(resolveTrimDelta(tasks, 90, RATE, true), 40);
  assert.equal(resolveTrimDelta(tasks, 20, RATE, true), 20);
});

test("the start edge clamps at the first time sample", () => {
  // The clip already sits on the first source frame, so it cannot grow left.
  const firstFrame = [startTask(makeClip({ start: 5, length: 60 }))];
  assert.equal(resolveTrimDelta(firstFrame, -20, RATE, true), -0);

  const mediaStart = [startTask(makeClip({ start: 100, length: 60, timeStart: 1 }))];
  // A one-second source offset can give back at most 30 frames.
  assert.equal(resolveTrimDelta(mediaStart, -45, RATE, true), -30);
});

test("media bounds keep multi-clip trims on whole frames", () => {
  const start = [startTask(makeClip({ start: 10, length: 30, timeStart: 0.05 }))];
  const end = [endTask(makeClip({ start: 0, length: 30, mediaLength: 40, timeEnd: 1.05 }))];
  assert.equal(resolveTrimDelta(start, -10, RATE, true), -1);
  assert.equal(resolveTrimDelta(end, 10, RATE, true), 8);
});

test("no selected clip shrinks below one frame", () => {
  assert.equal(
    resolveTrimDelta([startTask(makeClip({ start: 0, length: 10 }))], 20, RATE, true),
    9,
  );
  assert.equal(
    resolveTrimDelta([endTask(makeClip({ start: 0, length: 10 }))], -20, RATE, true),
    -9,
  );
});

test("the strictest limit wins across mixed clips and edges", () => {
  const tasks = [
    startTask(makeClip({ start: 5, length: 60 })),
    startTask(makeClip({ start: 50, length: 5 })),
    startTask(makeClip({ start: 90, length: 60, timeStart: 0.5 })),
  ];
  // The 5-frame clip can grow by 4 frames, less than the others allow.
  assert.equal(resolveTrimDelta(tasks, 30, RATE, true), 4);
});

test("the trim zone grows to a usable width but keeps a middle third", () => {
  assert.equal(handleWidthPx(1000), MAX_HANDLE_WIDTH);
  assert.equal(handleWidthPx(100), 20);
  assert.equal(handleWidthPx(30), MIN_HANDLE_WIDTH);
  assert.ok(Math.abs(handleWidthPx(20) - 20 / 3) < 1e-12);
  assert.equal(handleWidthPx(9), 3);
  assert.equal(handleWidthPx(Number.NaN), null);
});

test("a multi-selection trims the same edge of every selected clip in one undo step", () => {
  const scene = buildScene([
    { start: 0, length: 60, selected: true },
    { start: 100, length: 90, selected: true },
    { start: 220, length: 40, selected: true },
    { start: 300, length: 50, selected: false },
  ]);
  const { tracks, history } = createTracks(scene);
  const dragCtx = beginTrim(tracks, scene.elements[0], HANDLE_RIGHT);

  assert.deepEqual(
    dragCtx[TRIM_STATE_KEY].added.map(handle => handle.parentElement),
    scene.elements.slice(0, 3).map(entry => entry.element),
    "only the three selected clips join the trim",
  );
  assert.equal(scene.elements[0].right.classList.contains("selected"), true);
  assert.equal(scene.elements[1].right.classList.contains("selected"), true);
  assert.equal(scene.elements[2].right.classList.contains("selected"), true);
  assert.equal(scene.elements[3].right.classList.contains("selected"), false);

  moveTrim(dragCtx, 85);
  assert.equal(dragCtx.clip_proxies.length, 3);
  assert.equal(dragCtx.clip_proxies[0].pz_length, 85);
  assert.equal(dragCtx.clip_proxies[1].pz_length, 115);
  assert.equal(dragCtx.clip_proxies[2].pz_length, 65);
  assert.equal(scene.elements[0].clip.length, 60, "the model changes only when the drag ends");

  assert.equal(tracks.handleDragEnd.call(dragCtx, {}), "ended");
  assert.equal(history.operations, 1, "the whole drag is one undo operation");
  assert.equal(tracks.moveCalls, 1, "one native move applies every proxy");

  assert.deepEqual(
    scene.elements.map(entry => entry.clip.length),
    [85, 115, 65, 50],
  );
  assert.deepEqual(
    scene.elements.map(entry => entry.clip.start),
    [0, 100, 220, 300],
  );

  assert.equal(scene.elements[1].right.classList.contains("selected"), false);
  assert.equal(scene.elements[2].right.classList.contains("selected"), false);
  assert.equal(scene.elements[0].right.classList.contains("selected"), true, "the grabbed edge keeps its state");

  history.undo();
  assert.deepEqual(
    scene.elements.map(entry => entry.clip.length),
    [60, 90, 40, 50],
    "one undo restores every trimmed clip",
  );
});

test("a media-limited video caps the shared delta while other clips stay aligned", () => {
  const scene = buildScene([
    { start: 0, length: 60, selected: true },
    { start: 120, length: 90, selected: true, mediaLength: 100, timeEnd: 2 },
    { start: 260, length: 40, selected: true },
  ]);
  const { tracks } = createTracks(scene);
  const dragCtx = beginTrim(tracks, scene.elements[0], HANDLE_RIGHT);

  moveTrim(dragCtx, 300);
  assert.deepEqual(
    dragCtx.clip_proxies.map(proxy => proxy.pz_length),
    [100, 130, 80],
    "every clip moves by the 40 frames the video source allows",
  );
});

test("the start edge moves every selected clip's start together", () => {
  const scene = buildScene([
    { start: 30, length: 60, selected: true, timeStart: 5 },
    { start: 120, length: 90, selected: true, timeStart: 5 },
    { start: 240, length: 40, selected: true, timeStart: 5 },
  ]);
  const { tracks } = createTracks(scene);
  const dragCtx = beginTrim(tracks, scene.elements[0], HANDLE_LEFT);

  moveTrim(dragCtx, 10);
  tracks.handleDragEnd.call(dragCtx, {});
  assert.deepEqual(
    scene.elements.map(entry => entry.clip.start),
    [10, 100, 220],
  );
  assert.deepEqual(
    scene.elements.map(entry => entry.clip.length),
    [80, 110, 60],
  );
});

test("a clip outside the selection keeps native single-clip trimming", () => {
  const scene = buildScene([
    { start: 0, length: 60, selected: false },
    { start: 100, length: 90, selected: true },
    { start: 220, length: 40, selected: true },
  ]);
  const { tracks } = createTracks(scene);
  const dragCtx = beginTrim(tracks, scene.elements[0], HANDLE_RIGHT);

  assert.equal(dragCtx[TRIM_STATE_KEY], undefined);
  moveTrim(dragCtx, 75);
  assert.equal(tracks.originalUpdates, 1, "the native update handles the single trim");
  tracks.handleDragEnd.call(dragCtx, {});
  assert.equal(tracks.moveCalls, 1);
});

test("a single selection keeps native single-clip trimming", () => {
  const scene = buildScene([
    { start: 0, length: 60, selected: true },
    { start: 100, length: 90, selected: false },
  ]);
  const { tracks } = createTracks(scene);
  const dragCtx = beginTrim(tracks, scene.elements[0], HANDLE_RIGHT);

  assert.equal(dragCtx[TRIM_STATE_KEY], undefined);
  moveTrim(dragCtx, 75);
  assert.equal(tracks.originalUpdates, 1);
});

test("link members join the trimmed set and Alt keeps the plain selection", () => {
  const scene = buildScene([
    { start: 0, length: 60, selected: true },
    { start: 100, length: 90, selected: true },
    { start: 220, length: 40, selected: false },
  ]);
  scene.elements[0].clip.link = {
    clips: [
      { getAddress: () => "a" },
      { getAddress: () => "c" },
    ],
  };
  const tracks = {
    container: scene.container,
    addressToEl: address => ({ a: scene.elements[0].element, c: scene.elements[2].element })[address],
  };

  assert.deepEqual(
    collectTrimTargets(tracks, scene.elements[0].element, {}).map(element => element.pz_object),
    [scene.elements[0].clip, scene.elements[1].clip, scene.elements[2].clip],
  );
  assert.deepEqual(
    collectTrimTargets(tracks, scene.elements[0].element, { altKey: true }).map(element => element.pz_object),
    [scene.elements[0].clip, scene.elements[1].clip],
  );
  assert.equal(
    collectTrimTargets(tracks, scene.elements[2].element, {}),
    null,
    "a clip outside the selection is not a trim target",
  );
});

test("resizeClip widens the trim handles inside the clip edge", () => {
  const scene = buildScene([
    { start: 0, length: 60, selected: true, width: "300px" },
    { start: 100, length: 90, selected: true, width: "30px" },
    { start: 220, length: 40, selected: true, width: "20px" },
  ]);
  const { tracks } = createTracks(scene);

  tracks.resizeClip(scene.elements[0].element);
  tracks.resizeClip(scene.elements[1].element);
  tracks.resizeClip(scene.elements[2].element);

  assert.equal(scene.elements[0].left.style.width, "50px");
  assert.equal(scene.elements[0].right.style.width, "50px");
  assert.equal(scene.elements[1].left.style.width, "8px");
  assert.equal(scene.elements[2].right.style.width, `${20 * (1 / 3)}px`);
});

test("the trim patch installs once and refuses an incomplete timeline", () => {
  const scene = buildScene([{ selected: true }]);
  const { Tracks } = createTracks(scene);
  assert.equal(installTrimPatch({ ui: { timeline: { tracks: Tracks } } }), false);
  assert.equal(Tracks.prototype[TRIM_PATCH_MARKER], true);

  assert.equal(installTrimPatch(null), false);
  assert.equal(installTrimPatch({ ui: { timeline: { tracks: { prototype: {} } } } }), false);
});

test("a neighbour collision resolves for every trimmed clip, as in a single trim", () => {
  const scene = buildScene([
    { start: 0, length: 60, selected: true, track: 0 },
    { start: 80, length: 40, selected: false, track: 0 },
    { start: 0, length: 50, selected: true, track: 1 },
  ]);
  const { tracks } = createTracks(scene);
  const dragCtx = beginTrim(tracks, scene.elements[0], HANDLE_RIGHT);

  // Thirty frames to the right pushes A's end from 60 to 90, past B's start.
  moveTrim(dragCtx, 90);
  tracks.handleDragEnd.call(dragCtx, {});

  const trackTwo = scene.tracks.get(0).children.map(element => element.pz_object)
    .sort((left, right) => left.start - right.start);
  assert.deepEqual(
    trackTwo.map(clip => ({ start: clip.start, length: clip.length })),
    [{ start: 0, length: 90 }, { start: 90, length: 30 }],
    "the native overlap pass shortens the following clip",
  );
  assert.equal(scene.elements[2].clip.length, 80, "the other selected clip moved by the same delta");
  for (let index = 0; index < trackTwo.length - 1; index += 1) {
    assert.ok(
      trackTwo[index].start + trackTwo[index].length <= trackTwo[index + 1].start,
      "clips on the track do not overlap",
    );
  }
});

test("trimBounds reports the limits for one clip", () => {
  const clip = makeClip({ start: 10, length: 50, mediaLength: 80, timeStart: 0.5, timeEnd: 1.5 });
  assert.deepEqual(trimBounds(clip, "start", RATE, true), { lower: -10, upper: 49 });
  assert.deepEqual(trimBounds(clip, "end", RATE, true), { lower: -49, upper: 35 });
});
