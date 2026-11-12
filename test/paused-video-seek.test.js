"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const api = require("../plugins/core/paused-video-seek");

const VIDEO_TYPE = 7;

class FakeElement extends EventTarget {
  constructor() {
    super();
    this.currentTime = 0;
    this.seeking = false;
    this.readyState = 4;
    this.paused = true;
    this.seeks = 0;
    this.rvfc = null;
  }

  requestSeek(time) {
    this.seeks += 1;
    this.seeking = true;
    this.pendingTime = time;
  }

  completeSeek() {
    this.currentTime = this.pendingTime;
    this.seeking = false;
    this.dispatchEvent(new Event("seeked"));
  }

  requestVideoFrameCallback(callback) {
    this.rvfc = callback;
    return 1;
  }

  cancelVideoFrameCallback() {
    this.rvfc = null;
  }

  fireFrameCallback(metadata) {
    const callback = this.rvfc;
    this.rvfc = null;
    callback(0, metadata || { mediaTime: this.currentTime });
  }
}

function makeClip(mediaTimeOf) {
  return { properties: { time: { get: mediaTimeOf } } };
}

function makeSchedule(element, { start = 0, length = 100, mediaTimeOf = (local) => local / 30 } = {}) {
  return {
    type: VIDEO_TYPE,
    el: element,
    texture: { needsUpdate: false },
    currentItem: { media: { url: "blob:video" }, clip: makeClip(mediaTimeOf), start, length },
  };
}

function makeHost(schedules, { frame = 10, speed = 0 } = {}) {
  const viewport = {
    renderMode: null,
    lastFrame: null,
    renders: 0,
    editor: {
      playback: { currentFrame: frame, speed },
      project: { sequence: { videoSchedules: schedules } },
    },
    compositor: {},
  };
  const PZ = {
    schedule: { type: { VIDEO: VIDEO_TYPE } },
    ui: { viewport: class FakeViewport {} },
    zoidium: {},
  };
  PZ.ui.viewport.prototype._render = function fakeRender() {
    this.renders += 1;
    this.lastFrame = this.editor.playback.currentFrame;
  };
  Object.setPrototypeOf(viewport, PZ.ui.viewport.prototype);
  return { PZ, viewport };
}

function installFor(host) {
  const sandbox = { PZ: host.PZ, ZoidiumVideoSeekPolicy: null, setTimeout, clearTimeout };
  // The module binds its host at load time; exercise the pure path by calling
  // install with a host carrying PZ instead.
  assert.equal(api.install(sandbox), true);
  assert.equal(api.install(sandbox), true, "a second install is a no-op");
  return sandbox;
}

test("expectedMediaTime maps the active item and rejects the rest", () => {
  const schedule = makeSchedule(new FakeElement());
  assert.equal(api.expectedMediaTime(schedule, 10), 10 / 30);
  assert.equal(api.expectedMediaTime(schedule, -1), null);
  assert.equal(api.expectedMediaTime(schedule, 100), null);
  assert.equal(api.expectedMediaTime({ el: null, currentItem: null }, 10), null);
});

test("needsWait reflects seeking, readiness and clock mismatch", () => {
  const element = new FakeElement();
  element.currentTime = 10 / 30;
  const schedule = makeSchedule(element);
  assert.equal(api.needsWait(schedule, 10 / 30), false);
  element.seeking = true;
  assert.equal(api.needsWait(schedule, 10 / 30), true);
  element.seeking = false;
  element.readyState = 1;
  assert.equal(api.needsWait(schedule, 10 / 30), true);
  element.readyState = 4;
  assert.equal(api.needsWait(schedule, 0.999), true);
});

test("a paused seek holds the draw and redraws exactly once on settle", async () => {
  api.timeoutMs = 50;
  const element = new FakeElement();
  element.requestVideoFrameCallback = undefined;
  const schedule = makeSchedule(element);
  const host = makeHost([schedule], { frame: 10, speed: 0 });
  installFor(host);

  element.requestSeek(10 / 30);
  host.viewport._render();
  assert.equal(host.viewport.renders, 0, "the stale frame is not presented");
  host.viewport._render();
  assert.equal(host.viewport.renders, 0, "a repeated tick does not restart the seek");
  assert.equal(element.seeks, 1, "the module never writes the media clock itself");
  element.completeSeek();
  assert.equal(host.viewport.renders, 1, "settle requests exactly one redraw");
  assert.equal(schedule.texture.needsUpdate, true);
  assert.equal(host.viewport.lastFrame, 10);
});

test("a newer request supersedes the pending one", async () => {
  api.timeoutMs = 50;
  const element = new FakeElement();
  element.requestVideoFrameCallback = undefined;
  const schedule = makeSchedule(element);
  const host = makeHost([schedule], { frame: 10, speed: 0 });
  installFor(host);

  element.requestSeek(10 / 30);
  host.viewport._render();
  host.viewport.editor.playback.currentFrame = 12;
  element.requestSeek(12 / 30);
  host.viewport._render();
  assert.equal(host.viewport.renders, 0);
  element.completeSeek();
  assert.equal(host.viewport.renders, 1);
  assert.equal(host.viewport.lastFrame, 12);
});

test("a seek that never completes falls back after a bounded timeout", async () => {
  api.timeoutMs = 20;
  const element = new FakeElement();
  const schedule = makeSchedule(element);
  const host = makeHost([schedule], { frame: 10, speed: 0 });
  installFor(host);

  element.requestSeek(10 / 30);
  host.viewport._render();
  assert.equal(host.viewport.renders, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(host.viewport.renders, 1, "the timeout draws the fallback frame");
  assert.equal(host.viewport.lastFrame, 10);
  api.timeoutMs = 1500;
});

test("playback and projects without video draw live", () => {
  const element = new FakeElement();
  const schedule = makeSchedule(element);
  const playing = makeHost([schedule], { frame: 10, speed: 1 });
  installFor(playing);
  element.requestSeek(10 / 30);
  playing.viewport._render();
  assert.equal(playing.viewport.renders, 1, "playback never waits");

  const empty = makeHost([], { frame: 10, speed: 0 });
  installFor(empty);
  empty.viewport._render();
  assert.equal(empty.viewport.renders, 1, "no video means no gate");
});

test("an rVFC confirmation settles before the timeout", async () => {
  api.timeoutMs = 50;
  const element = new FakeElement();
  const schedule = makeSchedule(element);
  const host = makeHost([schedule], { frame: 10, speed: 0 });
  installFor(host);

  element.requestSeek(10 / 30);
  host.viewport._render();
  assert.equal(host.viewport.renders, 0);
  // currentTime is still the old frame until the decode completes.
  element.pendingTime = 10 / 30;
  element.currentTime = 10 / 30;
  element.seeking = false;
  element.dispatchEvent(new Event("seeked"));
  assert.equal(host.viewport.renders, 0, "the frame callback gates the redraw");
  element.fireFrameCallback({ mediaTime: 10 / 30 });
  assert.equal(host.viewport.renders, 1);
  api.timeoutMs = 1500;
});

test("one element feeding three schedules redraws once when its seek settles", () => {
  api.timeoutMs = 50;
  const element = new FakeElement();
  element.requestVideoFrameCallback = undefined;
  const schedules = [makeSchedule(element), makeSchedule(element), makeSchedule(element)];
  const host = makeHost(schedules, { frame: 10, speed: 0 });
  installFor(host);

  element.requestSeek(10 / 30);
  host.viewport._render();
  assert.equal(host.viewport.renders, 0);
  element.completeSeek();
  assert.equal(host.viewport.renders, 1, "the three waiters coalesce into one redraw");
  for (const schedule of schedules) assert.equal(schedule.texture.needsUpdate, true);
  api.timeoutMs = 1500;
});

test("a project switch drops the late redraw", async () => {
  api.timeoutMs = 20;
  const element = new FakeElement();
  const schedule = makeSchedule(element);
  const host = makeHost([schedule], { frame: 10, speed: 0 });
  installFor(host);

  element.requestSeek(10 / 30);
  host.viewport._render();
  host.viewport.editor.project = { sequence: { videoSchedules: [] } };
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(host.viewport.renders, 0, "the timeout does not draw into the new project");
  assert.equal(schedule.texture.needsUpdate, false);
  api.timeoutMs = 1500;
});

test("a removed layer's waiter leaves its texture alone but still redraws the frame", async () => {
  api.timeoutMs = 20;
  const element = new FakeElement();
  const schedule = makeSchedule(element);
  const host = makeHost([schedule], { frame: 10, speed: 0 });
  installFor(host);

  element.requestSeek(10 / 30);
  host.viewport._render();
  host.viewport.editor.project.sequence.videoSchedules = [];
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(schedule.texture.needsUpdate, false);
  assert.equal(host.viewport.renders, 1, "the remaining layers present the frame");
  api.timeoutMs = 1500;
});
