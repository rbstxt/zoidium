"use strict";

// Wire-level check of plugins/core/playback-seek-sync against the real CM3
// bundle in the Git-ignored resource cache. The other test file uses a fixture
// so it runs without the cache; this one proves the patch wraps what CM3 ships.
//
// The cache is optional (pnpm run setup downloads it), so the test skips when
// the bundles are absent.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  PATCH_MARKER,
  STATE_KEY,
  install,
  markSchedulesForSeek,
} = require("../plugins/core/playback-seek-sync");

const projectRoot = path.resolve(__dirname, "..");
const FPS = 30;

function loadBundle() {
  const corePath = path.join(projectRoot, ".zoidium-resources", "core-1.0.102.js");
  const uiPath = path.join(projectRoot, ".zoidium-resources", "ui-1.0.72.js");
  if (!fs.existsSync(corePath) || !fs.existsSync(uiPath)) return null;
  return { core: fs.readFileSync(corePath, "utf8"), ui: fs.readFileSync(uiPath, "utf8") };
}

// Pull one `PZ.x.prototype.y = function ... {}` out of a single-line bundle by
// brace matching from the assignment, so the real minified function body runs.
function extractFunction(source, assignment) {
  const start = source.indexOf(assignment);
  assert.notEqual(start, -1, `bundle contains ${assignment}`);
  let index = source.indexOf("{", start + assignment.length);
  assert.notEqual(index, -1, `${assignment} has a body`);
  let depth = 0;
  let inString = null;
  for (let cursor = index; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (inString) {
      if (character === "\\") cursor += 1;
      else if (character === inString) inString = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      inString = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, cursor + 1);
    }
  }
  throw new Error(`unterminated body for ${assignment}`);
}

const bundle = loadBundle();

test("the patch wraps the real CM3 schedule update", { skip: !bundle }, () => {
  const original = extractFunction(bundle.core, "PZ.schedule.prototype.update=function");

  global.PZ = { schedule: { prototype: {} } };
  try {
    const define = new Function("PZ", `${original.replace(/^PZ\./, "PZ.")};`);
    define(global.PZ);
    const nativeUpdate = global.PZ.schedule.prototype.update;
    assert.equal(typeof nativeUpdate, "function");
    assert.notEqual(PZ.schedule.prototype[PATCH_MARKER], true);

    const PZScope = {
      schedule: PZ.schedule,
      ui: { playback: { prototype: {} } },
    };
    // The patch only needs PZ.schedule for this check; provide a playback
    // prototype with the accessor CM3 defines so install() succeeds.
    Object.defineProperty(PZScope.ui.playback.prototype, "currentFrame", {
      configurable: true,
      get() {
        return this._currentFrame;
      },
      set(value) {
        this._exactFrame = value;
        this._currentFrame = Math.round(value);
      },
    });
    assert.equal(install(PZScope), true);
    assert.notEqual(PZ.schedule.prototype.update, nativeUpdate, "update is wrapped");
    assert.equal(PZ.schedule.prototype[PATCH_MARKER], true);
  } finally {
    delete global.PZ;
  }
});

test("CM3's own schedule update leaves the element behind on a scrub", { skip: !bundle }, () => {
  // Faithful call into the real function: an item is already current, the
  // playhead jumps inside it, and the element must not move. This is the defect
  // the patch compensates for, so the assertion documents the native behaviour.
  const original = extractFunction(bundle.core, "PZ.schedule.prototype.update=function");
  global.PZ = { schedule: { prototype: {} } };
  try {
    new Function("PZ", original).call(null, global.PZ);
    const update = global.PZ.schedule.prototype.update;

    const clip = {
      properties: {
        time: { get: (frame) => Math.max(0, frame) / FPS },
      },
    };
    const item = { clip, start: 0, length: 300, media: { url: "blob:media" } };
    const element = { src: null, currentTime: 0 };
    const schedule = {
      el: element,
      padding: 60,
      items: [item],
      currentItem: item, // already loaded
      index: 0,
    };

    update.call(schedule, 285, FPS);
    assert.equal(element.currentTime, 0, "native CM3 does not reposition");
    assert.equal(schedule.currentItem, item, "the item stays current");
  } finally {
    delete global.PZ;
  }
});

test("the patch repositions the element the native update left alone", { skip: !bundle }, () => {
  const original = extractFunction(bundle.core, "PZ.schedule.prototype.update=function");
  global.PZ = { schedule: { prototype: {} } };
  try {
    new Function("PZ", original).call(null, global.PZ);

    const playbackPrototype = {};
    Object.defineProperty(playbackPrototype, "currentFrame", {
      configurable: true,
      get() {
        return this._currentFrame;
      },
      set(value) {
        this._exactFrame = value;
        this._currentFrame = Math.round(value);
      },
    });
    const PZScope = {
      schedule: global.PZ.schedule,
      ui: { playback: { prototype: playbackPrototype } },
    };
    assert.equal(install(PZScope), true);

    const clip = {
      properties: {
        time: { get: (frame) => Math.max(0, frame) / FPS },
      },
    };
    const item = { clip, start: 0, length: 300, media: { url: "blob:media" } };
    const element = { src: null, currentTime: 0 };
    const schedule = Object.create(global.PZ.schedule.prototype);
    Object.assign(schedule, {
      el: element,
      padding: 60,
      items: [item],
      currentItem: item,
      index: 0,
    });

    const sequence = {
      properties: { rate: { get: () => FPS } },
      audioSchedules: [schedule],
      videoSchedules: [],
    };
    const playback = Object.create(playbackPrototype);
    playback._sequence = sequence;
    playback._exactFrame = 0;
    playback._currentFrame = 0;

    // Idle at frame 0 so the engine position is known, then scrub to 285.
    schedule.update(0);
    assert.equal(element.currentTime, 0);
    playback.currentFrame = 285;
    markSchedulesForSeek(playback, 285);
    schedule.update(285);

    assert.equal(schedule[STATE_KEY].pendingSeek, false, "the seek was consumed");
    assert.equal(element.currentTime, 285 / FPS, "the element moved to the scrubbed frame");
  } finally {
    delete global.PZ;
  }
});
