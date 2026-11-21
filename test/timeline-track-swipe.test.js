"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

test("video track visibility swipe is one undoable operation", () => {
  const listeners = {};
  const doc = { addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener() {},
    defaultView: { addEventListener() {}, removeEventListener() {} }, elementFromPoint: () => current };
  let current;
  function Tracks() {}
  Tracks.prototype.createTrackLabel = function (track) {
    const eye = { style: {}, firstElementChild: { style: {} }, ownerDocument: doc, focus() {}, setAttribute() {}, closest() { return this; } };
    return { children: [{}, eye, {}] };
  };
  const undo = [], redo = [];
  const history = { operation: null, startOperation() { this.operation = []; },
    pushCommand(fn, arg) { this.operation.push(() => fn(arg)); },
    finishOperation() { if (this.operation.length) undo.push(this.operation); this.operation = null; },
    replay(from, to) { const commands = from.pop(); this.operation = []; commands.slice().reverse().forEach(fn => fn()); to.push(this.operation); this.operation = null; } };
  const tracks = [0, 1, 2].map(i => ({ enabled: true, getAddress: () => i }));
  const editor = { history, project: { addressLookup: i => tracks[i], ui: { onChanged: { update() {} } } } };
  const panel = new Tracks(); panel.timeline = { editor };
  const context = { PZ: { ui: { timeline: { tracks: Tracks } } } }; context.window = context;
  vm.runInNewContext(fs.readFileSync("plugins/core/timeline-track-swipe.js", "utf8"), context);
  const eyes = tracks.map(track => panel.createTrackLabel(track, 0).children[1]);
  const event = { button: 0, pointerId: 1, currentTarget: eyes[0], stopPropagation() {}, preventDefault() {} };
  eyes[0].onpointerdown(event);
  current = eyes[1]; listeners.pointermove({ pointerId: 1 });
  current = eyes[2]; listeners.pointermove({ pointerId: 1 });
  listeners.pointerup({ type: "pointerup", pointerId: 1 });
  assert.deepEqual(tracks.map(track => track.enabled), [false, false, false]);
  assert.equal(undo.length, 1);
  history.replay(undo, redo);
  assert.deepEqual(tracks.map(track => track.enabled), [true, true, true]);
  history.replay(redo, undo);
  assert.deepEqual(tracks.map(track => track.enabled), [false, false, false]);
});
