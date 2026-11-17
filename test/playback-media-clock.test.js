"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { MARKER, RETRY_MS, canClock, chooseAnchor, install, resume } = require("../plugins/core/playback-media-clock");

const FPS = 30;
const uiPath = path.join(__dirname, "..", ".zoidium-resources", "ui-1.0.72.js");
const ui = fs.existsSync(uiPath) ? fs.readFileSync(uiPath, "utf8") : null;

function extract(source, assignment) {
  const start = source.indexOf(assignment);
  assert.notEqual(start, -1, `bundle contains ${assignment}`);
  let depth = 0, quote = null;
  for (let at = source.indexOf("{", start); at < source.length; at++) {
    const c = source[at];
    if (quote) { if (c === "\\") at++; else if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return source.slice(start, at + 1);
  }
  throw new Error("unterminated " + assignment);
}

function element(extra = {}) {
  const el = { paused: false, seeking: false, ended: false, readyState: 4, currentTime: 0, playbackRate: 1, muted: false, plays: 0,
    HAVE_ENOUGH_DATA: 4, play() { this.plays++; this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } };
  return Object.assign(el, extra);
}
function schedule(el, start = 0) {
  const clip = { start, length: 600, properties: { time: { animated: false, keyframes: [{ value: 0 }, { value: 20 }],
    get: frame => frame / FPS } } };
  return { el, playing: true, currentItem: { start, clip }, update() {} };
}

test("an element that cannot run is not a clock", () => {
  assert.equal(canClock(schedule(element())), true);
  for (const state of [{ paused: true }, { seeking: true }, { ended: true }, { readyState: 2 }])
    assert.equal(canClock(schedule(element(state))), false, JSON.stringify(state));
  const idle = schedule(element()); idle.playing = false;
  assert.equal(canClock(idle), false);
});

test("a stalled anchor yields to another running element or to the frame clock", () => {
  const stalled = schedule(element({ paused: true })), running = schedule(element());
  const playback = { syncSchedule: stalled, _sequence: { audioSchedules: [stalled], videoSchedules: [running] } };
  assert.equal(chooseAnchor(playback), running);
  running.el.readyState = 1;
  assert.equal(chooseAnchor(playback), null);
  const healthy = { syncSchedule: running, _sequence: { audioSchedules: [], videoSchedules: [] } };
  running.el.readyState = 4;
  assert.equal(chooseAnchor(healthy), running, "a running anchor is kept");
});

test("an offset video material cannot rewind the playback clock", () => {
  const audio = schedule(element({ paused: true }));
  const video = schedule(element({ currentTime: 0 }));
  video.currentItem.start = 97;
  const playback = { syncSchedule: audio, _sequence: { audioSchedules: [audio], videoSchedules: [video] } };
  assert.equal(chooseAnchor(playback), null);
  playback.syncSchedule = video;
  assert.equal(chooseAnchor(playback), null, "a newly selected native anchor is also retired");
  video.currentItem.start = video.currentItem.clip.start;
  assert.equal(chooseAnchor(playback), video, "an unshifted video can still be a clock");
});

test("a paused element that is still scheduled to play is resumed at most every retry window", () => {
  const el = element({ paused: true }), item = schedule(el);
  const playback = { speed: 1 };
  resume(playback, item);
  assert.equal(el.plays, 1);
  el.paused = true;
  resume(playback, item);
  assert.equal(el.plays, 1, "no retry inside the window");
  item.__zoidiumPlaybackMediaClockState.retryAt -= RETRY_MS;
  resume(playback, item);
  assert.equal(el.plays, 2);
  for (const blocked of [{ ended: true }, { paused: false }]) {
    const other = element({ paused: true, ...blocked });
    resume(playback, schedule(other));
    assert.equal(other.plays, 0, JSON.stringify(blocked));
  }
  const stopped = element({ paused: true });
  resume({ speed: 0 }, schedule(stopped));
  assert.equal(stopped.plays, 0, "stopped playback does not resume media");
  const rejecting = element({ paused: true, play() { this.plays++; return Promise.reject(new Error("NotAllowedError")); } });
  assert.doesNotThrow(() => resume(playback, schedule(rejecting)));
});

function nativePlayback() {
  const PZ = { ui: { playback: function () {} } };
  global.requestAnimationFrame = () => 0;
  global.Audio = function Audio() {};
  new Function("PZ", extract(ui, "PZ.ui.playback.prototype.update=function") + ";" +
    extract(ui, "PZ.ui.playback.prototype.updateSchedule=function") + ";")(PZ);
  return PZ;
}
function run(PZ, anchorElement) {
  const audio = schedule(anchorElement);
  const playback = Object.create(PZ.ui.playback.prototype);
  Object.assign(playback, { frameRate: FPS, speed: 1, loop: false, totalFrames: 600, lastFrame: 0, _exactFrame: 30,
    _currentFrame: 30, syncSchedule: audio, currentFrame: 30,
    _sequence: { update() {}, audioSchedules: [audio], videoSchedules: [] } });
  anchorElement.currentTime = 1;
  // One second of 60 Hz ticks with the anchor element stuck at 1 s.
  for (let tick = 1; tick <= 60; tick++) playback.update(tick * 1000 / 60);
  return { playback, audio };
}

test("a fallback to an offset material does not reset native playback", { skip: !ui }, () => {
  try {
    function tick(patched) {
      const PZ = nativePlayback();
      if (patched) install(PZ);
      const video = schedule(element());
      video.currentItem.start = 97;
      const playback = Object.create(PZ.ui.playback.prototype);
      Object.assign(playback, { frameRate: FPS, speed: 1, loop: false, totalFrames: 600, lastFrame: 0,
        _exactFrame: 97, _currentFrame: 97, syncSchedule: video, currentFrame: 97,
        _sequence: { update() {}, audioSchedules: [], videoSchedules: [video] } });
      playback.update(1000 / 60);
      return playback._exactFrame;
    }
    assert.equal(tick(false), 0, "native clock uses the parent clip start");
    assert.ok(tick(true) > 97, "the patched clock advances from the playhead");
  } finally { delete global.requestAnimationFrame; delete global.Audio; }
});

test("native CM3 freezes the playhead on a paused anchor element", { skip: !ui }, () => {
  try {
    const { playback } = run(nativePlayback(), element({ paused: true, play() { return Promise.resolve(); } }));
    assert.ok(Math.abs(playback._exactFrame - 30) < 1, `frozen at ${playback._exactFrame}`);
  } finally { delete global.requestAnimationFrame; delete global.Audio; }
});

test("the patched clock keeps playback moving and resumes the element", { skip: !ui }, () => {
  try {
    const PZ = nativePlayback();
    assert.equal(install(PZ), true);
    assert.equal(PZ.ui.playback.prototype[MARKER], true);
    assert.equal(install(PZ), true, "installing twice is a no-op");
    const stuck = element({ paused: true, play() { this.plays++; return Promise.resolve(); } });
    const { playback, audio } = run(PZ, stuck);
    assert.ok(playback._exactFrame > 55, `advanced to ${playback._exactFrame}`);
    assert.equal(stuck.plays, 1, "asked the paused element to play once in the retry window");
    // Once the element runs again it is the clock again.
    stuck.paused = false;
    playback.syncSchedule = audio;
    stuck.currentTime = 3;
    playback.update(2000);
    assert.ok(Math.abs(playback._exactFrame - 90) < 1, `re-anchored at ${playback._exactFrame}`);
  } finally { delete global.requestAnimationFrame; delete global.Audio; }
});

test("after a fallback the frame clock stays; reverse and stopped playback are untouched", () => {
  const PZ = { ui: { playback: { prototype: {
    update() { this.updated = (this.updated || 0) + 1; },
    updateSchedule() {},
  } } } };
  assert.equal(install(PZ), true);
  const stalled = schedule(element({ paused: true }));
  const playback = Object.create(PZ.ui.playback.prototype);
  Object.assign(playback, { speed: 1, syncSchedule: stalled, _sequence: { audioSchedules: [stalled], videoSchedules: [] } });
  playback.update(16);
  assert.equal(playback.syncSchedule, null, "the stalled anchor is dropped");
  stalled.el.paused = false;
  playback.update(32);
  assert.equal(playback.syncSchedule, null, "the fallback is kept for the rest of the run");
  const reverse = Object.create(PZ.ui.playback.prototype);
  const paused = schedule(element({ paused: true }));
  Object.assign(reverse, { speed: -1, syncSchedule: paused, _sequence: { audioSchedules: [paused], videoSchedules: [] } });
  reverse.update(16);
  reverse.updateSchedule(paused, -1);
  assert.equal(paused.el.plays, 0, "reverse playback never resumes media");
  const stopped = Object.create(PZ.ui.playback.prototype);
  Object.assign(stopped, { speed: 0, syncSchedule: paused, _sequence: { audioSchedules: [paused], videoSchedules: [] } });
  stopped.update(16);
  assert.equal(stopped.syncSchedule, paused, "stopped playback keeps its anchor");
});
