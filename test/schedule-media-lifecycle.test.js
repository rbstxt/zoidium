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
    schedule.el = el; schedule.playing = true;
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
