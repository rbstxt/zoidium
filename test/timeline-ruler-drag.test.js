"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  function Timeline() {}
  Timeline.prototype.create = function () {
    this.timerule_drag = { move(event) { this.currentPt = event.pageX - this.origin; } };
  };
  vm.runInNewContext(fs.readFileSync("plugins/core/timeline-ruler-drag.js", "utf8"), { window: { PZ: { ui: { timeline: Timeline } } } });
  const timeline = new Timeline();
  timeline.timerule = { clientWidth: 400, getBoundingClientRect: () => ({ left: 280, width: 400 }) };
  timeline.create();
  return timeline;
}

test("ruler pointer uses viewport coordinates when the page is scrolled", () => {
  const timeline = setup();
  const drag = { origin: 280 };
  timeline.timerule_drag.move.call(drag, { clientX: 450, pageX: 670 });
  assert.equal(drag.currentPt, 170);
});

test("ruler pointer converts scaled screen coordinates to timeline pixels", () => {
  const timeline = setup();
  timeline.timerule.getBoundingClientRect = () => ({ left: 400, width: 320 });
  const drag = { origin: 400 };
  timeline.timerule_drag.move.call(drag, { clientX: 570, pageX: 570 });
  assert.equal(drag.currentPt, 212.5);
});
