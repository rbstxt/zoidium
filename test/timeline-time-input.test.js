"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function setup() {
  const listeners = {};
  const input = { style: {}, setAttribute() {}, addEventListener(type, fn) { listeners[type] = fn; }, focus() {}, select() {} };
  const parent = { appendChild(child) { this.child = child; } };
  function Timeline() {}
  Timeline.prototype.create = function () { this.timestamp = { parentNode: parent, style: {}, innerText: "00:00:01:00" }; };
  vm.runInNewContext(fs.readFileSync("plugins/core/timeline-time-input.js", "utf8"), {
    window: { PZ: { ui: { timeline: Timeline } }, document: { createElement: () => input } },
  });
  const timeline = new Timeline();
  timeline.editor = { playback: { frameRate: 30, totalFrames: 100, currentFrame: 0 } };
  timeline.frameToPx = frame => frame * 2;
  timeline.setFrame = px => { timeline.editor.playback.currentFrame = Math.max(0, Math.min(99, Math.round(px / 2))); };
  timeline.create();
  return { timeline, input, listeners };
}
function key(listeners, key, extra) { let stopped = false; listeners.keydown({ key, ...extra, stopPropagation() { stopped = true; }, preventDefault() {} }); return stopped; }
test("accepts frames and displayed timecodes, clamps and stops shortcuts", () => {
  const { timeline, input, listeners } = setup();
  timeline.timestamp.onclick(); input.value = "250"; assert.equal(key(listeners, "Delete"), true); key(listeners, "Enter");
  assert.equal(timeline.editor.playback.currentFrame, 99);
  timeline.timestamp.onclick(); input.value = "00:00:02:10"; key(listeners, "Enter");
  assert.equal(timeline.editor.playback.currentFrame, 70);
  timeline.timestamp.onclick(); input.value = "00:00:01.500"; key(listeners, "Enter");
  assert.equal(timeline.editor.playback.currentFrame, 45);
});
test("escape, blur and invalid input cancel", () => {
  const { timeline, input, listeners } = setup();
  timeline.timestamp.onclick(); input.value = "20"; key(listeners, "Escape");
  timeline.timestamp.onclick(); input.value = "30"; listeners.blur();
  timeline.timestamp.onclick(); input.value = "bad"; key(listeners, "Enter");
  assert.equal(timeline.editor.playback.currentFrame, 0);
});
test("enter then blur seeks once, and IME composition does not commit", () => {
  const { timeline, input, listeners } = setup();
  let seeks = 0; const seek = timeline.setFrame; timeline.setFrame = px => { seeks++; seek(px); };
  timeline.timestamp.onclick(); input.value = "12"; key(listeners, "Enter"); listeners.blur();
  assert.equal(seeks, 1); assert.equal(timeline.editor.playback.currentFrame, 12);
  timeline.timestamp.onclick(); input.value = "40"; key(listeners, "Enter", { isComposing: true });
  assert.equal(seeks, 1); assert.equal(input.style.display, "block");
});
test("negative frames clamp and out-of-range timecode frames are rejected", () => {
  const { timeline, input, listeners } = setup();
  timeline.editor.playback.currentFrame = 50;
  timeline.timestamp.onclick(); input.value = "-5"; key(listeners, "Enter");
  assert.equal(timeline.editor.playback.currentFrame, 0);
  timeline.timestamp.onclick(); input.value = "00:00:01:30"; key(listeners, "Enter");
  assert.equal(timeline.editor.playback.currentFrame, 0);
});
