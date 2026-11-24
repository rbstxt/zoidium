"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const decoderModule = require("../plugins/core/video-frame-decoder.js");
const streamModule = require("../plugins/core/video-playback-stream.js");

function createMockMediabunny(framesByBlob) {
  const state = { loadCalls: 0, sampleStarts: [] };
  class BlobSource {
    constructor(blob) { this.blob = blob; }
  }
  class Input {
    constructor({ source }) { this.blob = source.blob; }
    async getPrimaryVideoTrack() {
      const spec = framesByBlob.get(this.blob);
      if (!spec) return null;
      return {
        spec,
        async canDecode() { return spec.canDecode !== false; },
      };
    }
    dispose() {}
  }
  class VideoSampleSink {
    constructor(track) { this.spec = track.spec; }
    samples(startTime) {
      state.sampleStarts.push(startTime);
      const frames = this.spec.frames;
      let idx = frames.findIndex((f, i) => {
        const end = i + 1 < frames.length ? frames[i + 1].pts : f.pts + (f.duration ?? 1 / 30);
        return end > startTime + 1e-6;
      });
      if (idx === -1) idx = frames.length;
      return {
        async next() {
          if (idx >= frames.length) return { done: true, value: undefined };
          const spec = frames[idx++];
          return {
            done: false,
            value: {
              timestamp: spec.pts,
              duration: spec.duration ?? 1 / 30,
              rotation: spec.rotation || 0,
              flip: spec.flip || false,
              toVideoFrame() {
                return {
                  displayWidth: spec.width ?? 8,
                  displayHeight: spec.height ?? 8,
                  pts: spec.pts,
                  pixel: spec.pixel ?? [42, 42, 42, 255],
                  closed: false,
                  close() { this.closed = true; },
                };
              },
              close() {},
            },
          };
        },
        async return() { return { done: true, value: undefined }; },
      };
    }
  }
  return {
    state,
    bunny: { ALL_FORMATS: ["mp4"], BlobSource, Input, VideoSampleSink },
  };
}

function makeFrames(count, step = 1 / 30, extra = {}) {
  return Array.from({ length: count }, (_, i) => ({
    pts: Number((i * step).toFixed(6)),
    duration: step,
    pixel: extra.pixel || [42, 42, 42, 255],
    rotation: extra.rotation || 0,
  }));
}

function createHostHarness(options = {}) {
  const docListeners = new Map();
  const winListeners = new Map();
  const projectWatchers = new Set();
  const disposeCallbacks = [];
  const dirtySchedules = [];
  const nativeUpdateCalls = [];
  const nativeUnloadCalls = [];
  const nativeResetCalls = [];

  class Schedule {
    unload() { nativeUnloadCalls.push(this); }
    reset() { nativeResetCalls.push(this); }
  }
  Schedule.type = { VIDEO: 0, AUDIO: 1 };

  class Playback {
    constructor() {
      this.speed = 1;
      this.currentFrame = 0;
      this._exactFrame = 0;
      this._sequence = { properties: { rate: { get: () => 30 } } };
    }
    updateSchedule(schedule) {
      nativeUpdateCalls.push(schedule);
      if (schedule.el) {
        schedule.el.paused = false;
        schedule.playing = true;
      }
    }
  }

  class Texture {
    constructor(image) {
      this.image = image;
      this.needsUpdate = false;
      this.disposed = false;
    }
    dispose() { this.disposed = true; }
  }

  let renderedTex = null;
  const host = {
    VideoDecoder: options.noWebCodecs ? undefined : class FakeVideoDecoder {},
    VideoFrame: options.noWebCodecs ? undefined : class FakeVideoFrame {},
    Blob,
    THREE: {
      Texture,
      NoBlending: 0,
      RGBAFormat: 1023,
      UnsignedByteType: 1009,
    },
    ZoidiumVideoFrameDecoder: decoderModule,
    ZoidiumFramePacing: {
      markVideoDirty(schedule) { dirtySchedules.push(schedule); },
    },
    ZoidiumVideoSeekPolicy: {
      ensure: async () => {},
      seekTime: (_video, t) => t,
    },
    ZoidiumPluginApis: {
      gl: {
        createCopyPass() {
          return {
            material: { blending: 1 },
            uniforms: {
              uvScale: { value: { set() {} } },
              uvOffset: { value: { set() {} } },
              opacity: { value: 1 },
            },
            render(_renderer, _target, input) { renderedTex = input.texture; },
          };
        },
        createRenderTarget(_THREE, width, height) {
          return { width, height, dispose() {} };
        },
        disposePass() {},
      },
    },
    PZ: {
      schedule: Schedule,
      ui: { playback: Playback },
    },
    addEventListener(name, fn) { winListeners.set(name, fn); },
    removeEventListener(name, fn) { if (winListeners.get(name) === fn) winListeners.delete(name); },
  };

  const doc = {
    addEventListener(name, fn) { docListeners.set(name, fn); },
    removeEventListener(name, fn) { if (docListeners.get(name) === fn) docListeners.delete(name); },
  };

  const editor = {
    onProjectChanged: {
      watch(fn) { projectWatchers.add(fn); },
      unwatch(fn) { projectWatchers.delete(fn); },
      emit() { for (const fn of projectWatchers) fn(); },
    },
  };

  const renderer = {
    readRenderTargetPixels(_target, _x, _y, width, height, out) {
      const px = renderedTex?.image?.pixel || [42, 42, 42, 255];
      for (let i = 0; i < width * height; i++) {
        out[i * 4] = px[0];
        out[i * 4 + 1] = px[1];
        out[i * 4 + 2] = px[2];
        out[i * 4 + 3] = px[3];
      }
    },
  };

  function makeSchedule(media, { start = 0, length = 60, rate = 30, pixel = [42, 42, 42, 255] } = {}) {
    const schedule = new Schedule();
    schedule.type = 0;
    schedule.playing = false;
    schedule.el = {
      paused: true,
      duration: length / rate,
      pixel,
      pauseCalls: 0,
      pause() { this.paused = true; this.pauseCalls += 1; },
    };
    schedule.texture = new Texture(schedule.el);
    schedule.currentItem = {
      start,
      length,
      media,
      clip: {
        properties: {
          time: { get: (localFrame) => localFrame / rate },
        },
      },
    };
    return schedule;
  }

  const context = {
    window: host,
    document: doc,
    PZ: host.PZ,
    editor,
    loadBunny: options.loadBunny,
    getAsset: options.getAsset,
    lifecycle: {
      onDispose(fn) { disposeCallbacks.push(fn); },
      disposeAll() { while (disposeCallbacks.length) disposeCallbacks.pop()(); },
    },
  };

  return {
    host,
    doc,
    editor,
    renderer,
    context,
    Playback,
    Schedule,
    makeSchedule,
    docListeners,
    winListeners,
    projectWatchers,
    dirtySchedules,
    nativeUpdateCalls,
    nativeUnloadCalls,
    nativeResetCalls,
  };
}

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 15));
}

test("activate installs hooks, syncSchedule decodes & hits cache synchronously, and deactivate restores cleanly", async () => {
  const blob = new Blob(["video"]);
  const { bunny } = createMockMediabunny(new Map([[blob, { frames: makeFrames(15, 1 / 30) }]]));
  const h = createHostHarness({ loadBunny: async () => bunny });

  const stream = streamModule.activate(h.context);
  assert.equal(h.host.ZoidiumVideoStream, stream);
  assert.equal(stream.isSupported(), true);

  const media = { sha256: "vid-1", url: "blob:vid-1", file: blob };
  const schedule = h.makeSchedule(media);
  const playback = new h.Playback();

  // First tick on frame 0: cache miss starts async decode and marks pending.
  playback.currentFrame = 0;
  playback._exactFrame = 0;
  playback.updateSchedule(schedule);
  assert.equal(schedule.__zoidiumWebCodecsPending, true);

  await flushMicrotasks();
  assert.equal(stream.isScheduleActive(schedule), true);
  assert.equal(schedule.__zoidiumWebCodecsFrame, 0);
  assert.equal(schedule.__zoidiumWebCodecsPending, false);
  assert.notEqual(schedule.texture.image, schedule.el);
  assert.equal(schedule.el.paused, true);
  assert.equal(h.dirtySchedules.length, 1);

  // Lookahead prefetched upcoming frames, so advancing to frame 1 hits synchronously
  // without delegating to native updateSchedule / el.play().
  const nativeCallsBefore = h.nativeUpdateCalls.length;
  playback.currentFrame = 1;
  playback._exactFrame = 1;
  playback.updateSchedule(schedule);
  assert.equal(schedule.__zoidiumWebCodecsFrame, 1);
  assert.equal(schedule.__zoidiumWebCodecsPending, false);
  assert.equal(h.nativeUpdateCalls.length, nativeCallsBefore, "active WebCodecs schedule must not call native updateSchedule");
  assert.equal(schedule.el.paused, true);

  // Schedule unload releases the pinned frame and restores native video element on texture.
  const boundFrame = schedule.texture.image;
  schedule.unload();
  assert.equal(stream.isScheduleActive(schedule), false);
  assert.equal(schedule.texture.image, schedule.el);
  assert.equal(h.nativeUnloadCalls.length, 1);

  // Schedule reset also releases and invokes original reset.
  schedule.reset();
  assert.equal(h.nativeResetCalls.length, 1);

  // Clean deactivation restores prototypes and removes listeners.
  h.context.lifecycle.disposeAll();
  assert.equal(boundFrame.closed, true);
  assert.equal(h.host.ZoidiumVideoStream, undefined);
  assert.equal(h.projectWatchers.size, 0);
  assert.equal(h.docListeners.size, 0);
  assert.equal(h.winListeners.size, 0);
});

test("isFrameExact checks integer frame, non-empty visible schedules, active flag, exact frame, and pending state", async () => {
  const blob = new Blob(["exact"]);
  const { bunny } = createMockMediabunny(new Map([[blob, { frames: makeFrames(10, 1 / 30) }]]));
  const h = createHostHarness({ loadBunny: async () => bunny });
  const stream = streamModule.activate(h.context);

  const media = { sha256: "exact-1", file: blob };
  const s1 = h.makeSchedule(media, { start: 0, length: 30 });
  const s2 = h.makeSchedule(media, { start: 10, length: 30 });
  const sequence = { videoSchedules: [s1, s2] };

  // Non-integer frame or no active schedules -> false.
  assert.equal(stream.isFrameExact(sequence, 5.5), false);
  assert.equal(stream.isFrameExact({ videoSchedules: [] }, 5), false);
  assert.equal(stream.isFrameExact(sequence, 5), false);

  // Only s1 is visible at frame 5; once decoded at frame 5, isFrameExact returns true.
  const res1 = await stream.prepareFrame(s1, 5 / 30, { frame: 5 });
  assert.equal(res1.handled, true);
  assert.equal(stream.isFrameExact(sequence, 5), true);

  // If pending flag is set, isFrameExact returns false.
  s1.__zoidiumWebCodecsPending = true;
  assert.equal(stream.isFrameExact(sequence, 5), false);
  s1.__zoidiumWebCodecsPending = false;

  // At frame 12 both s1 and s2 are visible; must be false until both are exact at frame 12.
  await stream.prepareFrame(s1, 12 / 30, { frame: 12 });
  assert.equal(stream.isFrameExact(sequence, 12), false);
  await stream.prepareFrame(s2, 2 / 30, { frame: 12 });
  assert.equal(stream.isFrameExact(sequence, 12), true);

  h.context.lifecycle.disposeAll();
});

test("decodeExportFrame enforces parity check, caches verdict, reuses identical PTS frames, and falls back on mismatch", async () => {
  const goodBlob = new Blob(["good-export"]);
  const badBlob = new Blob(["bad-export"]);
  const { bunny } = createMockMediabunny(new Map([
    [goodBlob, { frames: makeFrames(6, 1 / 24, { pixel: [42, 42, 42, 255] }) }],
    [badBlob, { frames: makeFrames(6, 1 / 24, { pixel: [200, 10, 10, 255] }) }],
  ]));
  const h = createHostHarness({ loadBunny: async () => bunny });
  const stream = streamModule.activate(h.context);

  // No renderer and !skipParityCheck -> declines cleanly and preserves native texture.
  const goodMedia = { sha256: "exp-good", file: goodBlob };
  const sGood = h.makeSchedule(goodMedia, { pixel: [42, 42, 42, 255] });
  const noRendererRes = await stream.decodeExportFrame(sGood, 0.0, {});
  assert.deepEqual(noRendererRes, { handled: false });
  assert.equal(sGood.texture.image, sGood.el);

  // Matching pixels pass parity check and bind VideoFrame.
  const first = await stream.decodeExportFrame(sGood, 0.0, { renderer: h.renderer, frame: 0 });
  assert.equal(first.handled, true);
  assert.equal(first.reused, false);
  assert.equal(sGood.texture.needsUpdate, true);
  assert.notEqual(sGood.texture.image, sGood.el);

  // Second export frame inside the same 24fps PTS interval reuses the bound VideoFrame without setting needsUpdate.
  sGood.texture.needsUpdate = false;
  const second = await stream.decodeExportFrame(sGood, 0.016, { renderer: h.renderer, frame: 1 });
  assert.equal(second.handled, true);
  assert.equal(second.reused, true);
  assert.equal(sGood.texture.needsUpdate, false);

  // Mismatched pixels fail parity check and restore native <video> cleanly.
  const badMedia = { sha256: "exp-bad", file: badBlob };
  const sBad = h.makeSchedule(badMedia, { pixel: [42, 42, 42, 255] });
  const failed = await stream.decodeExportFrame(sBad, 0.0, { renderer: h.renderer, frame: 0 });
  assert.deepEqual(failed, { handled: false });
  assert.equal(sBad.texture.image, sBad.el);
  assert.equal(stream.isScheduleActive(sBad), false);

  // Explicit skipParityCheck bypasses renderer parity verification.
  const skipped = await stream.decodeExportFrame(sBad, 0.0, { skipParityCheck: true, frame: 0 });
  assert.equal(skipped.handled, true);

  h.context.lifecycle.disposeAll();
});

test("unsupported source falls back cleanly to native video, and asset reload / project change release frames", async () => {
  const rotBlob = new Blob(["rot"]);
  const goodBlob = new Blob(["good"]);
  const { bunny } = createMockMediabunny(new Map([
    [rotBlob, { frames: makeFrames(4, 1 / 30, { rotation: 180 }) }],
    [goodBlob, { frames: makeFrames(4, 1 / 30) }],
  ]));
  const h = createHostHarness({ loadBunny: async () => bunny });
  const stream = streamModule.activate(h.context);

  const rotMedia = { sha256: "rot-1", file: rotBlob };
  const sRot = h.makeSchedule(rotMedia);
  const playback = new h.Playback();

  playback.updateSchedule(sRot);
  await flushMicrotasks();
  assert.equal(stream.isScheduleActive(sRot), false);
  assert.equal(sRot.__zoidiumWebCodecsPending, false);
  assert.equal(sRot.texture.image, sRot.el);
  assert.ok(h.dirtySchedules.includes(sRot), "fallback must notify frame pacing dirty");

  // Asset reload event invalidates matching source and restores native video.
  const goodMedia = { sha256: "good-1", file: goodBlob };
  const sGood = h.makeSchedule(goodMedia);
  await stream.prepareFrame(sGood, 0.0, { frame: 0 });
  assert.equal(stream.isScheduleActive(sGood), true);
  const oldFrame = sGood.texture.image;

  h.docListeners.get("zoidium:asset-reloaded")({ detail: goodMedia });
  assert.equal(stream.isScheduleActive(sGood), false);
  assert.equal(sGood.texture.image, sGood.el);
  assert.equal(oldFrame.closed, true);

  // Project change clears all decoded frames while keeping the pool usable for the next project.
  await stream.prepareFrame(sGood, 0.0, { frame: 0 });
  assert.equal(stream.stats.activeFrames, 1);
  h.editor.onProjectChanged.emit();
  assert.equal(stream.stats.activeFrames, 0);
  assert.equal(stream.isSupported(), true);

  h.context.lifecycle.disposeAll();
});

test("createMediabunnyLoader loads optional bundle lazily once and degrades gracefully on failure", async () => {
  const calls = [];
  const getAsset = (type, assetPath) => {
    calls.push(["getAsset", type, assetPath]);
    return "module.exports = { marker: 'loaded-bunny' };";
  };
  getAsset.loadOptional = async (bundleId) => {
    calls.push(["loadOptional", bundleId]);
  };

  const load = streamModule.createMediabunnyLoader(getAsset);
  assert.equal(calls.length, 0, "must not load anything before first video decode");

  const first = await load();
  const second = await load();
  assert.equal(first.marker, "loaded-bunny");
  assert.equal(second, first, "must memoize compiled module");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["loadOptional", "video-decoder"]);
  assert.deepEqual(calls[1], ["getAsset", "text", "/plugins/mp4-export/vendor/mediabunny-1.62.0.cjs"]);

  // Degrades gracefully when optional bundle fails to load.
  const failingAsset = () => null;
  failingAsset.loadOptional = async () => { throw new Error("offline"); };
  const failLoad = streamModule.createMediabunnyLoader(failingAsset);
  assert.equal(await failLoad(), null);
});
