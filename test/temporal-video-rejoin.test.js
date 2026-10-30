"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { host } = require("./helpers/temporal-sampler-host.cjs");

function rejoinHost() {
  const h = host(false);
  delete h.effect._zoidiumFrameSampler;
  const schedule = h.sequence.videoSchedules[0];
  Object.assign(schedule, { currentItem: schedule.items[0], texture: {},
    __zoidiumTemporalRejoin: true, __zoidiumTemporalRejoinStarted: 0,
    el: { currentTime: 99, seeking: true, readyState: 1, error: null } });
  const clock = { now: 0 };
  h.sandbox.performance = { now: () => clock.now };
  h.PZ.videoFrameExportDiagnostics = { timeoutMs: 50 };
  return { ...h, schedule, clock };
}

test("an unreadable rejoin time curve still routes through native playback", () => {
  const h = rejoinHost();
  h.schedule.__zoidiumTemporalPlayback = true;
  h.ownerClip.properties.time.get = () => { throw new Error("Synthetic time curve failure"); };
  const playback = Object.assign(new h.PZ.ui.playback(), { _exactFrame: 30 });
  assert.doesNotThrow(() => playback.updateSchedule(h.schedule, 1));
  assert.equal(playback.nativeUpdates, 1);
  assert.equal(h.schedule.el.currentTime, 99);
  assert.equal(h.schedule.__zoidiumTemporalPlayback, false);
  assert.equal(h.schedule.__zoidiumTemporalRejoin, false);
  assert.equal(h.schedule.__zoidiumTemporalRejoinStarted, undefined);
});

test("a media error releases the rejoin draw guard immediately", () => {
  const h = rejoinHost(), before = h.root.frames.length;
  h.viewport._render();
  assert.equal(h.root.frames.length, before);
  h.schedule.el.error = new Error("Synthetic media error");
  h.viewport._render();
  assert.equal(h.root.frames.length, before + 1);
  assert.equal(h.schedule.__zoidiumTemporalRejoin, false);
  assert.equal(h.schedule.__zoidiumTemporalRejoinStarted, undefined);
});

test("a permanently seeking video falls back to native drawing after the decode timeout", () => {
  const h = rejoinHost(), before = h.root.frames.length;
  for (const time of [0, 25, 49]) {
    h.clock.now = time; h.viewport._render();
    assert.equal(h.root.frames.length, before);
  }
  h.clock.now = 50; h.viewport._render();
  assert.equal(h.root.frames.length, before + 1);
  assert.equal(h.schedule.__zoidiumTemporalRejoin, false);
  h.viewport._render();
  assert.equal(h.root.frames.length, before + 2, "the timed-out guard does not restart");
});
