"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { revealRow, activate } = require("../plugins/core/keyframe-row-reveal.js");

// Rows are 20 px tall and stacked from the top of a scrolled 60 px container.
function panel(rowCount, scrollTop = 0) {
  const container = { scrollTop, getBoundingClientRect: () => ({ top: 100, bottom: 160 }), children: [] };
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    children: [{}],
    getBoundingClientRect() {
      const top = 100 + index * 20 - container.scrollTop;
      return { top, bottom: top + 20 };
    },
  }));
  return { container, rows };
}

function install() {
  const disposers = [];
  const calls = [];
  class Keyframes {
    constructor(container) { this.container = container; }
    trackAnimatedChanged(track, property) { calls.push([track, property]); }
    createKeyframeTrack(_container, track, property) {
      this.trackAnimatedChanged(track, property);
      return track;
    }
  }
  const native = {
    changed: Keyframes.prototype.trackAnimatedChanged,
    create: Keyframes.prototype.createKeyframeTrack,
  };
  activate({
    PZ: { ui: { timeline: { keyframes: Keyframes } } },
    lifecycle: { onDispose: fn => disposers.push(fn) },
  });
  return { Keyframes, calls, native, dispose: () => disposers.forEach(fn => fn()) };
}

test("a row below the fold scrolls up to the panel's bottom edge", () => {
  const { container, rows } = panel(5);
  revealRow(container, rows[4]);
  assert.equal(container.scrollTop, 40);
});

test("a row above the fold scrolls down to the panel's top edge", () => {
  const { container, rows } = panel(5, 40);
  revealRow(container, rows[0]);
  assert.equal(container.scrollTop, 0);
});

test("a row already inside the panel does not move it", () => {
  const { container, rows } = panel(5, 20);
  revealRow(container, rows[2]);
  assert.equal(container.scrollTop, 20);
});

test("animating a property reveals its row after the native update", () => {
  const { Keyframes, calls, dispose } = install();
  const { container, rows } = panel(5);
  new Keyframes(container).trackAnimatedChanged(rows[4], { animated: true, expression: null });
  assert.equal(calls.length, 1);
  assert.equal(container.scrollTop, 40);
  dispose();
});

test("turning animation off or using an expression leaves the panel alone", () => {
  const { Keyframes, dispose } = install();
  const { container, rows } = panel(5);
  const keyframes = new Keyframes(container);
  keyframes.trackAnimatedChanged(rows[4], { animated: false, expression: null });
  keyframes.trackAnimatedChanged(rows[4], { animated: true, expression: "time" });
  assert.equal(container.scrollTop, 0);
  dispose();
});

test("rebuilding rows reports their state without moving the panel", () => {
  const { Keyframes, calls, dispose } = install();
  const { container, rows } = panel(5);
  new Keyframes(container).createKeyframeTrack(container, rows[4], { animated: true, expression: null });
  assert.equal(calls.length, 1);
  assert.equal(container.scrollTop, 0);
  dispose();
});

test("dispose restores the native methods", () => {
  const { Keyframes, native, dispose } = install();
  assert.notEqual(Keyframes.prototype.trackAnimatedChanged, native.changed);
  dispose();
  assert.equal(Keyframes.prototype.trackAnimatedChanged, native.changed);
  assert.equal(Keyframes.prototype.createKeyframeTrack, native.create);
});

test("a timeline without the native methods is left alone", () => {
  assert.doesNotThrow(() => activate({ PZ: { ui: { timeline: {} } }, lifecycle: { onDispose() {} } }));
});
