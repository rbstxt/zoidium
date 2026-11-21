"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  class Track {
    constructor() { this.enabled = true; this.type = 0; this.clips = []; }
    load(data) { this.clips = data.clips; }
    toJSON() { return { type: this.type, clips: this.clips }; }
    update() { this.layer = this.enabled ? this.clips[0] : null; }
  }
  class Sequence {
    constructor() { this.videoTracks = [new Track(), new Track(), new Track()]; }
    load(data) { this.videoTracks.forEach((track, index) => track.load(data.videoTracks[index])); }
    update(frame) { this.videoTracks.forEach(track => track.update(frame)); }
    async prepare(frame) { this.update(frame); }
    toJSON() { return { videoTracks: this.videoTracks }; }
  }
  const schedule = { combineTracks: tracks => tracks.flatMap(track => track.clips) };
  const context = { PZ: { track: Track, sequence: Sequence, schedule } };
  context.window = context;
  const path = "plugins/core/timeline-track-state.js";
  if (fs.existsSync(path)) vm.runInNewContext(fs.readFileSync(path, "utf8"), context);
  const sequence = new Sequence();
  sequence.load({ videoTracks: ["A", "B", "C"].map(name => ({ clips: [name] })) });
  const draw = () => sequence.videoTracks.flatMap(track => track.layer || []);
  return { sequence, draw, context, schedule, Track, Sequence };
}

test("solo filters preview and export sequence updates without changing visibility", async () => {
  const { sequence, draw } = setup();
  sequence.update(0);
  assert.deepEqual(draw(), ["A", "B", "C"]);
  sequence.videoTracks[0].zoidiumSolo = true;
  sequence.videoTracks[2].zoidiumSolo = true;
  sequence.update(0);
  assert.deepEqual(draw(), ["A", "C"]);
  sequence.videoTracks[2].enabled = false;
  await sequence.prepare(0);
  assert.deepEqual(draw(), ["A"]);
  assert.deepEqual(sequence.videoTracks.map(track => track.enabled), [true, true, false]);
  sequence.videoTracks[0].zoidiumSolo = false;
  sequence.videoTracks[2].zoidiumSolo = false;
  sequence.update(0);
  assert.deepEqual(draw(), ["A", "B"]);
});

test("track solo round trips and the filter is local to each composition", () => {
  const { sequence, context, Sequence } = setup();
  const original = JSON.stringify(sequence);
  assert.equal(original.includes("zoidiumSolo"), false);
  sequence.videoTracks[1].zoidiumSolo = true;
  const restored = new Sequence();
  restored.load(JSON.parse(JSON.stringify(sequence)));
  restored.update(0);
  assert.deepEqual(restored.videoTracks.flatMap(track => track.layer || []), ["B"]);
  const nested = [new context.PZ.track(), new context.PZ.track()];
  assert.equal(context.ZoidiumTrackSwitches.excludedBySolo(nested[0], nested), false);
  nested[1].zoidiumSolo = true;
  assert.equal(context.ZoidiumTrackSwitches.excludedBySolo(nested[0], nested), true);
  assert.equal(context.ZoidiumTrackSwitches.excludedBySolo(restored.videoTracks[1], restored.videoTracks), false);
  restored.load(JSON.parse(original));
  restored.update(0);
  assert.deepEqual(restored.videoTracks.flatMap(track => track.layer || []), ["A", "B", "C"]);
});

test("audio solo filters audio schedules within the audio track list", () => {
  const { Track, schedule } = setup();
  const tracks = ["A", "B"].map(name => Object.assign(new Track(), { type: 1, clips: [name] }));
  assert.deepEqual(Array.from(schedule.combineTracks(tracks)), ["A", "B"]);
  tracks[1].zoidiumSolo = true;
  assert.deepEqual(Array.from(schedule.combineTracks(tracks)), ["B"]);
});
