"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const vm = require("node:vm"), fs = require("node:fs");
const source = fs.readFileSync(require.resolve("../plugins/core/media-lifecycle.js"), "utf8");
function fixture() {
  const pending = new Set();
  class Schedule {
    unload() { this.texture?.dispose(); return "unloaded"; }
  }
  const PZ = { schedule: Schedule };
  const context = vm.createContext({ PZ });
  vm.runInContext(source, context);
  function create() {
    const schedule = new Schedule(), calls = [];
    let src = "blob:shared-asset";
    const el = {
      pause() { calls.push("pause"); },
      removeAttribute(name) { assert.equal(name, "src"); src = null; calls.push("remove"); },
      load() { if (!src) pending.delete(el); calls.push("load"); },
    };
    pending.add(el);
    schedule.type = 1; schedule.el = el; schedule.playing = true;
    schedule.texture = { dispose() { calls.push("texture"); } };
    return { schedule, calls };
  }
  return { pending, create, context, Schedule };
}

test("unloaded media schedules reset their source and release pending decoder activity", () => {
  const f = fixture();
  for (const count of [5, 10, 20]) {
    for (let i = 0; i < count; i++) {
      const { schedule, calls } = f.create();
      assert.equal(schedule.unload(), "unloaded");
      assert.deepEqual(calls, ["texture", "pause", "remove", "load"]);
      assert.equal(schedule.playing, false);
    }
    assert.equal(f.pending.size, 0);
  }
});

test("media cleanup installs once and keeps schedules without media elements valid", () => {
  const f = fixture(), unload = f.Schedule.prototype.unload;
  vm.runInContext(source, f.context);
  assert.equal(f.Schedule.prototype.unload, unload);
  const { schedule, calls } = f.create();
  schedule.unload();
  assert.deepEqual(calls, ["texture", "pause", "remove", "load"]);
  const nonMedia = new f.Schedule();
  assert.equal(nonMedia.unload(), "unloaded");
});

test("audio source allocations follow simultaneous schedules instead of edit count", () => {
  let allocations = 0;
  const node = () => ({ connect() {}, disconnect() {} });
  const audioCtx = {
    state: "running", createMediaElementSource(el) { allocations++; return { ...node(), mediaElement: el }; },
    createStereoPanner: node, createGain: node, resume() { this.state = "running"; },
  };
  class Playback {
    constructor() { this.audioCtx = audioCtx; this.audioDst = node(); }
    scheduleCreated(schedule) {
      schedule.nativeCreated = true;
      if (schedule.type !== 1) return;
      schedule.sourceNode = this.audioCtx.createMediaElementSource(schedule.el);
      schedule.gainNode = node(); schedule.panNode = node();
    }
    scheduleUnloaded(schedule) {
      for (const key of ["sourceNode", "gainNode", "panNode"]) schedule[key]?.disconnect();
    }
  }
  vm.runInNewContext(source, { PZ: { ui: { playback: Playback } } });
  const playback = new Playback();
  const make = () => ({ type: 1, el: {} });
  const first = make(); playback.scheduleCreated(first);
  const initialElement = first.el;
  playback.scheduleUnloaded(first); playback.scheduleUnloaded(first);
  for (const count of [5, 10, 20]) {
    for (let i = 0; i < count; i++) {
      const schedule = make(); playback.scheduleCreated(schedule);
      assert.equal(schedule.nativeCreated, true);
      assert.equal(schedule.el, initialElement);
      assert.equal(schedule.sourceNode.mediaElement, schedule.el);
      playback.scheduleUnloaded(schedule);
    }
    assert.equal(allocations, 1);
  }
  const a = make(), b = make(); playback.scheduleCreated(a); playback.scheduleCreated(b);
  assert.notEqual(a.el, b.el); assert.equal(allocations, 2);
  playback.scheduleUnloaded(a); playback.scheduleUnloaded(b);
  const nonAudio = { type: 0 }; playback.scheduleCreated(nonAudio);
  assert.equal(allocations, 2);
});


test("video elements retain decoder ownership when schedules unload", () => {
  const f = fixture(), { schedule, calls } = f.create();
  schedule.type = 0;
  schedule.__zoidiumExactDecodePending = true;
  assert.equal(schedule.unload(), "unloaded");
  assert.deepEqual(calls, ["texture"]);
  assert.equal(schedule.playing, true);
});

test("native creation runs on reuse and restores the context factory even on failure", () => {
  const { PZ } = require("./helpers/editor-identity-host.cjs").host();
  let allocations = 0, disconnected = 0, callbacks = 0;
  const node = () => ({ connect() {}, disconnect() { disconnected++; } });
  const context = { state: "running", suspend() {}, resume() {},
    createMediaElementSource() { allocations++; return node(); },
    createGain: node, createStereoPanner: node };
  const factory = context.createMediaElementSource;
  const native = PZ.ui.playback.prototype.scheduleCreated;
  const original = PZ.ui.playback.prototype.scheduleUnloaded;
  const playback = { audioCtx: context, audioDst: node(), _sequence: { audioSchedules: [{}] } };
  PZ.ui.playback.prototype.scheduleCreated = function (schedule) {
    assert.equal(this, playback); callbacks++;
    native.call(this, schedule);
    schedule.extraNativeState = callbacks;
    if (schedule.fail) throw Error("creation failed");
    return "native result";
  };
  vm.runInNewContext(source, { PZ });
  for (let i = 0; i < 20; i++) {
    const schedule = { type: 1, el: {} };
    assert.equal(PZ.ui.playback.prototype.scheduleCreated.call(playback, schedule), "native result");
    assert.equal(schedule.extraNativeState, i + 1);
    assert.equal(context.createMediaElementSource, factory);
    PZ.ui.playback.prototype.scheduleUnloaded.call(playback, schedule);
  }
  assert.equal(allocations, 1);
  assert.equal(disconnected, 60, "native unload disconnects source, gain, and pan on every retirement");
  assert.throws(() => PZ.ui.playback.prototype.scheduleCreated.call(playback, { type: 1, el: {}, fail: true }), /creation failed/);
  assert.equal(context.createMediaElementSource, factory);
  assert.equal(original.toString().includes("disconnect"), true);
});
