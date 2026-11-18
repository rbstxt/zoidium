"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { chooseAnalysisMode } = require("../plugins/smart-motion-blur-lite/analysis-mode.js");

test("a frame at the project size uses full analysis", () => {
  assert.equal(chooseAnalysisMode({
    width: 1920, height: 1080, projectWidth: 1920, projectHeight: 1080, exporting: false,
  }), "full");
});

test("a frame larger than the project keeps full analysis", () => {
  assert.equal(chooseAnalysisMode({
    width: 2560, height: 1440, projectWidth: 1920, projectHeight: 1080, exporting: false,
  }), "full");
});

test("a reduced preview frame uses half analysis", () => {
  for (const scale of [0.5, 0.25, 0.125]) {
    assert.equal(chooseAnalysisMode({
      width: Math.round(1920 * scale),
      height: Math.round(1080 * scale),
      projectWidth: 1920,
      projectHeight: 1080,
      exporting: false,
    }), "half");
  }
});

test("one-pixel rounding does not turn a full-size frame into a reduced one", () => {
  assert.equal(chooseAnalysisMode({
    width: 1919, height: 1079, projectWidth: 1920, projectHeight: 1080, exporting: false,
  }), "full");
});

test("every export uses full analysis even at a smaller output size", () => {
  for (const [width, height] of [[640, 360], [1280, 720], [3840, 2160]]) {
    assert.equal(chooseAnalysisMode({
      width, height, projectWidth: 1920, projectHeight: 1080, exporting: true,
    }), "full");
  }
});

test("unknown sizes fall back to full analysis", () => {
  assert.equal(chooseAnalysisMode({ width: 0, height: 0, projectWidth: 1920, projectHeight: 1080 }), "full");
  assert.equal(chooseAnalysisMode({ width: 1920, height: 1080, projectWidth: 0, projectHeight: 0 }), "full");
  assert.equal(chooseAnalysisMode(), "full");
});
