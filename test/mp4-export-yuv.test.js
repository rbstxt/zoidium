"use strict";

// The GPU converter writes limited-range BT.709 I420. These tests pin the
// level mapping, the 2x2 chroma block, the plane packing, and the constants
// the fragment shader is generated from.
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CB_DIVISOR, CR_DIVISOR, C_OFFSET, C_SCALE, KB, KG, KR, Y_OFFSET, Y_SCALE,
  planeLayout, rgbBlockToLimitedUv, rgbToLimitedYuv,
} = require("../plugins/mp4-export/yuv-math.js");
const { FRAGMENT_SOURCE, VERTEX_SOURCE } = require("../plugins/mp4-export/yuv-convert.js");

test("BT.709 constants match the standard", () => {
  assert.equal(KR, 0.2126);
  assert.equal(KG, 0.7152);
  assert.equal(KB, 0.0722);
  assert.ok(Math.abs(CB_DIVISOR - 1.8556) < 1e-12);
  assert.ok(Math.abs(CR_DIVISOR - 1.5748) < 1e-12);
  assert.equal(Y_OFFSET, 16);
  assert.equal(Y_SCALE, 219);
  assert.equal(C_OFFSET, 128);
  assert.equal(C_SCALE, 224);
});

test("black and white land on the limited-range end points", () => {
  assert.deepEqual(rgbToLimitedYuv(0, 0, 0), { y: 16, u: 128, v: 128 });
  assert.deepEqual(rgbToLimitedYuv(1, 1, 1), { y: 235, u: 128, v: 128 });
});

test("pure primaries match the BT.709 limited-range table", () => {
  // Red, green and blue as the standard quotes them for limited-range 8 bit.
  assert.deepEqual(rgbToLimitedYuv(1, 0, 0), { y: 63, u: 102, v: 240 });
  assert.deepEqual(rgbToLimitedYuv(0, 1, 0), { y: 173, u: 42, v: 26 });
  assert.deepEqual(rgbToLimitedYuv(0, 0, 1), { y: 32, u: 240, v: 118 });
});

test("mid grey stays neutral and inside the limited range", () => {
  const grey = rgbToLimitedYuv(0.5, 0.5, 0.5);
  assert.equal(grey.u, 128);
  assert.equal(grey.v, 128);
  assert.ok(grey.y > 16 && grey.y < 235);
  // sRGB-encoded 0.5 is not linear light, so the exact level is 126.
  assert.equal(grey.y, 126);
});

test("out-of-range inputs clamp instead of wrapping", () => {
  assert.equal(rgbToLimitedYuv(2, 2, 2).y, 255);
  assert.equal(rgbToLimitedYuv(-1, -1, -1).y, 0);
});

test("a 2x2 chroma block averages before converting", () => {
  const red = [1, 0, 0];
  assert.deepEqual(rgbBlockToLimitedUv([red, red, red, red]), { u: 102, v: 240 });
  // A half red, half blue block averages to half of each chroma swing.
  const blue = [0, 0, 1];
  const averaged = rgbBlockToLimitedUv([red, red, blue, blue]);
  assert.equal(averaged.u, 171);
  assert.equal(averaged.v, 179);
});

test("plane layout packs Y, U and V into one framebuffer with a shared stride", () => {
  const layout = planeLayout(640, 360);
  assert.equal(layout.texels, 160);
  assert.equal(layout.stride, 640);
  assert.equal(layout.chromaWidth, 320);
  assert.equal(layout.chromaHeight, 180);
  assert.equal(layout.rows, 720);
  assert.deepEqual(layout.offsets, { y: 0, u: 230400, v: 345600 });
  assert.equal(layout.byteLength, 460800);
  assert.deepEqual(layout.layout, [
    { offset: 0, stride: 640 },
    { offset: 230400, stride: 640 },
    { offset: 345600, stride: 640 },
  ]);
});

test("widths that are not a multiple of four keep a four-byte texel stride", () => {
  const layout = planeLayout(642, 362);
  assert.equal(layout.texels, 161);
  assert.equal(layout.stride, 644);
  assert.equal(layout.offsets.u, 644 * 362);
  assert.equal(layout.offsets.v, 644 * 362 + 644 * 181);
  assert.equal(layout.byteLength, 644 * 724);
  for (const plane of layout.layout) assert.equal(plane.stride, layout.stride);
});

test("4K layout fits a small framebuffer row count", () => {
  const layout = planeLayout(3840, 2160);
  assert.equal(layout.texels, 960);
  assert.equal(layout.stride, 3840);
  assert.equal(layout.rows, 4320);
  assert.equal(layout.byteLength, 3840 * 4320);
});

test("the converter rejects odd or tiny sizes", () => {
  for (const [width, height] of [[641, 360], [640, 361], [1, 2], [0, 0], [640.5, 360]]) {
    assert.throws(() => planeLayout(width, height), /even dimensions/);
  }
});

test("the fragment shader is generated from the shared constants", () => {
  assert.match(FRAGMENT_SOURCE, /^#version 300 es/);
  assert.match(FRAGMENT_SOURCE, /precision highp float;/);
  for (const literal of ["0.2126", "0.7152", "0.0722", "1.8556", "1.5748", "16.0", "219.0", "128.0", "224.0"]) {
    assert.ok(FRAGMENT_SOURCE.includes(literal), "shader must use " + literal);
  }
  // Rows are addressed top-down from texelFetch, so no flip uniform exists.
  assert.ok(!/uFlip/.test(FRAGMENT_SOURCE));
  assert.match(FRAGMENT_SOURCE, /texelFetch\(uSource, ivec2\(x, y\), 0\)/);
  assert.match(VERTEX_SOURCE, /^#version 300 es/);
  assert.match(VERTEX_SOURCE, /gl_VertexID/);
});
