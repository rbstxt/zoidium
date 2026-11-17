"use strict";

const {
  CB_DIVISOR, CR_DIVISOR, C_OFFSET, C_SCALE, KB, KG, KR, Y_OFFSET, Y_SCALE, planeLayout,
} = require("./yuv-math.js");

// A full-screen triangle from gl_VertexID keeps the setup free of buffers.
const VERTEX_SOURCE = `#version 300 es
void main() {
  vec2 corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

function glslNumber(value) {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

// Four bytes of one plane per fragment. The shader counts output rows from
// the framebuffer's bottom (gl_FragCoord.y) and readPixels also returns the
// bottom row first, so the two orders cancel and the buffer holds the planes
// top-down in memory order. texImage2D stores the source canvas top row first
// and texelFetch indexes that order directly. Flipping either side alone
// turns every exported frame upside down.
const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D uSource;
uniform ivec2 uSourceSize;
uniform int uLumaHeight;
uniform int uChromaHeight;
out vec4 outPlanes;

vec3 sourceAt(int x, int y) {
  if (x < 0 || y < 0 || x >= uSourceSize.x || y >= uSourceSize.y) return vec3(0.0);
  return texelFetch(uSource, ivec2(x, y), 0).rgb;
}

float luma(vec3 color) {
  return ${glslNumber(KR)} * color.r + ${glslNumber(KG)} * color.g + ${glslNumber(KB)} * color.b;
}

float toByte(float value) {
  return clamp(value, 0.0, 255.0) / 255.0;
}

float lumaAt(int x, int y) {
  return toByte(${glslNumber(Y_OFFSET)} + ${glslNumber(Y_SCALE)} * luma(sourceAt(x, y)));
}

vec3 blockAt(int x, int y) {
  vec3 sum = sourceAt(x, y) + sourceAt(x + 1, y) + sourceAt(x, y + 1) + sourceAt(x + 1, y + 1);
  return sum * 0.25;
}

float cbAt(int chromaColumn, int chromaRow) {
  vec3 color = blockAt(chromaColumn * 2, chromaRow * 2);
  return toByte(${glslNumber(C_OFFSET)} + ${glslNumber(C_SCALE)} * (color.b - luma(color)) / ${glslNumber(CB_DIVISOR)});
}

float crAt(int chromaColumn, int chromaRow) {
  vec3 color = blockAt(chromaColumn * 2, chromaRow * 2);
  return toByte(${glslNumber(C_OFFSET)} + ${glslNumber(C_SCALE)} * (color.r - luma(color)) / ${glslNumber(CR_DIVISOR)});
}

void main() {
  int column = int(gl_FragCoord.x);
  int row = int(gl_FragCoord.y);
  int base = column * 4;
  if (row < uLumaHeight) {
    outPlanes = vec4(lumaAt(base, row), lumaAt(base + 1, row),
      lumaAt(base + 2, row), lumaAt(base + 3, row));
  } else if (row < uLumaHeight + uChromaHeight) {
    int chromaRow = row - uLumaHeight;
    outPlanes = vec4(cbAt(base, chromaRow), cbAt(base + 1, chromaRow),
      cbAt(base + 2, chromaRow), cbAt(base + 3, chromaRow));
  } else {
    int chromaRow = row - uLumaHeight - uChromaHeight;
    outPlanes = vec4(crAt(base, chromaRow), crAt(base + 1, chromaRow),
      crAt(base + 2, chromaRow), crAt(base + 3, chromaRow));
  }
}
`;

function createDrawingBuffer(scope, width, height) {
  const OffscreenCanvas = scope && scope.OffscreenCanvas;
  if (typeof OffscreenCanvas === "function") {
    try {
      return new OffscreenCanvas(width, height);
    } catch (_unsupported) {
      // Fall back to a document canvas below.
    }
  }
  const document = scope && scope.document;
  if (!document || typeof document.createElement !== "function") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error("The YUV converter shader did not compile: " + (log || "no log"));
  }
  return shader;
}

function createProgram(gl) {
  const program = gl.createProgram();
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SOURCE);
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error("The YUV converter program did not link: " + (log || "no log"));
  }
  return program;
}

// Builds the WebGL2 converter. Returns null when this environment has no
// WebGL2, and throws when the GL objects cannot be created; the caller treats
// both as "use the canvas source".
function createConverter(scope, width, height) {
  const geometry = planeLayout(width, height);
  const canvas = createDrawingBuffer(scope, geometry.texels, geometry.rows);
  if (!canvas || typeof canvas.getContext !== "function") return null;
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  });
  if (!gl || typeof gl.createShader !== "function") return null;
  const state = { gl, canvas, geometry, lost: false, sourceTexture: null, targetTexture: null, framebuffer: null, program: null };
  try {
    state.program = createProgram(gl);
    gl.useProgram(state.program);

    state.sourceTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, state.sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Keep the canvas pixels as authored: no vertical flip, transparency
    // composited on black, and no colour space conversion.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

    state.targetTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, state.targetTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, geometry.texels, geometry.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    state.framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state.targetTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error("The YUV converter framebuffer is incomplete.");
    }
    gl.uniform1i(gl.getUniformLocation(state.program, "uSource"), 0);
    state.sourceSizeLocation = gl.getUniformLocation(state.program, "uSourceSize");
    gl.uniform2i(state.sourceSizeLocation, width, height);
    gl.uniform1i(gl.getUniformLocation(state.program, "uLumaHeight"), height);
    gl.uniform1i(gl.getUniformLocation(state.program, "uChromaHeight"), geometry.chromaHeight);
    state.pixels = new Uint8Array(geometry.stride * geometry.rows);
    const error = gl.getError();
    if (error) throw new Error("The YUV converter reported GL error " + error + " during setup.");
  } catch (setupError) {
    disposeConverter(state);
    throw setupError;
  }
  return {
    geometry,
    layout: geometry.layout,
    convert(sourceCanvas) {
      if (state.lost) throw new Error("The YUV converter context was lost.");
      const sourceWidth = Math.max(1, Math.round(sourceCanvas.width));
      const sourceHeight = Math.max(1, Math.round(sourceCanvas.height));
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, state.sourceTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
      gl.uniform2i(state.sourceSizeLocation, sourceWidth, sourceHeight);
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
      gl.viewport(0, 0, geometry.texels, geometry.rows);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, geometry.texels, geometry.rows, gl.RGBA, gl.UNSIGNED_BYTE, state.pixels);
      if (gl.isContextLost && gl.isContextLost()) {
        state.lost = true;
        throw new Error("The YUV converter context was lost.");
      }
      return { data: state.pixels, layout: geometry.layout, width, height };
    },
    dispose() {
      disposeConverter(state);
    },
  };
}

function disposeConverter(state) {
  const gl = state.gl;
  state.lost = true;
  try {
    if (gl) {
      if (state.program) gl.deleteProgram(state.program);
      if (state.sourceTexture) gl.deleteTexture(state.sourceTexture);
      if (state.targetTexture) gl.deleteTexture(state.targetTexture);
      if (state.framebuffer) gl.deleteFramebuffer(state.framebuffer);
      const lose = typeof gl.getExtension === "function" ? gl.getExtension("WEBGL_lose_context") : null;
      lose?.loseContext();
    }
  } catch (_cleanupError) {
    // Disposal never replaces an export result.
  }
  state.program = null;
  state.sourceTexture = null;
  state.targetTexture = null;
  state.framebuffer = null;
  state.pixels = null;
}

module.exports = { FRAGMENT_SOURCE, VERTEX_SOURCE, createConverter };
