"use strict";

// Preview-side helpers for the Player+ quality menu. The drawing buffer and the
// compositor normally share one size. "Exact effects" keeps the compositor at
// the sequence resolution while the drawing buffer stays reduced.

const UPSCALE_STORAGE_KEY = "zoidium.player-plus.preview-upscale";
const EXACT_STORAGE_KEY = "zoidium.player-plus.exact-effects";
const EXACT_MAX_EDGE = 4096;
const maxTextureSizes = new WeakMap();

function readUpscale(storage) {
  try {
    return storage?.getItem(UPSCALE_STORAGE_KEY) === "sharp" ? "sharp" : "smooth";
  } catch (_error) {
    return "smooth";
  }
}

function writeUpscale(storage, value) {
  try {
    storage?.setItem(UPSCALE_STORAGE_KEY, value === "sharp" ? "sharp" : "smooth");
  } catch (_error) {
    // The setting still applies for the current session if storage is blocked.
  }
}

function readExact(storage) {
  try {
    return storage?.getItem(EXACT_STORAGE_KEY) === "true";
  } catch (_error) {
    return false;
  }
}

function writeExact(storage, value) {
  try {
    storage?.setItem(EXACT_STORAGE_KEY, value ? "true" : "false");
  } catch (_error) {
    // The setting still applies for the current session if storage is blocked.
  }
}

function previewSize(viewport, quality, devicePixelRatio) {
  const canvas = viewport?.canvas;
  if (!canvas) return null;
  const cssWidth = parseFloat(canvas.style?.width) || canvas.clientWidth;
  const cssHeight = parseFloat(canvas.style?.height) || canvas.clientHeight;
  if (!(cssWidth > 0) || !(cssHeight > 0)) return null;
  const ratio = devicePixelRatio || 1;
  return {
    width: Math.max(1, Math.round(cssWidth * ratio * quality)),
    height: Math.max(1, Math.round(cssHeight * ratio * quality)),
  };
}

function resolutionOf(viewport) {
  const value = viewport?.editor?.project?.sequence?.properties?.resolution?.get?.();
  if (!Array.isArray(value) || value.length < 2) return null;
  const width = Math.round(Number(value[0]));
  const height = Math.round(Number(value[1]));
  return width > 0 && height > 0 ? [width, height] : null;
}

function maxTextureSize(viewport) {
  const renderer = viewport?.renderer;
  if (renderer && maxTextureSizes.has(renderer)) return maxTextureSizes.get(renderer);
  const gl = renderer?.context;
  if (!gl?.getParameter || gl.MAX_TEXTURE_SIZE == null) return 0;
  let size = 0;
  try { size = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)); } catch (_error) { size = 0; }
  if (!Number.isFinite(size) || size <= 0) return 0;
  if (renderer) maxTextureSizes.set(renderer, size);
  return size;
}

// Exact effects need a sequence-sized compositor. Keep the reduced preview
// when that compositor would exceed the preview or GPU limit.
function exactSupport(viewport, maxEdge = EXACT_MAX_EDGE) {
  const resolution = resolutionOf(viewport);
  if (!resolution) {
    return { resolution: null, available: false, reason: "The sequence resolution is unavailable." };
  }
  if (resolution[0] > maxEdge || resolution[1] > maxEdge) {
    return { resolution, available: false,
      reason: "Exact effects are unavailable above " + maxEdge + " px on a side (" +
        resolution[0] + " × " + resolution[1] + ")." };
  }
  const max = maxTextureSize(viewport);
  if (max > 0 && (resolution[0] > max || resolution[1] > max)) {
    return { resolution, available: false,
      reason: "Exact effects are unavailable above the GPU texture limit of " + max + " px (" +
        resolution[0] + " × " + resolution[1] + ")." };
  }
  return { resolution, available: true, reason: "" };
}

function exactActive(viewport, enabled, quality) {
  if (!enabled || quality >= 1 || viewport?.renderMode) return false;
  return exactSupport(viewport).available;
}

function restoreUpscale(viewport) {
  if (!Object.prototype.hasOwnProperty.call(viewport, "__zoidiumPlayerPlusImageRendering")) return;
  const previous = viewport.__zoidiumPlayerPlusImageRendering;
  if (viewport.canvas?.style) viewport.canvas.style.imageRendering = previous;
  delete viewport.__zoidiumPlayerPlusImageRendering;
}

function applyUpscale(viewport, value) {
  const canvas = viewport?.canvas;
  if (!canvas?.style) return;
  if (value !== "sharp") { restoreUpscale(viewport); return; }
  if (!Object.prototype.hasOwnProperty.call(viewport, "__zoidiumPlayerPlusImageRendering")) {
    viewport.__zoidiumPlayerPlusImageRendering = canvas.style.imageRendering || "";
  }
  canvas.style.imageRendering = "pixelated";
}

module.exports = {
  UPSCALE_STORAGE_KEY, EXACT_STORAGE_KEY, EXACT_MAX_EDGE,
  readUpscale, writeUpscale, readExact, writeExact,
  previewSize, resolutionOf, maxTextureSize, exactSupport, exactActive,
  restoreUpscale, applyUpscale,
};
