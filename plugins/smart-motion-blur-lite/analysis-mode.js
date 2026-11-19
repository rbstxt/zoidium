"use strict";

// ZSMB Quality levels. The stored value is the index into these divisors.
// Full keeps the author's full-resolution estimator. Every other level keeps
// the author's reduced Half estimator, whose 1/2 setting analyses one eighth
// of the input width. 1/4 and 1/8 halve that analysis size again.
const QUALITY_DIVISORS = [1, 8, 16, 32];
const DEFAULT_QUALITY = 1;
const MIN_ANALYSIS_SIZE = 6;

function qualityLevel(value) {
  const level = Math.round(Number(value));
  if (!Number.isFinite(level)) return DEFAULT_QUALITY;
  return Math.max(0, Math.min(QUALITY_DIVISORS.length - 1, level));
}

function positiveSize(value) {
  const size = Math.floor(Number(value));
  return Number.isFinite(size) && size > 0 ? size : 0;
}

// The Quality level is the analysis size relative to the project resolution.
// A preview buffer can hold less detail than the level asks for, so it caps
// the analysis size. An export applies the level to its output frame, which
// keeps the author's export sizes at every output resolution up to the project
// resolution and never analyses upscaled pixels.
function analysisPlan({ quality, width, height, projectWidth, projectHeight, exporting } = {}) {
  const frameWidth = positiveSize(width);
  const frameHeight = positiveSize(height);
  if (!frameWidth || !frameHeight) return null;
  const level = qualityLevel(quality);
  const divisor = QUALITY_DIVISORS[level];
  const projectW = positiveSize(projectWidth) || frameWidth;
  const projectH = positiveSize(projectHeight) || frameHeight;
  const targetWidth = exporting ? Math.min(frameWidth, projectW) : projectW;
  const targetHeight = exporting ? Math.min(frameHeight, projectH) : projectH;
  return {
    level,
    divisor,
    exact: divisor === 1,
    width: Math.max(MIN_ANALYSIS_SIZE, Math.min(frameWidth, Math.floor(targetWidth / divisor))),
    height: Math.max(MIN_ANALYSIS_SIZE, Math.min(frameHeight, Math.floor(targetHeight / divisor))),
  };
}

module.exports = { analysisPlan, qualityLevel, QUALITY_DIVISORS };
