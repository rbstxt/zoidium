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

// The analysis input is the smaller of the rendered frame and the project
// frame. A preview buffer cannot provide more detail than it holds, and the
// selected level then divides that input. A reduced preview therefore caps
// the analysis size without changing the selected level. Exports pass their
// output frame, so the same rule gives the author's pre-quality export sizes
// at every output resolution up to the project resolution.
function analysisPlan({ quality, width, height, projectWidth, projectHeight } = {}) {
  const frameWidth = positiveSize(width);
  const frameHeight = positiveSize(height);
  if (!frameWidth || !frameHeight) return null;
  const level = qualityLevel(quality);
  const divisor = QUALITY_DIVISORS[level];
  const baseWidth = Math.min(frameWidth, positiveSize(projectWidth) || frameWidth);
  const baseHeight = Math.min(frameHeight, positiveSize(projectHeight) || frameHeight);
  return {
    level,
    divisor,
    exact: divisor === 1,
    width: Math.max(MIN_ANALYSIS_SIZE, Math.floor(baseWidth / divisor)),
    height: Math.max(MIN_ANALYSIS_SIZE, Math.floor(baseHeight / divisor)),
  };
}

module.exports = { analysisPlan, qualityLevel, QUALITY_DIVISORS };
