"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
function setup(clock = time => Math.max(5, time)) {
  const PZ = { schedule: class {}, export: class {} }, video = new EventTarget();
  let current = 5;
  Object.assign(video, { src: "offset-stream", readyState: 4, duration: 7, seeking: false,
    pause() {}, seeks: [] });
  Object.defineProperty(video, "currentTime", { get: () => current, set(time) {
    video.seeks.push(time); current = clock(time);
    queueMicrotask(() => video.dispatchEvent(new Event("seeked")));
  } });
  const c = { PZ, setTimeout, clearTimeout, AbortController };
  vm.runInNewContext(fs.readFileSync("plugins/core/video-frame-export.js", "utf8"), c);
  return { video, setClock(fn) { clock = fn; }, schedule: Object.assign(new PZ.schedule(), { el: video, texture: {} }) };
}
test("offset stream requests retain native clamping and decode in both directions", async () => {
  const { video, schedule } = setup();
  for (const time of [0, .5, 1.5, 5, 5.5, 6.5, 0, 6]) {
    await schedule.decodeFrame(time);
    assert.equal(video.currentTime, Math.max(5, time));
    assert.equal(schedule.__zoidiumVideoExportState.requestedTime, time);
  }
  assert.equal(schedule.__zoidiumVideoExportState.mediaStart, 5);
  assert.equal(video.seeks.filter(time => time === 0).length, 3, "one origin probe plus two requested zero seeks");
});
test("a wrong midstream seek still fails when the zero seek has a different clock", async () => {
  const { schedule } = setup(time => time + .25);
  await assert.rejects(schedule.decodeFrame(1), /different requested time/);
});
test("a replacement source cannot inherit the previous stream start", async () => {
  const { video, schedule, setClock } = setup();
  await schedule.decodeFrame(0);
  video.src = "new-source"; setClock(time => time);
  await schedule.decodeFrame(.25);
  assert.equal(video.currentTime, .25);
  assert.equal(schedule.__zoidiumVideoExportState.sourceId, "new-source");
  await schedule.decodeFrame(0);
  assert.equal(video.currentTime, 0);
});
test("a repeated seek to the last frame accepts a stream that ended at its duration", async () => {
  const { video, schedule } = setup(time => time >= 6.9 ? 7 : time);
  for (let pass = 0; pass < 3; pass++) {
    await schedule.decodeFrame(1);
    await schedule.decodeFrame(6.95);
    await schedule.decodeFrame(6.95);
    assert.equal(video.currentTime, 7);
  }
  assert.equal(video.seeks.filter(time => time === 0).length, 0, "no origin probe for a stream end");
});
test("a far seek that lands on the stream end still fails", async () => {
  const { schedule } = setup(time => time === 0 ? 0 : 7);
  await assert.rejects(schedule.decodeFrame(1), /different requested time/);
});
