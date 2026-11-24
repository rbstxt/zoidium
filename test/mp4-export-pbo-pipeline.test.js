"use strict";

// Verifies the double-buffered WebGL2 PBO readback pipeline in yuv-convert,
// video-source, and render.js: FIFO ordering, bit-identical output vs sync
// convert(), sample disposal, PBO/fence cleanup, error handling, and flush
// before MP4 output finalization.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createConverter } = require("../plugins/mp4-export/yuv-convert.js");
const { createVideoSource } = require("../plugins/mp4-export/video-source.js");
const { createJob } = require("../plugins/mp4-export/render.js");
const { planeLayout } = require("../plugins/mp4-export/yuv-math.js");

const GL_CONSTANTS = {
  VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
  TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, NEAREST: 0x2600, CLAMP_TO_EDGE: 0x812f,
  UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243, NONE: 0,
  RGBA8: 0x8058, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  FRAMEBUFFER: 0x8d40, COLOR_ATTACHMENT0: 0x8ce0, FRAMEBUFFER_COMPLETE: 0x8cd5, TRIANGLES: 4,
  PIXEL_PACK_BUFFER: 0x88eb, STREAM_READ: 0x88e1,
  SYNC_GPU_COMMANDS_COMPLETE: 0x9117,
  ALREADY_SIGNALED: 0x911a, TIMEOUT_EXPIRED: 0x911b,
  CONDITION_SATISFIED: 0x911c, WAIT_FAILED: 0x911d,
};

function frameBytes(frameId, byteLength) {
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i++) bytes[i] = (frameId * 37 + i * 13) & 0xff;
  return bytes;
}

function createFakePboGl(state) {
  const noop = () => {};
  let boundPackBuffer = null;
  let currentSource = null;
  let nextBufferId = 1;
  let nextSyncId = 1;

  const gl = {
    ...GL_CONSTANTS,
    activeTexture: noop,
    attachShader: noop,
    bindFramebuffer: noop,
    bindTexture: noop,
    checkFramebufferStatus: () => GL_CONSTANTS.FRAMEBUFFER_COMPLETE,
    compileShader: noop,
    createFramebuffer: () => ({}),
    createProgram: () => ({}),
    createShader: () => ({}),
    createTexture: () => ({}),
    deleteFramebuffer: noop,
    deleteProgram: noop,
    deleteShader: noop,
    deleteTexture: noop,
    drawArrays: noop,
    framebufferTexture2D: noop,
    getError: () => 0,
    getExtension: () => ({ loseContext: noop }),
    getProgramInfoLog: () => "",
    getProgramParameter: () => true,
    getShaderInfoLog: () => "",
    getShaderParameter: () => true,
    getUniformLocation: () => ({}),
    isContextLost: () => Boolean(state.lost),
    linkProgram: noop,
    pixelStorei: noop,
    shaderSource: noop,
    texImage2D(...args) {
      if (args.length === 6) currentSource = args[5];
    },
    texParameteri: noop,
    uniform1i: noop,
    uniform2i: noop,
    useProgram: noop,
    viewport: noop,
    createBuffer() {
      const buffer = { id: nextBufferId++, data: null, deleted: false };
      state.buffers.push(buffer);
      return buffer;
    },
    bindBuffer(target, buffer) {
      if (target === GL_CONSTANTS.PIXEL_PACK_BUFFER) boundPackBuffer = buffer;
    },
    bufferData(target, size, usage) {
      assert.equal(target, GL_CONSTANTS.PIXEL_PACK_BUFFER);
      assert.equal(usage, GL_CONSTANTS.STREAM_READ);
      assert.ok(boundPackBuffer);
      boundPackBuffer.data = new Uint8Array(size);
    },
    deleteBuffer(buffer) {
      buffer.deleted = true;
      state.deletedBuffers.push(buffer);
    },
    readPixels(x, y, width, height, format, type, dstOrOffset) {
      const byteLength = width * height * 4;
      const produced = frameBytes(currentSource.frameId, byteLength);
      if (typeof dstOrOffset === "number") {
        assert.equal(dstOrOffset, 0);
        assert.ok(boundPackBuffer, "PBO readPixels must bind PIXEL_PACK_BUFFER");
        boundPackBuffer.data.set(produced);
        state.pboReads++;
      } else {
        assert.equal(boundPackBuffer, null, "sync readPixels must not have a PBO bound");
        dstOrOffset.set(produced);
        state.syncReads++;
      }
    },
    getBufferSubData(target, srcByteOffset, dstData) {
      assert.equal(target, GL_CONSTANTS.PIXEL_PACK_BUFFER);
      assert.equal(srcByteOffset, 0);
      assert.ok(boundPackBuffer, "getBufferSubData must bind PIXEL_PACK_BUFFER");
      dstData.set(boundPackBuffer.data);
      state.subDataReads++;
    },
    fenceSync(condition, flags) {
      assert.equal(condition, GL_CONSTANTS.SYNC_GPU_COMMANDS_COMPLETE);
      assert.equal(flags, 0);
      const sync = {
        id: nextSyncId++,
        pollsRemaining: state.pollsBeforeReady ?? 0,
        deleted: false,
      };
      state.syncs.push(sync);
      return sync;
    },
    clientWaitSync(sync, flags, timeout) {
      assert.equal(flags, 0);
      assert.equal(timeout, 0);
      state.waitCalls++;
      if (state.onWait) return state.onWait(sync, gl);
      if (state.waitFailed) return GL_CONSTANTS.WAIT_FAILED;
      if (sync.pollsRemaining > 0) {
        sync.pollsRemaining--;
        return GL_CONSTANTS.TIMEOUT_EXPIRED;
      }
      return state.waitCalls % 2 === 0 ? GL_CONSTANTS.CONDITION_SATISFIED : GL_CONSTANTS.ALREADY_SIGNALED;
    },
    deleteSync(sync) {
      sync.deleted = true;
      state.deletedSyncs.push(sync);
    },
    flush() {
      state.flushes++;
    },
  };
  return gl;
}

function fakeScope(gl) {
  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
    getContext(name) {
      assert.equal(name, "webgl2");
      return gl;
    }
  }
  return { OffscreenCanvas: FakeOffscreenCanvas };
}

function fakeBunny(state) {
  return {
    Quality: class { constructor(options) { this.bitrate = options.bitrate; } },
    VideoSampleSource: class {
      constructor(config) { this.config = config; state.sampleSource = this; }
      async add(sample) {
        state.submitted.push({
          timestamp: sample.init.timestamp,
          duration: sample.init.duration,
          bytes: new Uint8Array(sample.data),
          sample,
        });
      }
    },
    VideoSample: class {
      constructor(data, init) {
        this.data = data;
        this.init = init;
        this.closed = 0;
      }
      close() { this.closed++; }
    },
  };
}

function newGlState(extra = {}) {
  return {
    buffers: [],
    deletedBuffers: [],
    syncs: [],
    deletedSyncs: [],
    pboReads: 0,
    syncReads: 0,
    subDataReads: 0,
    waitCalls: 0,
    flushes: 0,
    lost: false,
    ...extra,
  };
}

const OPTIONS = {
  width: 8,
  height: 4,
  codec: "avc1.640028",
  bitrate: 4000000,
  onEncodedPacket: () => {},
  beforeSubmit: () => {},
};

test("PBO pipeline delivers 3 frames + flush in FIFO order with bytes identical to sync convert()", async () => {
  const layout = planeLayout(OPTIONS.width, OPTIONS.height);
  const syncState = newGlState();
  const syncConverter = createConverter(fakeScope(createFakePboGl(syncState)), OPTIONS.width, OPTIONS.height);
  const expected = [1, 2, 3].map((frameId) =>
    new Uint8Array(syncConverter.convert({ width: 8, height: 4, frameId }).data));
  syncConverter.dispose();

  const pboState = newGlState({ pollsBeforeReady: 2 });
  const bunnyState = { submitted: [] };
  const source = createVideoSource(
    fakeScope(createFakePboGl(pboState)),
    fakeBunny(bunnyState),
    { ...OPTIONS, canvas: { width: 8, height: 4 } },
  );

  assert.equal(pboState.buffers.length, 2, "double-buffered converter allocates 2 PBO slots");

  await source.add(0, 1 / 30, { width: 8, height: 4, frameId: 1 });
  assert.equal(bunnyState.submitted.length, 0, "first frame stays in flight while PBO 0 converts");

  await source.add(1 / 30, 1 / 30, { width: 8, height: 4, frameId: 2 });
  assert.equal(bunnyState.submitted.length, 1, "second frame triggers drain of frame 1");
  assert.equal(bunnyState.submitted[0].timestamp, 0);

  await source.add(2 / 30, 1 / 30, { width: 8, height: 4, frameId: 3 });
  assert.equal(bunnyState.submitted.length, 2, "third frame triggers drain of frame 2");
  assert.equal(bunnyState.submitted[1].timestamp, 1 / 30);

  await source.flush();
  assert.equal(bunnyState.submitted.length, 3, "flush drains the final pending frame");
  assert.equal(bunnyState.submitted[2].timestamp, 2 / 30);

  for (let i = 0; i < 3; i++) {
    assert.equal(bunnyState.submitted[i].bytes.length, layout.byteLength);
    assert.deepEqual(bunnyState.submitted[i].bytes, expected[i], `frame ${i + 1} matches sync convert()`);
    assert.equal(bunnyState.submitted[i].sample.closed, 1, `frame ${i + 1} sample is closed`);
  }
  assert.equal(pboState.pboReads, 3);
  assert.equal(pboState.subDataReads, 3);
  assert.equal(pboState.flushes, 3);
  assert.equal(pboState.deletedSyncs.length, 3, "every fence sync is deleted after drain");

  source.dispose();
  assert.equal(pboState.deletedBuffers.length, 2, "both PBO buffers are deleted on dispose");
});

test("dispose cleans up live pending fence syncs and PBO buffers", () => {
  const glState = newGlState();
  const converter = createConverter(fakeScope(createFakePboGl(glState)), OPTIONS.width, OPTIONS.height);
  assert.equal(converter.supportsPbo, true);
  converter.enqueue({ width: 8, height: 4, frameId: 1 }, { timestamp: 0, duration: 0.1 });
  converter.enqueue({ width: 8, height: 4, frameId: 2 }, { timestamp: 0.1, duration: 0.1 });
  assert.equal(converter.pendingCount, 2);

  converter.dispose();
  assert.equal(converter.pendingCount, 0);
  assert.equal(glState.deletedSyncs.length, 2, "in-flight sync objects are deleted on dispose");
  assert.equal(glState.deletedBuffers.length, 2, "both PBO buffers are deleted on dispose");
});

test("WAIT_FAILED and context loss during drainOne reject cleanly and delete the fence", async () => {
  const failState = newGlState({ waitFailed: true });
  const failConverter = createConverter(fakeScope(createFakePboGl(failState)), OPTIONS.width, OPTIONS.height);
  failConverter.enqueue({ width: 8, height: 4, frameId: 1 }, { timestamp: 0, duration: 0.1 });
  await assert.rejects(failConverter.drainOne(), /fence wait failed/);
  assert.equal(failState.deletedSyncs.length, 1);
  failConverter.dispose();

  const lostState = newGlState({
    onWait(_sync, gl) {
      lostState.lost = true;
      return gl.TIMEOUT_EXPIRED;
    },
  });
  const lostConverter = createConverter(fakeScope(createFakePboGl(lostState)), OPTIONS.width, OPTIONS.height);
  lostConverter.enqueue({ width: 8, height: 4, frameId: 1 }, { timestamp: 0, duration: 0.1 });
  await assert.rejects(lostConverter.drainOne(), /context was lost/);
  assert.equal(lostState.deletedSyncs.length, 1);
  lostConverter.dispose();
});

test("render.js flushes the PBO video source before finalizing MP4 output", async () => {
  const events = [];
  const glState = newGlState();
  const gl = createFakePboGl(glState);
  const canvas = { width: 8, height: 4, frameId: 0 };
  const exporter = {
    params: { width: 8, height: 4, rate: 30, quality: 2, bitrateScale: 1, start: 0, length: 3 },
    sequence: { properties: { rate: { get: () => 30 } } },
    renderer: { domElement: canvas },
    framesRendered: 0,
    async renderVideoFrame() {
      this.framesRendered++;
      canvas.frameId = this.framesRendered;
      events.push("render " + this.framesRendered);
    },
  };
  const bunny = {
    StreamTarget: class { constructor(stream) { this.stream = stream; } },
    Output: class {
      constructor(options) { this.target = options.target; this.state = "pending"; }
      addVideoTrack() {}
      async start() { this.state = "started"; }
      async finalize() {
        events.push("finalize");
        const writer = this.target.stream.getWriter();
        await writer.write({ position: 0, data: Uint8Array.of(1) });
        await writer.close();
        this.state = "finalized";
      }
      async cancel() { this.state = "canceled"; }
    },
    Mp4OutputFormat: class {},
    Quality: class {},
    VideoSampleSource: class {
      async add(sample) {
        events.push("submit " + Math.round(sample.init.timestamp * 30));
      }
    },
    VideoSample: class {
      constructor(data, init) { this.data = data; this.init = init; this.closed = 0; }
      close() { this.closed++; }
    },
  };
  const scope = {
    ...fakeScope(gl),
    navigator: {},
    VideoEncoder: { async isConfigSupported(config) { return { supported: true, config }; } },
  };
  const profiles = Array.from({ length: 5 }, () => ({ bitrate: 1 }));
  await createJob(scope, { av: { profiles } }, exporter, () => bunny).run();

  assert.deepEqual(events, [
    "render 1",
    "render 2",
    "submit 0",
    "render 3",
    "submit 1",
    "submit 2",
    "finalize",
  ]);
  assert.equal(glState.deletedBuffers.length, 2, "converter disposed after render");
});
