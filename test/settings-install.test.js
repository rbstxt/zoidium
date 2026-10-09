"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function harness() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  const listeners = new Map();
  const events = [];
  const editor = {};
  const window = {
    CM: editor,
    document: { readyState: "complete", getElementById() { return null; }, querySelector() { return null; } },
    localStorage: { getItem() { return null; } },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, callback) { listeners.set(name, callback); },
    dispatchEvent(event) { events.push(event); },
  };
  class ClockDate extends Date { static now() { return now; } }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../zoidium/settings.js"), "utf8"), {
    window, Date: ClockDate, CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
  });
  return {
    window, editor, events, listeners, timers,
    advance(ms) {
      const end = now + ms;
      while (timers.size) {
        const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0];
        if (timer.due > end) break;
        now = timer.due; timers.delete(id); timer.callback();
      }
      now = end;
    },
  };
}

test("Settings installation stops at its thirty second elapsed deadline", () => {
  const state = harness();
  state.advance(29999);
  assert.equal(state.events.length, 0);
  state.advance(1);
  assert.equal(state.timers.size, 0);
  assert.equal(state.events.length, 1);
  assert.equal(state.events[0].type, "zoidium:extension-script-error");
  assert.match(state.events[0].detail.message, /30 seconds/);
  state.advance(120000);
  assert.equal(state.events.length, 1);
});

test("Settings installation cancels when the active editor is replaced", () => {
  const state = harness();
  state.window.CM = {};
  state.advance(250);
  assert.equal(state.timers.size, 0);
  assert.equal(state.events.length, 0);
});

test("Settings installation cancels when the page is destroyed", () => {
  const state = harness();
  state.listeners.get("pagehide")();
  assert.equal(state.timers.size, 0);
  state.advance(30000);
  assert.equal(state.events.length, 0);
});

test("an installed Settings panel stops further polling", () => {
  const state = harness();
  state.window.document.querySelector = (selector) => selector === ".zoidium-settings-tab" ? {} : null;
  state.advance(250);
  assert.equal(state.timers.size, 0);
  assert.equal(state.events.length, 0);
});
