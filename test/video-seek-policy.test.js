"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { readTiming, target, ensure, isReady, canCapture } = require("../plugins/core/video-seek-policy");

function element(id, body) {
  assert.ok(body.length < 127);
  return [...Buffer.from(id, "hex"), 128 + body.length, ...body];
}
function uint(value) {
  const bytes = [];
  do { bytes.unshift(value % 256); value = Math.floor(value / 256); } while (value);
  return bytes;
}
function webm(period = 1 / 60, quantum = 0.001) {
  return new Uint8Array([
    ...element("1a45dfa3", element("4282", [...Buffer.from("webm")])),
    ...element("18538067", [
      ...element("1549a966", element("2ad7b1", uint(Math.round(quantum * 1e9)))),
      ...element("1654ae6b", element("ae", [
        ...element("83", [1]), ...element("23e383", uint(Math.floor(period * 1e9))),
      ])),
    ]),
  ]);
}
const index = (pts, time) => pts.findLastIndex(value => value <= time);

test("WebM source duration and timestamp quantum come from the video track", () => {
  const timing = readTiming(webm());
  assert.equal(timing.period, 1 / 60);
  assert.equal(timing.quantum, 0.001);
  assert.equal(readTiming(Buffer.from("....ftypisom")), null);
  for (let size = 0; size < 10; size++) assert.doesNotThrow(() => readTiming(webm().slice(0, size)));
});

test("rounded WebM PTS select all nominal frames, including reverse order", () => {
  for (const fps of [24, 30, 60, 120, 60000 / 1001]) {
    const timing = readTiming(webm(1 / fps));
    const pts = Array.from({ length: 600 }, (_, i) => Math.round(i / fps * 1000) / 1000);
    for (const i of Array.from({ length: 600 }, (_, i) => 599 - i)) {
      const requested = i / fps;
      const corrected = target(requested, 600 / fps, timing);
      assert.equal(index(pts, corrected), i, `source ${i} at ${fps} fps`);
      assert.ok(corrected - requested <= 0.000500000000001);
    }
  }
});

test("16, 32, 64 and 128 shutter samples preserve every fractional seek", () => {
  const { shutterTimes } = require("../plugins/native-fx/smart-motion-blur/math");
  let fractional = 0, corrected = 0;
  for (const fps of [24, 60, 120]) {
    const timing = readTiming(webm(1 / fps));
    for (const samples of [16, 32, 64, 128]) for (let output = 2; output < 12; output++) {
      for (const offset of shutterTimes(1, samples)) {
        const time = (output + offset) / fps;
        assert.equal(target(time, 10, timing), time);
        fractional++;
      }
      const time = output / fps;
      assert.ok(target(time, 10, timing) > time);
      corrected++;
      // A blanket 0.5 ms bias would incorrectly advance this sample.
      assert.equal(target(time - 0.0002, 10, timing), time - 0.0002);
    }
  }
  assert.equal(fractional, 7200);
  assert.equal(corrected, 120);
});

test("exact timebases keep their frame and fractional sample indices", () => {
  const fps = 60, pts = Array.from({ length: 600 }, (_, i) => i / fps);
  for (let i = 1; i < 599; i++) for (const fraction of [0, 1 / 32, 0.5, 31 / 32]) {
    const time = (i + fraction) / fps;
    assert.equal(target(time, 10, null), time, "MP4 has no WebM correction");
    assert.equal(index(pts, target(time, 10, null)), i);
    assert.equal(index(pts, target(time, 10, readTiming(webm()))), i);
  }
});

test("clamping and source-duration cap apply after correction", () => {
  const timing = readTiming(webm());
  for (const time of [-100, -1, 0]) assert.equal(target(time, 10, timing), 0);
  for (const time of [10, 100]) assert.equal(target(time, 10, timing), 10 - 1e-7);
  assert.equal(target(9.9999, 10, timing), 9.9999);
  const fast = readTiming(webm(1 / 1000));
  const bias = target(0.1, 10, fast) - 0.1;
  assert.ok(bias > 0 && bias < fast.period / 4);
});

function video(quantum = 0) {
  const element = new EventTarget();
  let time = 0;
  Object.assign(element, { duration: 10, readyState: 4, seeking: false, src: "fixture", paused: true, seeks: [],
    pause() { this.paused = true; } });
  Object.defineProperty(element, "currentTime", { configurable: true, get: () => time,
    set(value) { element.seeks.push(value); time = quantum ? Math.floor(value / quantum) * quantum : value; queueMicrotask(() => element.dispatchEvent(new Event("seeked"))); } });
  return element;
}

test("native setters and exact export preparation use one correction without double bias", async () => {
  const PZ = { schedule: class {}, export: class {} };
  const sandbox = { PZ, setTimeout, clearTimeout, AbortController };
  vm.createContext(sandbox);
  for (const name of ["video-seek-policy", "video-frame-export"]) {
    vm.runInContext(fs.readFileSync(`plugins/core/${name}.js`, "utf8"), sandbox);
  }
  const el = video(), media = { file: new Blob([webm()]) };
  const schedule = Object.assign(new PZ.schedule(), { el, currentItem: { media }, texture: {} });
  await sandbox.ZoidiumVideoSeekPolicy.ensure(el, media);
  const pts = Array.from({ length: 600 }, (_, i) => Math.round(i / 60 * 1000) / 1000);
  for (const frame of [106, 94, 0, 599, 123]) {
    const time = frame / 60;
    el.currentTime = time;
    const native = el.currentTime;
    await schedule.decodeFrame(time);
    assert.equal(el.currentTime, native);
    assert.equal(index(pts, el.currentTime), frame);
    assert.equal(schedule.__zoidiumVideoExportState.requestedTime, time);
  }
});

test("source replacement discards cached WebM timing", async () => {
  const el = video();
  await ensure(el, { file: new Blob([webm()]) });
  el.currentTime = 106 / 60;
  assert.ok(el.currentTime > 106 / 60);
  await ensure(el, { file: new Blob([Buffer.from("....ftypisom")]) });
  el.currentTime = 106 / 60;
  assert.equal(el.currentTime, 106 / 60);
});


test("sub-millisecond periods keep unbiased seeks", () => {
  for (const fps of [1001, 1500, 10000]) {
    const timing = readTiming(webm(1 / fps));
    assert.equal(target(timing.period * 10, 10, timing), timing.period * 10);
  }
});

test("an unoverridable media clock falls back to unbiased seeks", async () => {
  let time = 0;
  const prototype = { get currentTime() { return time; }, set currentTime(value) { time = value; } };
  const el = Object.preventExtensions(Object.assign(Object.create(prototype), { duration: 10 }));
  const media = { file: new Blob([webm()]) };
  await assert.doesNotReject(ensure(el, media));
  await assert.doesNotReject(ensure(el, media));
  el.currentTime = 106 / 60;
  assert.equal(el.currentTime, 106 / 60);
});


function pendingMedia() {
  let finish;
  const header = new Promise(resolve => { finish = resolve; });
  return { media: { file: { arrayBuffer() {}, slice() { return { arrayBuffer: () => header }; } } },
    finish() { finish(webm().buffer); } };
}

test("pending timing blocks capture and re-seeks a still-current unbiased boundary once", async () => {
  const el = video(), pending = pendingMedia(), request = 106 / 60;
  const resolving = ensure(el, pending.media);
  el.currentTime = request;
  assert.equal(el.currentTime, request);
  const sequence = { videoSchedules: [{ el, currentItem: { media: pending.media, start: 0, length: 600 } }] };
  assert.equal(canCapture(sequence, 106), false);
  pending.finish(); await resolving;
  assert.equal(el.currentTime, request + 0.0005);
  assert.equal(el.seeks.length, 2, "exactly one corrective seek");
  assert.equal(canCapture(sequence, 106), true);
  const corrected = el.currentTime;
  await ensure(el, pending.media);
  assert.equal(el.currentTime, corrected, "resolution cannot apply the correction twice");
  assert.equal(el.seeks.length, 2);
  el.seeking = true;
  assert.equal(canCapture(sequence, 106), false, "a corrective seek must finish before capture");
});

test("timing resolution corrects only the latest request and leaves fractional samples unchanged", async () => {
  const el = video(), pending = pendingMedia();
  const resolving = ensure(el, pending.media);
  el.currentTime = 106 / 60;
  el.currentTime = 0.125;
  pending.finish(); await resolving;
  assert.equal(el.currentTime, 0.125);
  assert.equal(isReady(el, pending.media), true);
});

test("timing resolution never rewinds a playing media clock", async () => {
  const el = video(), pending = pendingMedia();
  const resolving = ensure(el, pending.media);
  el.currentTime = 106 / 60; el.paused = false;
  pending.finish(); await resolving;
  assert.equal(el.currentTime, 106 / 60);
  el.paused = true;
  assert.equal(isReady(el, pending.media), false, "unadjusted data stays out of the cache");
  el.currentTime = 106 / 60;
  assert.equal(isReady(el, pending.media), true);
});


test("the native schedule's first unbiased seek retains its unrounded request for correction", async () => {
  const pending = pendingMedia(), el = video(1e-6), request = 106 / 60;
  const PZ = { schedule: class {
    static type = { VIDEO: 0 };
    update() { this.currentItem = { media: pending.media }; this.el.currentTime = request; }
  } };
  const sandbox = { PZ };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync("plugins/core/video-seek-policy.js", "utf8"), sandbox);
  const schedule = Object.assign(new PZ.schedule(), { type: 0, el });
  schedule.update();
  assert.equal(el.seeks.length, 1);
  assert.ok(el.currentTime < 1.767, "the initial unbiased seek presents the preceding frame");
  pending.finish(); await sandbox.ZoidiumVideoSeekPolicy.ensure(el, pending.media);
  assert.equal(el.seeks.length, 2);
  assert.equal(el.seeks[1], request + 0.0005, "correct the logical request, not its rounded clock value");
  assert.ok(el.currentTime >= 1.767);
});


test("a late timing result cannot correct a replacement media source", async () => {
  const el = video(), pending = pendingMedia();
  const old = ensure(el, pending.media);
  el.currentTime = 106 / 60;
  const next = { file: new Blob([Buffer.from("....ftypisom")]) };
  el.src = "replacement";
  await ensure(el, next);
  el.currentTime = 0.125;
  pending.finish(); await old;
  assert.equal(el.currentTime, 0.125);
  assert.equal(el.seeks.length, 2);
  assert.equal(isReady(el, pending.media), false);
  assert.equal(isReady(el, next), true);
});
