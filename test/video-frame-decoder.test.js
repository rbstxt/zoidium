"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createDecoderPool,
  sourceKeyFor,
  patchFrameDimensions,
} = require("../plugins/core/video-frame-decoder.js");

function createFakeScope(overrides = {}) {
  class FakeVideoDecoder {}
  class FakeVideoFrame {
    constructor(opts = {}) {
      this.displayWidth = opts.displayWidth ?? 16;
      this.displayHeight = opts.displayHeight ?? 16;
      this.timestamp = opts.timestamp ?? 0;
      this.tag = opts.tag ?? "";
      this.closed = false;
    }
    close() {
      this.closed = true;
    }
  }
  return {
    VideoDecoder: FakeVideoDecoder,
    VideoFrame: FakeVideoFrame,
    Blob,
    ...overrides,
  };
}

function createFakeMediabunny(tracksByBlob, opts = {}) {
  const events = {
    inputsCreated: 0,
    inputsDisposed: 0,
    samplesCalls: [],
    iteratorsReturned: 0,
    samplesClosed: 0,
    framesCreated: [],
  };

  class BlobSource {
    constructor(blob) {
      this.blob = blob;
    }
  }

  class Input {
    constructor({ source }) {
      events.inputsCreated += 1;
      this.blob = source.blob;
      this.disposed = false;
    }
    async getPrimaryVideoTrack() {
      if (opts.getTrackError) throw opts.getTrackError;
      const spec = tracksByBlob.get(this.blob);
      if (!spec || spec.missingTrack) return null;
      return {
        spec,
        codec: spec.codec || null,
        async getDecoderConfig() { return spec.decoderConfig || null; },
        async canDecode() {
          return spec.canDecode !== false;
        },
      };
    }
    dispose() {
      this.disposed = true;
      events.inputsDisposed += 1;
    }
  }

  class VideoSampleSink {
    constructor(track) {
      this.spec = track.spec;
    }
    samples(startTime) {
      events.samplesCalls.push({ startTime, id: this.spec.id });
      const frames = this.spec.frames;
      let index = frames.findIndex((f, idx) => {
        const nextTs = idx + 1 < frames.length ? frames[idx + 1].pts : f.pts + (f.duration || 1 / 30);
        return nextTs > startTime + 1e-6;
      });
      if (index === -1) index = frames.length;
      const delay = this.spec.stepDelay;

      return {
        async next() {
          if (typeof delay === "function") await delay(index, startTime);
          if (index >= frames.length) return { done: true, value: undefined };
          const spec = frames[index++];
          if (spec.throwError) throw spec.throwError;
          let closed = false;
          const sample = {
            timestamp: spec.pts,
            duration: spec.duration ?? 1 / 30,
            rotation: spec.rotation || 0,
            flip: spec.flip || false,
            toVideoFrame() {
              const frame = {
                displayWidth: spec.width ?? 16,
                displayHeight: spec.height ?? 16,
                timestamp: spec.pts,
                pixel: spec.pixel ?? [10, 20, 30, 255],
                closed: false,
                close() {
                  this.closed = true;
                },
              };
              events.framesCreated.push(frame);
              return frame;
            },
            close() {
              if (!closed) {
                closed = true;
                events.samplesClosed += 1;
              }
            },
          };
          return { done: false, value: sample };
        },
        async return() {
          events.iteratorsReturned += 1;
          return { done: true, value: undefined };
        },
      };
    }
  }

  return {
    events,
    bunny: {
      ALL_FORMATS: ["mp4", "webm"],
      BlobSource,
      Input,
      VideoSampleSink,
    },
  };
}

function makeFrames(count, step = 1 / 24, extra = {}) {
  const list = [];
  for (let i = 0; i < count; i++) {
    list.push({
      pts: Number((i * step).toFixed(6)),
      duration: step,
      width: extra.width ?? 16,
      height: extra.height ?? 16,
      pixel: [i * 10, 20, 30, 255],
      rotation: extra.rotation || 0,
      flip: extra.flip || false,
    });
  }
  return list;
}

function makeParityMocks(pixelResolver) {
  const disposed = { textures: 0, targets: 0, passes: 0 };
  class Texture {
    constructor(image) {
      this.image = image;
      this.disposed = false;
    }
    dispose() {
      this.disposed = true;
      disposed.textures += 1;
    }
  }
  const THREE = {
    Texture,
    NoBlending: 0,
    RGBAFormat: 1023,
    UnsignedByteType: 1009,
  };
  let lastRenderedTexture = null;
  const gl = {
    createCopyPass() {
      return {
        material: { blending: 1 },
        uniforms: {
          uvScale: { value: { set() {} } },
          uvOffset: { value: { set() {} } },
          opacity: { value: 1 },
        },
        render(_renderer, _target, input) {
          lastRenderedTexture = input.texture;
        },
      };
    },
    createRenderTarget(_THREE, width, height) {
      return {
        width,
        height,
        dispose() {
          disposed.targets += 1;
        },
      };
    },
    disposePass() {
      disposed.passes += 1;
    },
  };
  const renderer = {
    readCalls: 0,
    readRenderTargetPixels(_target, _x, _y, width, height, out) {
      this.readCalls += 1;
      const rgba = pixelResolver(lastRenderedTexture);
      for (let i = 0; i < width * height; i++) {
        out[i * 4] = rgba[0];
        out[i * 4 + 1] = rgba[1];
        out[i * 4 + 2] = rgba[2];
        out[i * 4 + 3] = rgba[3];
      }
    },
  };
  return { THREE, gl, renderer, disposed };
}

test("streaming forward playback reuses iterator, hits PTS intervals, and deduplicates multi-track sources", async () => {
  const blob = new Blob(["clip"]);
  const frames = makeFrames(12, 1 / 24);
  const tracks = new Map([[blob, { id: "clip-a", frames }]]);
  const { bunny, events } = createFakeMediabunny(tracks);
  let bunnyLoads = 0;

  const pool = createDecoderPool({
    scope: createFakeScope(),
    loadBunny: async () => {
      bunnyLoads += 1;
      return bunny;
    },
  });

  const mediaA = { sha256: "hash-clip-a", url: "blob:a1", file: blob };
  const mediaA2 = { sha256: "hash-clip-a", url: "blob:a2", file: blob };

  // Decode frame 0 on track 1.
  const e0 = await pool.getFrame(mediaA, 0.0, { streamId: "track-1" });
  assert.ok(e0);
  assert.equal(bunnyLoads, 1);
  assert.equal(events.samplesCalls.length, 1);
  assert.equal(e0.frame.width, 16);
  assert.equal(e0.frame.height, 16);

  // Mid-interval timestamp (24fps clip in 60fps project) hits cache with 0 decode work.
  const e0Mid = await pool.getFrame(mediaA, 0.02, { streamId: "track-1" });
  assert.equal(e0Mid, e0);

  // Stacked second track referencing the same video sha256 hits the exact same cached frame.
  const e0Track2 = await pool.getFrame(mediaA2, 0.015, { streamId: "track-2" });
  assert.equal(e0Track2, e0);
  assert.equal(pool.stats.decoded, 1);
  assert.equal(pool.stats.cacheHits, 2);

  // Sequential forward step within streamWindowSeconds continues the existing iterator.
  const e1 = await pool.getFrame(mediaA, frames[1].pts, { streamId: "track-1" });
  assert.ok(e1);
  assert.notEqual(e1, e0);
  assert.equal(events.samplesCalls.length, 1, "forward step must not restart sink.samples()");

  const e2 = await pool.getFrame(mediaA, frames[2].pts, { streamId: "track-1" });
  assert.ok(e2);
  assert.equal(events.samplesCalls.length, 1);

  // Backward seek closes old iterator and restarts sink.samples().
  pool.invalidateSource("non-existent");
  const eJump = await pool.getFrame(mediaA, frames[10].pts, { streamId: "track-1" });
  assert.ok(eJump);
  // 10 * (1/24) = 0.416s <= 1.0s window -> still continues forward without restart!
  assert.equal(events.samplesCalls.length, 1);

  // Now seek backward past cached or uncached time on a fresh stream after huge forward jump.
  const eBack = await pool.getFrame(mediaA, frames[5].pts, { streamId: "track-1" });
  assert.ok(eBack);
  assert.equal(events.samplesCalls.length, 2, "backward seek must restart sink.samples()");
  assert.equal(events.iteratorsReturned, 1);

  pool.dispose();
  assert.equal(pool.stats.activeFrames, 0);
  assert.equal(pool.stats.cachedBytes, 0);
  assert.equal(events.inputsDisposed, 1);
  assert.ok(events.framesCreated.every(f => f.closed), "dispose must close every VideoFrame");
});

test("LRU eviction enforces maxFrames and maxBytes while never closing pinned VideoFrames", async () => {
  const blob = new Blob(["evict"]);
  const frames = makeFrames(6, 0.1, { width: 10, height: 10 }); // 10*10*4 = 400 bytes each
  const tracks = new Map([[blob, { id: "evict", frames }]]);
  const { bunny } = createFakeMediabunny(tracks);

  const pool = createDecoderPool({
    scope: createFakeScope(),
    loadBunny: async () => bunny,
    maxFrames: 2,
    maxBytes: 800,
  });

  const media = { sha256: "evict-key", file: blob };
  const sched1 = { id: "s1" };
  const sched2 = { id: "s2" };
  const sched3 = { id: "s3" };

  const e0 = await pool.getFrame(media, 0.0, { streamId: "s", schedule: sched1 });
  const e1 = await pool.getFrame(media, 0.1, { streamId: "s", schedule: sched2 });
  assert.equal(pool.stats.cachedBytes, 800);
  assert.equal(pool.stats.activeFrames, 2);

  // Inserting a 3rd frame forces eviction of e0 even though sched1 still pins e0.
  const e2 = await pool.getFrame(media, 0.2, { streamId: "s", schedule: sched3 });
  assert.ok(e2);
  assert.equal(pool.stats.evicted, 1);
  assert.equal(pool.stats.cachedBytes, 800);
  assert.equal(e0.frame.closed, false, "pinned evicted frame must NOT be closed while bound");
  assert.equal(pool.stats.activeFrames, 3, "evicted pinned frame remains live until unpinned");

  // Unpinning sched1 immediately closes the evicted frame.
  pool.unpinSchedule(sched1);
  assert.equal(e0.frame.closed, true, "evicted frame must close immediately on unpin");
  assert.equal(pool.stats.activeFrames, 2);

  // Unpinned entries are preferred eviction victims over pinned entries.
  pool.unpinSchedule(sched3); // e2 is now unpinned, e1 is still pinned.
  const e3 = await pool.getFrame(media, 0.3, { streamId: "s" });
  assert.ok(e3);
  assert.equal(e2.frame.closed, true, "unpinned victim should be evicted and closed first");
  assert.equal(e1.frame.closed, false, "pinned frame stays intact");

  pool.dispose();
  assert.equal(e1.frame.closed, true);
  assert.equal(e3.frame.closed, true);
  assert.equal(pool.stats.activeFrames, 0);
});

test("forward lookahead preroll populates cache and tracks prefetchHits, aborting on seek", async () => {
  const blob = new Blob(["prefetch"]);
  const frames = makeFrames(12, 0.04);
  const tracks = new Map([[blob, { id: "prefetch", frames }]]);
  const { bunny } = createFakeMediabunny(tracks);

  const pool = createDecoderPool({
    scope: createFakeScope(),
    loadBunny: async () => bunny,
    maxFrames: 16,
  });

  const media = { sha256: "prefetch-key", file: blob };
  const e0 = await pool.getFrame(media, 0.0, { streamId: "play" });
  assert.ok(e0);

  const count = await pool.prefetchAhead(media, "play", 0.0, 4, 0.04);
  assert.equal(count, 4);
  assert.equal(pool.stats.decoded, 5);

  // Consuming prefetched frames via synchronous peek records cacheHits and prefetchHits.
  const p1 = pool.peek(media, 0.04);
  const p2 = pool.peek(media, 0.08);
  assert.ok(p1);
  assert.ok(p2);
  assert.equal(pool.stats.cacheHits, 2);
  assert.equal(pool.stats.prefetchHits, 2);

  // Re-reading p1 again increments cacheHits but not prefetchHits twice.
  assert.equal(pool.peek(media, 0.04), p1);
  assert.equal(pool.stats.cacheHits, 3);
  assert.equal(pool.stats.prefetchHits, 2);

  pool.dispose();
});

test("scrub coalescing cancels superseded in-flight requests without overwriting newer frames", async () => {
  const blob = new Blob(["coalesce"]);
  let releaseFirstStep;
  const firstStepGate = new Promise(resolve => { releaseFirstStep = resolve; });
  let stepCalls = 0;
  const frames = makeFrames(20, 0.1);
  const tracks = new Map([[blob, {
    id: "coalesce",
    frames,
    async stepDelay() {
      stepCalls += 1;
      if (stepCalls === 1) await firstStepGate;
    },
  }]]);
  const { bunny } = createFakeMediabunny(tracks);

  const pool = createDecoderPool({
    scope: createFakeScope(),
    loadBunny: async () => bunny,
  });

  const media = { sha256: "coalesce-key", file: blob };
  const schedule = { id: "scrub" };

  // Start request 1 (blocks on firstStepGate), then immediately scrub to request 2 and 3.
  const r1 = pool.getFrame(media, 0.0, { streamId: "scrub", schedule });
  const r2 = pool.getFrame(media, 0.5, { streamId: "scrub", schedule });
  const r3 = pool.getFrame(media, 1.5, { streamId: "scrub", schedule });

  releaseFirstStep();
  const [v1, v2, v3] = await Promise.all([r1, r2, r3]);

  assert.equal(v1, null, "first superseded request must bail out cleanly");
  assert.equal(v2, null, "middle superseded request must bail out without decoding");
  assert.ok(v3, "latest request must resolve with the target frame");
  assert.equal(v3.pts, 1.5);
  assert.equal(pool.stats.fallbacks, 0, "superseded scrub requests are not codec fallbacks");

  pool.dispose();
});

test("unsupported codec, rotation/flip metadata, and missing WebCodecs trigger safe fallback", async () => {
  // Missing WebCodecs globals.
  const noWebCodecsPool = createDecoderPool({
    scope: {},
    loadBunny: async () => { throw new Error("should not load"); },
  });
  assert.equal(noWebCodecsPool.isSupported(), false);
  assert.equal(await noWebCodecsPool.getFrame({ sha256: "x", file: new Blob(["x"]) }, 0), null);

  // Undecodable track (`canDecode() === false`).
  const badBlob = new Blob(["bad"]);
  const rotBlob = new Blob(["rot"]);
  const tracks = new Map([
    [badBlob, { id: "bad", canDecode: false, frames: makeFrames(2, 0.1) }],
    [rotBlob, { id: "rot", frames: makeFrames(2, 0.1, { rotation: 90 }) }],
  ]);
  const { bunny } = createFakeMediabunny(tracks);

  const pool = createDecoderPool({
    scope: createFakeScope(),
    loadBunny: async () => bunny,
  });

  const badMedia = { sha256: "bad-codec", file: badBlob };
  assert.equal(await pool.getFrame(badMedia, 0), null);
  assert.equal(pool.isUnsupported(badMedia), true);
  assert.equal(pool.stats.fallbacks, 1);

  // Rotated sample marks source unsupported and closes sample.
  const rotMedia = { sha256: "rotated-clip", file: rotBlob };
  assert.equal(await pool.getFrame(rotMedia, 0), null);
  assert.equal(pool.isUnsupported(rotMedia), true);
  assert.equal(pool.stats.fallbacks, 2);

  // Subsequent calls bail out immediately with fallback count incremented.
  assert.equal(await pool.getFrame(rotMedia, 0.1), null);
  assert.equal(pool.stats.fallbacks, 3);

  // Invalidating the source clears the unsupported verdict (e.g. replaced asset).
  pool.invalidateSource("rotated-clip");
  assert.equal(pool.isUnsupported(rotMedia), false);

  pool.dispose();
});

test("verifyParity caches per-(sourceKey, renderer) verdict and disposes temporary GPU resources", () => {
  const { THREE, gl, renderer, disposed } = makeParityMocks((tex) => {
    if (tex.image?.pixel) return tex.image.pixel;
    return [10, 20, 30, 255];
  });

  const pool = createDecoderPool({
    scope: createFakeScope(),
    gl,
  });

  const nativeTex = new THREE.Texture({ pixel: [10, 20, 30, 255] });
  const matchFrame = { displayWidth: 4, displayHeight: 4, pixel: [10, 20, 30, 255] };
  const mismatchFrame = { displayWidth: 4, displayHeight: 4, pixel: [255, 0, 0, 255] };

  assert.equal(pool.verifyParity("src-match", renderer, nativeTex, matchFrame, nativeTex, THREE), true);
  assert.equal(renderer.readCalls, 2);
  assert.equal(disposed.textures, 1, "temporary decoded texture must be disposed immediately");

  // Second check hits cached verdict without reading GPU pixels again.
  assert.equal(pool.verifyParity("src-match", renderer, nativeTex, mismatchFrame, nativeTex, THREE), true);
  assert.equal(renderer.readCalls, 2);

  // Different source key checks parity independently and rejects mismatch.
  assert.equal(pool.verifyParity("src-mismatch", renderer, nativeTex, mismatchFrame, nativeTex, THREE), false);
  assert.equal(renderer.readCalls, 4);

  // Dispose cleans up shared render target and copy pass.
  pool.dispose();
  assert.equal(disposed.targets, 1);
  assert.equal(disposed.passes, 1);
});

test("decoder exceptions report one diagnostic with source, codec, support, and pool stats", async () => {
  const blob = new Blob(["diagnostic"]);
  const frames = makeFrames(3, 0.1);
  frames[0].throwError = new Error("video decode failed");
  const tracks = new Map([[blob, {
    id: "diagnostic", codec: "hvc1.1.6.L93.B0",
    decoderConfig: { codec: "hvc1.1.6.L93.B0", codedWidth: 16, codedHeight: 16 },
    frames,
  }]]);
  const { bunny } = createFakeMediabunny(tracks);
  const events = [];

  class ProbingVideoDecoder {
    static async isConfigSupported(config) {
      return { supported: true, config: { ...config, hardwareAcceleration: "prefer-hardware" } };
    }
  }
  const pool = createDecoderPool({
    scope: createFakeScope({ VideoDecoder: ProbingVideoDecoder }),
    loadBunny: async () => bunny,
    onDiagnostic: (detail) => events.push(detail),
  });

  const media = { sha256: "diagnostic-source", file: blob };
  assert.equal(await pool.getFrame(media, 0.0, { streamId: "diag" }), null);
  assert.equal(events.length, 1);
  assert.equal(events[0].reason, "decoder-error");
  assert.equal(events[0].sourceKey, "diagnostic-source");
  assert.equal(events[0].codec, "hvc1.1.6.L93.B0");
  assert.deepEqual(events[0].decoderSupport, {
    supported: true, hardwareAcceleration: "prefer-hardware",
  });
  assert.equal(events[0].errorName, "Error");
  assert.match(events[0].errorMessage, /video decode failed/);
  assert.equal(events[0].stats.fallbacks, 1);
  assert.equal(events[0].stats.decoded, 0);

  // A source marked unsupported after the failure does not emit another event.
  assert.equal(await pool.getFrame(media, 0.1, { streamId: "diag" }), null);
  assert.equal(events.length, 1);
  assert.equal(pool.isUnsupported(media), true);
  assert.equal(pool.sourceInfo(media).decoderSupport, null, "closed sources drop decoder support");

  pool.dispose();
});

test("sourceKeyFor and patchFrameDimensions handle edge inputs cleanly", () => {
  assert.equal(sourceKeyFor({ sha256: "abc", url: "blob:1" }), "abc");
  assert.equal(sourceKeyFor({ url: "blob:1", key: "k1" }), "blob:1");
  assert.equal(sourceKeyFor({ assetKey: "ak" }), "ak");
  assert.equal(sourceKeyFor(null), null);

  const frame = { displayWidth: 1920, displayHeight: 1080 };
  patchFrameDimensions(frame);
  assert.equal(frame.width, 1920);
  assert.equal(frame.height, 1080);
});
