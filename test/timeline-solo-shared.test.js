"use strict";

// Pins the solo rule for shared sources: a soloed track keeps resolving a
// Camera+ camera and a Layer Input source that live on non-soloed tracks
// (both lookups use getCurrentClip, not the nulled track.layer), while
// preview preparation and export preparation consistently skip non-soloed
// tracks. See plugins/core/timeline-track-state.js (sequence.update nulls
// track.layer), plugins/camera-plus/shared-camera.js entries() (uses
// getCurrentClip), and plugins/layer-input/layer-input-render.js
// renderTrackSource (uses track.getCurrentClip).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const video = require("../plugins/core/output-frame-video.js");

globalThis.PZ = globalThis.PZ || {};
globalThis.PZ.zoidium = globalThis.PZ.zoidium || {};

// Side-effect require: installs __zoidiumTemporalParts.exportPreparation.
require("../plugins/core/temporal-export.js");
const exportPreparation = globalThis.__zoidiumTemporalParts.exportPreparation;

function loadSwitches() {
  class Track {
    constructor() {
      this.enabled = true;
      this.type = 0;
      this.clips = [];
      this.layer = null;
    }
    load(data) {
      this.clips = data.clips;
    }
    toJSON() {
      return { type: this.type, clips: this.clips };
    }
    update() {
      this.layer = this.enabled && this.clips.length ? this.clips[0].object : null;
    }
    getCurrentClip() {
      return this.clips.length ? this.clips[0] : null;
    }
  }
  class Sequence {
    constructor() {
      this.videoTracks = [new Track(), new Track()];
    }
    load(data) {
      this.videoTracks.forEach((track, index) => track.load(data.videoTracks[index]));
    }
    update() {
      this.videoTracks.forEach(track => track.update());
    }
    toJSON() {
      return { videoTracks: this.videoTracks };
    }
  }
  const schedule = { combineTracks: tracks => tracks.flatMap(track => track.clips) };
  const context = { PZ: { track: Track, sequence: Sequence, schedule } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync("plugins/core/timeline-track-state.js", "utf8"), context);
  globalThis.ZoidiumTrackSwitches = context.ZoidiumTrackSwitches;
  return { Track, Sequence, switches: context.ZoidiumTrackSwitches };
}

// Mirrors plugins/camera-plus/shared-camera.js entries(): the master lookup
// walks getCurrentClip on every enabled track and ignores solo state.
function findSharedCamera(sequence, frame) {
  for (const track of sequence.videoTracks) {
    if (track.enabled === false) continue;
    const clip = track.getCurrentClip(frame);
    if (clip?.object?.isCameraPlus) return { track, clip, camera: clip.object };
  }
  return null;
}

// Installed once for this file; the last test removes the global again so a
// repeated load in one process starts clean.
const soloHooks = loadSwitches();

test("soloed scene still resolves a shared camera on a non-soloed track", () => {
  const { Sequence, switches } = soloHooks;
  const cameraObject = { isCameraPlus: true };
  const sceneObject = { isScene: true };
  const sequence = new Sequence();
  sequence.load({ videoTracks: [{ clips: [{ start: 0, object: cameraObject }] }, { clips: [{ start: 0, object: sceneObject }] }] });
  sequence.videoTracks[1].track3d = true;
  sequence.videoTracks[1].zoidiumSolo = true;
  sequence.update(0);
  // The solo filter nulls the non-soloed row's draw layer ...
  assert.equal(sequence.videoTracks[0].layer, null);
  assert.equal(sequence.videoTracks[1].layer, sceneObject);
  assert.equal(switches.excludedBySolo(sequence.videoTracks[0], sequence.videoTracks), true);
  assert.equal(switches.excludedBySolo(sequence.videoTracks[1], sequence.videoTracks), false);
  // ... but the shared-camera lookup reads clips, so the camera survives.
  const found = findSharedCamera(sequence, 0);
  assert.ok(found, "camera on the non-soloed track still resolves");
  assert.equal(found.camera, cameraObject);
  assert.equal(found.track, sequence.videoTracks[0]);
});

test("soloed consumer still resolves a Layer Input source on a non-soloed track", () => {
  const switches = globalThis.ZoidiumTrackSwitches;
  assert.ok(switches, "track switches installed by the previous test");
  const sourceObject = { isSource: true };
  const consumerObject = { isConsumer: true };
  const tracks = [
    { enabled: true, zoidiumSolo: false, clips: [{ start: 0, object: sourceObject }], layer: sourceObject,
      getCurrentClip() { return this.clips[0]; } },
    { enabled: true, zoidiumSolo: true, clips: [{ start: 0, object: consumerObject }], layer: consumerObject,
      getCurrentClip() { return this.clips[0]; } },
  ];
  // sequence.update would null the non-soloed draw layer; model that step.
  if (switches.excludedBySolo(tracks[0], tracks)) tracks[0].layer = null;
  assert.equal(tracks[0].layer, null);
  assert.equal(tracks[1].layer, consumerObject);
  // Mirrors layer-input-render.js renderTrackSource: the source clip is read
  // through getCurrentClip, which solo never clears.
  const resolved = tracks[0].getCurrentClip(0);
  assert.ok(resolved?.object, "source clip still resolves while its row is hidden");
  assert.equal(resolved.object, sourceObject);
});

test("preview and export preparation skip the same non-soloed tracks", async () => {
  const sampler = require("../plugins/core/temporal-sampler.js");
  const tracks = [0, 1].map(() => ({
    enabled: true,
    zoidiumSolo: false,
    getCurrentClip(frame) {
      return frame >= this.clip.start && frame < this.clip.start + this.clip.length ? this.clip : null;
    },
  }));
  tracks[0].clip = { start: 0, length: 10, object: { prepared: [], async prepare(frame) { this.prepared.push(frame); } } };
  tracks[1].clip = { start: 0, length: 10, object: { prepared: [], async prepare(frame) { this.prepared.push(frame); } } };
  tracks[0].zoidiumSolo = true;
  const sequence = { videoTracks: tracks, properties: {}, update() {
    for (const track of this.videoTracks) track.layer = track.clip.object;
    for (const track of this.videoTracks) {
      if (globalThis.ZoidiumTrackSwitches?.excludedBySolo(track, this.videoTracks)) track.layer = null;
    }
  } };
  sequence.update(0);
  assert.equal(tracks[0].layer, tracks[0].clip.object);
  assert.equal(tracks[1].layer, null);

  // Preview preparation (output-frame-video.js): wanted items come from the
  // schedule; the prepare loop below applies the solo filter before touching
  // clip objects. Stub the lower schedules to cover every wanted item so the
  // test isolates that final filter.
  const snapshot = { project: { sequence }, compositor: {} };
  const policy = video.job(() => true);
  try {
    const mediaItems = tracks.map(track => ({ clip: track.clip, start: 0, length: 10, media: {} }));
    const fakeSequence = { videoTracks: tracks, properties: {},
      videoSchedules: mediaItems.map(item => ({ items: [item], padding: 60 })) };
    const wanted = video.inputs(fakeSequence, 0, sampler);
    assert.ok(wanted.length > 0, "fixture has visible items");
    const stubSampler = { ...sampler,
      getFrameSamplerRuntime: () => ({}),
      prepareLowerSchedules: async () => wanted.map(sample => ({ item: sample.item, texture: {} })) };
    const probe = { videoTracks: tracks, videoSchedules: fakeSequence.videoSchedules, properties: {}, update() {} };
    await video.prepare({ project: { sequence: probe }, compositor: {} }, 0, policy, {}, stubSampler, async () => {});
    const prepared = tracks.filter(track => track.clip.object.prepared.length > 0);
    assert.deepEqual(prepared, [tracks[0]]);
  } finally {
    policy.dispose();
  }

  // Export preparation (temporal-export.js) applies the same solo filter.
  assert.ok(exportPreparation, "temporal export preparation installed");
  for (const track of tracks) track.clip.object.prepared.length = 0;
  const exportLayers = tracks.map(track => {
    const layer = { _zoidiumFrameSampler: {}, effects: [], update() {}, prepareCalls: 0,
      async prepare() { this.prepareCalls += 1; } };
    return layer;
  });
  const exportTracks = tracks.map((track, index) => ({
    enabled: true,
    zoidiumSolo: track.zoidiumSolo,
    layer: null,
    getCurrentClip: () => ({ start: 0, object: exportLayers[index] }),
  }));
  const exportSequence = { videoTracks: exportTracks, properties: {
    motionBlur: { get: () => 1 },
    motionBlurSamples: { get: () => 2 },
    motionBlurShutter: { get: () => 1 },
    motionBlurSensitivity: { get: () => 100 },
    motionBlurTrackFrame: { get: () => 2 },
  }, update() {} };
  const exporter = { sequence: exportSequence, exportPolicy: { check() {} } };
  const state = { mapLayerFrame: (layer, local) => ({ sourceFrame: local }) };
  await exportPreparation.prepare(state, exporter, 0);
  assert.equal(exportLayers[0].prepareCalls > 0, true, "soloed track prepared for export");
  assert.equal(exportLayers[1].prepareCalls, 0, "non-soloed track skipped for export");
});

test("cleanup restores the shared switch global", () => {
  delete globalThis.ZoidiumTrackSwitches;
  assert.equal(globalThis.ZoidiumTrackSwitches, undefined);
});
