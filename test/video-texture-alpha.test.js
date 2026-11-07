"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { activate } = require("../plugins/core/video-texture-alpha.js");

const THREE = { RGBFormat: 1022, RGBAFormat: 1023 };

function install() {
  const disposers = [];
  // CM3 declares PZ.schedule as a plain function with a texture only for video.
  function Native(type) {
    this.type = type;
    if (type === 0) this.texture = { format: THREE.RGBFormat };
  }
  Native.type = { VIDEO: 0, AUDIO: 1 };
  Native.prototype.update = function () { return "native update"; };
  const PZ = { schedule: Native };
  activate({ PZ, window: { THREE }, lifecycle: { onDispose: fn => disposers.push(fn) } });
  return { PZ, Native, dispose: () => disposers.forEach(fn => fn()) };
}

test("a video schedule uploads RGBA", () => {
  const { PZ } = install();
  assert.equal(new PZ.schedule(0).texture.format, THREE.RGBAFormat);
});

test("an audio schedule has no texture and stays unchanged", () => {
  const { PZ } = install();
  assert.equal(new PZ.schedule(1).texture, undefined);
});

test("instances, prototype patches and static members match the native constructor", () => {
  const { PZ, Native } = install();
  const schedule = new PZ.schedule(0);
  assert.ok(schedule instanceof Native);
  assert.ok(schedule instanceof PZ.schedule);
  assert.equal(schedule.update(), "native update");
  Native.prototype.update = () => "patched update";
  assert.equal(schedule.update(), "patched update");
  assert.equal(PZ.schedule.type.VIDEO, 0);
  Native.combineTracks = () => "patched static";
  assert.equal(PZ.schedule.combineTracks(), "patched static");
});

test("dispose restores the native constructor and keeps a foreign patch", () => {
  const first = install();
  first.dispose();
  assert.equal(first.PZ.schedule, first.Native);
  const second = install();
  function foreign() {}
  second.PZ.schedule = foreign;
  second.dispose();
  assert.equal(second.PZ.schedule, foreign);
});

test("a host without the schedule or formats is left alone", () => {
  assert.doesNotThrow(() => activate({ PZ: {}, window: { THREE }, lifecycle: { onDispose() {} } }));
  const PZ = { schedule: function () {} };
  const before = PZ.schedule;
  activate({ PZ, window: {}, lifecycle: { onDispose() {} } });
  assert.equal(PZ.schedule, before);
});
