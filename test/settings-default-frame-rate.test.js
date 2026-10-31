"use strict";

// Covers ZoidiumSettings.setDefaultFrameRate: range validation with exact
// fractional rates, storage persistence, live application through
// ZoidiumDefaultProjectSettings, and the open Settings row refresh.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = "";
    this.textContent = "";
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.title = "";
    this.inputMode = "";
    this.style = { setProperty() {}, removeProperty() {} };
    this.dataset = {};
    this.attributes = {};
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name) => classes.has(name),
    };
  }
  appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[String(name)] = String(value); }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }
  addEventListener(name, callback) { (this.listeners[name] = this.listeners[name] || []).push(callback); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}

function harness(stored) {
  const rows = {};
  const written = {};
  const applied = [];
  const events = [];
  const listeners = {};
  let settingsReader = null;
  const legacy = {
    generateTitle: () => new FakeEl("div"),
    generateDescription: () => new FakeEl("div"),
    generateSpacer: () => new FakeEl("div"),
    generateButton: () => new FakeEl("div"),
    generateDropdown: () => {
      const row = new FakeEl("div");
      row.appendChild(new FakeEl("div"));
      row.appendChild(new FakeEl("div"));
      return row;
    },
    generateTextInput: (config) => {
      const row = new FakeEl("div");
      const input = new FakeEl("input");
      row.querySelector = (selector) => (selector === "input" ? input : null);
      row.pz_update = () => { input.value = config.get(); };
      row.pz_update();
      rows[config.title] = { config, row, input };
      return row;
    },
  };
  const window = {
    CM: {},
    document: {
      readyState: "complete",
      getElementById: () => null,
      querySelector: () => null,
      createElement: (tag) => new FakeEl(tag),
      addEventListener() {},
    },
    localStorage: {
      getItem: () => stored,
      setItem: (key, value) => { written[key] = value; },
    },
    setTimeout: (callback) => { callback(); return 1; },
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
    addEventListener: (name, callback) => { listeners[name] = callback; },
    dispatchEvent: (event) => events.push(event),
    ZoidiumUIBuilder: {
      themeModel: require("../zoidium/theme-model.js"),
      themeEditor: { configure: (options) => { settingsReader = options.get; }, selected: () => false, palette: () => ({}) },
    },
    ZoidiumSharedJson: require("./shared-test-apis.js").loadSharedTables().json,
    ZoidiumOutputFrameStore: require("../plugins/core/output-frame-store.js"),
    ZoidiumDefaultProjectSettings: { setFrameRate: (value) => applied.push(value) },
    ZoidiumUI: {
      createMenubarTab: () => true,
      controls: {
        number: () => ({ element: new FakeEl("div"), input: new FakeEl("input"), set() {} }),
        note: () => ({ element: new FakeEl("div") }),
      },
    },
    PZ: { ui: { generateIcon: () => new FakeEl("span"), controls: { legacy } } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = (options || {}).detail; } },
    Date,
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../zoidium/settings.js"), "utf8"), {
    window,
    Date,
    CustomEvent: window.CustomEvent,
  });
  return {
    window,
    api: window.ZoidiumSettings,
    written,
    applied,
    events,
    settings: () => settingsReader(),
    rowInput: (title) => rows[title].input.value,
    rowSet: (title, value) => rows[title].config.set(value),
    close: () => listeners.pagehide(),
  };
}

test("setDefaultFrameRate validates, persists, applies, and refreshes the row", () => {
  const h = harness(null);
  assert.equal(h.api.getDefaultFrameRate(), 30);
  assert.equal(h.rowInput("Default frame rate"), "30");
  assert.equal(h.api.setDefaultFrameRate(29.97), true);
  assert.equal(h.api.getDefaultFrameRate(), 29.97);
  assert.equal(JSON.parse(h.written["zoidium.editor-settings"]).defaultFrameRate, 29.97);
  assert.deepEqual(h.applied, [29.97]);
  assert.equal(h.rowInput("Default frame rate"), "29.97");
  h.close();
});

test("setDefaultFrameRate rejects invalid values without side effects", () => {
  for (const bad of ["", "abc", NaN, null, undefined]) {
    const h = harness(null);
    assert.equal(h.api.setDefaultFrameRate(bad), false);
    assert.equal(h.api.getDefaultFrameRate(), 30);
    assert.deepEqual(Object.keys(h.written), []);
    assert.deepEqual(h.applied, []);
    assert.equal(h.rowInput("Default frame rate"), "30");
    h.close();
  }
});

test("setDefaultFrameRate clamps out-of-range values into 1-240", () => {
  const high = harness(null);
  assert.equal(high.api.setDefaultFrameRate(500), true);
  assert.equal(high.api.getDefaultFrameRate(), 240);
  assert.equal(JSON.parse(high.written["zoidium.editor-settings"]).defaultFrameRate, 240);
  assert.equal(high.rowInput("Default frame rate"), "240");
  high.close();
  const low = harness(null);
  assert.equal(low.api.setDefaultFrameRate(0), true);
  assert.equal(low.api.getDefaultFrameRate(), 1);
  assert.equal(JSON.parse(low.written["zoidium.editor-settings"]).defaultFrameRate, 1);
  low.close();
});

test("the Settings row edit path accepts the same values", () => {
  const h = harness(null);
  h.rowSet("Default frame rate", "59.94");
  assert.equal(h.api.getDefaultFrameRate(), 59.94);
  assert.equal(JSON.parse(h.written["zoidium.editor-settings"]).defaultFrameRate, 59.94);
  h.rowSet("Default frame rate", "bogus");
  assert.equal(h.api.getDefaultFrameRate(), 59.94);
  h.close();
});
