"use strict";

// createVideoSource drives the GPU converter when WebGL2 exists and falls back
// to the canvas source otherwise. The fake GL context records the calls the
// converter makes and hands back a known framebuffer, so the sample the
// encoder receives can be inspected without a GPU.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createVideoSource } = require("../plugins/mp4-export/video-source.js");
const { planeLayout } = require("../plugins/mp4-export/yuv-math.js");

const CONSTANTS = {
  VERTEX_SHADER: 0x8b31, FRAGMENT_SHADER: 0x8b30, COMPILE_STATUS: 0x8b81, LINK_STATUS: 0x8b82,
  TEXTURE0: 0x84c0, TEXTURE_2D: 0x0de1, TEXTURE_MIN_FILTER: 0x2801, TEXTURE_MAG_FILTER: 0x2800,
  TEXTURE_WRAP_S: 0x2802, TEXTURE_WRAP_T: 0x2803, NEAREST: 0x2600, CLAMP_TO_EDGE: 0x812f,
  UNPACK_FLIP_Y_WEBGL: 0x9240, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 0x9241,
  UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243, NONE: 0,
  RGBA8: 0x8058, RGBA: 0x1908, UNSIGNED_BYTE: 0x1401,
  FRAMEBUFFER: 0x8d40, COLOR_ATTACHMENT0: 0x8ce0, FRAMEBUFFER_COMPLETE: 0x8cd5, TRIANGLES: 4,
};

function fakeGl(state) {
  const noop = () => {};
  const gl = {
    ...CONSTANTS,
    activeTexture: noop,
    attachShader: noop,
    bindFramebuffer(target) { state.calls.push(["bindFramebuffer", target]); },
    bindTexture: noop,
    checkFramebufferStatus: () => CONSTANTS.FRAMEBUFFER_COMPLETE,
    compileShader: noop,
    createFramebuffer: () => ({}),
    createProgram: () => ({}),
    createShader: () => ({}),
    createTexture: () => ({}),
    deleteFramebuffer: noop,
    deleteProgram: noop,
    deleteShader: noop,
    deleteTexture: noop,
    drawArrays(mode, first, count) { state.calls.push(["drawArrays", mode, first, count]); },
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
    readPixels(x, y, width, height, format, type, out) {
      state.calls.push(["readPixels", x, y, width, height]);
      state.reads++;
      if (state.fill) state.fill(out);
    },
    shaderSource(shader, source) { state.sources.push(source); },
    texImage2D(...args) { state.calls.push(["texImage2D", args.length]); },
    texParameteri: noop,
    uniform1i: noop,
    uniform2i: noop,
    useProgram: noop,
    viewport: noop,
  };
  return gl;
}

function fakeScope(state) {
  class FakeOffscreenCanvas {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      state.canvas = this;
    }
    getContext(name) {
      assert.equal(name, "webgl2");
      return state.gl;
    }
  }
  return { OffscreenCanvas: FakeOffscreenCanvas };
}

function fakeBunny(state) {
  return {
    Quality: class { constructor(options) { this.bitrate = options.bitrate; } },
    CanvasSource: class {
      constructor(canvas, config) { state.canvasSource = { canvas, config }; }
      async add(...args) { state.added.push(args); }
    },
    VideoSampleSource: class {
      constructor(config) { this.config = config; state.sampleSource = this; }
      async add(sample) { state.samples.push(sample); }
    },
    VideoSample: class {
      constructor(data, init) {
        Object.assign(this, { data, init });
        state.sampleInit = init;
        state.sampleData = data;
        this.closed = 0;
      }
      close() { this.closed++; }
    },
  };
}

function newState() {
  return { calls: [], sources: [], samples: [], added: [], reads: 0, lost: false };
}

const OPTIONS = {
  width: 8,
  height: 4,
  codec: "avc1.640028",
  bitrate: 4000000,
  onEncodedPacket: () => {},
  beforeSubmit: () => {},
};

test("the GPU path builds one I420 sample per frame with the packed layout", async () => {
  const state = newState();
  state.gl = fakeGl(state);
  const layout = planeLayout(OPTIONS.width, OPTIONS.height);
  state.fill = (out) => out.fill(7);
  const bunny = fakeBunny(state);
  const source = createVideoSource(fakeScope(state), bunny, { ...OPTIONS, canvas: { width: 7, height: 4 } });
  assert.equal(source.source, state.sampleSource, "VideoSampleSource carries the frames");
  assert.equal(typeof state.sampleSource.config.onEncodedPacket, "function", "the packet tagger is installed");
  assert.equal(state.sampleSource.config.latencyMode, "quality");
  assert.equal(state.sampleSource.config.keyFrameInterval, 2);
  assert.equal(state.sampleSource.config.fullCodecString, "avc1.640028");

  await source.add(0.5, 1 / 30, { width: 7, height: 4 });
  const init = state.sampleInit;
  assert.equal(init.format, "I420");
  assert.equal(init.codedWidth, 8);
  assert.equal(init.codedHeight, 4);
  assert.deepEqual(init.layout, layout.layout);
  assert.deepEqual(init.colorSpace, {
    primaries: "bt709", transfer: "iec61966-2-1", matrix: "bt709", fullRange: false,
  });
  assert.equal(init.timestamp, 0.5);
  assert.equal(init.duration, 1 / 30);
  assert.equal(state.sampleData.length, layout.byteLength);
  assert.equal(state.samples.length, 1);
  assert.equal(state.samples[0].closed, 1, "the sample is closed after the add resolves");
  assert.deepEqual(state.calls.find((call) => call[0] === "readPixels"), ["readPixels", 0, 0, 2, 8]);
  assert.deepEqual(state.calls.find((call) => call[0] === "drawArrays"), ["drawArrays", 4, 0, 3]);
  assert.ok(state.canvas, "the converter owns its drawing buffer");
  assert.equal(state.canvas.width, layout.texels);
  assert.equal(state.canvas.height, layout.rows);
});

test("the sample is closed even when the encoder rejects the frame", async () => {
  const state = newState();
  state.gl = fakeGl(state);
  const bunny = fakeBunny(state);
  const error = new Error("encoder rejected the frame");
  const source = createVideoSource(fakeScope(state), bunny, { ...OPTIONS, canvas: { width: 8, height: 4 } });
  state.sampleSource.add = async () => { throw error; };
  await assert.rejects(source.add(0, 0.1, { width: 8, height: 4 }), (value) => value === error);
  assert.equal(state.sampleInit.format, "I420");
  assert.equal(state.samples.length, 0);
  source.dispose();
});

test("a lost converter context fails instead of muxing stale planes", async () => {
  const state = newState();
  state.gl = fakeGl(state);
  const bunny = fakeBunny(state);
  const source = createVideoSource(fakeScope(state), bunny, { ...OPTIONS, canvas: { width: 8, height: 4 } });
  state.lost = true;
  await assert.rejects(source.add(0, 0.1, { width: 8, height: 4 }), /context was lost/);
  await assert.rejects(source.add(0.1, 0.1, { width: 8, height: 4 }), /context was lost/);
});

test("without WebGL2 the canvas source keeps the export working and warns once", async () => {
  const state = newState();
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  const bunny = fakeBunny(state);
  try {
    const canvas = { width: 640, height: 360 };
    const padded = { width: 0, height: 0, getContext: () => ({ fillRect() {}, drawImage() {} }) };
    const scope = { document: { createElement: () => padded } };
    const source = createVideoSource(scope, bunny, { ...OPTIONS, width: 642, height: 362, canvas });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /cannot convert pixels on the GPU/);
    assert.equal(state.canvasSource.canvas, padded);
    assert.equal(state.canvasSource.config.fullCodecString, "avc1.640028");
    assert.equal(state.canvasSource.config.onEncodedPacket, undefined,
      "the fallback must not tag a range it did not convert");
    await source.add(0, 0.1, canvas);
  } finally {
    console.warn = original;
  }
});

test("a converter setup failure falls back to the canvas source", async () => {
  const state = newState();
  const broken = fakeGl(state);
  broken.checkFramebufferStatus = () => 0;
  state.gl = broken;
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const canvas = { width: 8, height: 4 };
    const source = createVideoSource(fakeScope(state), fakeBunny(state), { ...OPTIONS, canvas });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /framebuffer is incomplete/);
    await source.add(0, 0.1, canvas);
    assert.equal(state.added.length, 1, "the fallback submitted the frame");
  } finally {
    console.warn = original;
  }
});
