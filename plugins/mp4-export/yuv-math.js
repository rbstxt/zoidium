"use strict";

// Limited-range BT.709 conversion for sRGB-encoded R'G'B' in 0..1.
//
// The canvas holds sRGB-encoded values, so the transfer function stays
// untouched: only the luma weights and the 16..235 / 128..240 level mapping
// apply. `yuv-convert.js` builds its shader from these same constants, so the
// GPU maths and the node tests cannot drift apart.
const KR = 0.2126;
const KG = 0.7152;
const KB = 0.0722;
// Cb = (B - Y) / 1.8556, Cr = (R - Y) / 1.5748.
const CB_DIVISOR = 2 * (1 - KB);
const CR_DIVISOR = 2 * (1 - KR);
const Y_OFFSET = 16;
const Y_SCALE = 219;
const C_OFFSET = 128;
const C_SCALE = 224;

function clampByte(value) {
  if (value < 0) return 0;
  if (value > 255) return 255;
  return value;
}

// Rounds and clamps one 0..1 channel set to limited-range Y, Cb and Cr.
// The inputs are already gamma encoded; no linearisation happens here.
function rgbToLimitedYuv(r, g, b) {
  const luma = KR * r + KG * g + KB * b;
  return {
    y: clampByte(Math.round(Y_OFFSET + Y_SCALE * luma)),
    u: clampByte(Math.round(C_OFFSET + C_SCALE * (b - luma) / CB_DIVISOR)),
    v: clampByte(Math.round(C_OFFSET + C_SCALE * (r - luma) / CR_DIVISOR)),
  };
}

// 4:2:0 chroma for one 2x2 block, averaged in R'G'B' before the conversion.
// Averaging the four converted samples instead would round each one first.
function rgbBlockToLimitedUv(pixels) {
  let r = 0, g = 0, b = 0;
  for (const pixel of pixels) {
    r += pixel[0];
    g += pixel[1];
    b += pixel[2];
  }
  const count = pixels.length || 1;
  const chroma = rgbToLimitedYuv(r / count, g / count, b / count);
  return { u: chroma.u, v: chroma.v };
}

// One RGBA8 framebuffer holds the three planes. Every texel carries four
// bytes of one plane, so the row stride is `ceil(width / 4) * 4` bytes for Y,
// U and V alike. U and V rows hold `width / 2` meaningful bytes each; the
// remaining bytes of a chroma row stay unused, which keeps one row index in
// the shader equal to one framebuffer row.
function planeLayout(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
    width < 2 || height < 2 || width % 2 !== 0 || height % 2 !== 0) {
    throw new Error("The YUV converter needs even dimensions of at least 2 pixels.");
  }
  const texels = Math.ceil(width / 4);
  const stride = texels * 4;
  const chromaHeight = height / 2;
  const uOffset = stride * height;
  const vOffset = uOffset + stride * chromaHeight;
  return {
    width,
    height,
    texels,
    stride,
    chromaWidth: width / 2,
    chromaHeight,
    rows: height + chromaHeight * 2,
    byteLength: vOffset + stride * chromaHeight,
    offsets: { y: 0, u: uOffset, v: vOffset },
    layout: [
      { offset: 0, stride },
      { offset: uOffset, stride },
      { offset: vOffset, stride },
    ],
  };
}

module.exports = {
  CB_DIVISOR,
  CR_DIVISOR,
  C_OFFSET,
  C_SCALE,
  KB,
  KG,
  KR,
  Y_OFFSET,
  Y_SCALE,
  clampByte,
  planeLayout,
  rgbBlockToLimitedUv,
  rgbToLimitedYuv,
};
