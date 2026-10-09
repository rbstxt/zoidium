"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

// ZoidiumUI is a required dependency: consumers call it directly instead of
// guarding each call and reimplementing its builders as a fallback.
const consumers = [
  "zoidium/settings.js",
  "zoidium/project-restore.js",
  "plugins/plugin-manager.js",
];

test("consumers call ZoidiumUI directly without existence guards", () => {
  for (const relative of consumers) {
    const source = fs.readFileSync(path.join(projectRoot, relative), "utf8");
    assert.doesNotMatch(source, /typeof\s+(global\.)?ZoidiumUI/, relative);
    assert.doesNotMatch(source, /ZoidiumUI\s*&&/, relative);
    assert.doesNotMatch(source, /&&\s*(global\.)?ZoidiumUI/, relative);
  }
});

test("ui-kit exposes the full shared builder surface", () => {
  const source = fs.readFileSync(
    path.join(projectRoot, "zoidium", "ui-kit.js"),
    "utf8"
  );
  const context = { console };
  context.window = context;
  vm.runInNewContext(source, context);
  const api = context.ZoidiumUI;
  for (const name of [
    "getElevator",
    "createMenubarTab",
    "removeMenubarTab",
    "acquirePreview",
    "createPageHeader",
    "notify",
    "createSearchBox",
    "attachSearchFilter",
    "createButton",
  ]) {
    assert.equal(typeof api[name], "function", name);
  }
  assert.ok(Object.isFrozen(api));
});

test("menubar removal switches active panels and releases descriptors and DOM", () => {
  function element() {
    return {
      style: {}, children: [],
      appendChild(child) { this.children.push(child); child.parentElement = this; return child; },
      remove() { const parent = this.parentElement; if (parent) parent.children.splice(parent.children.indexOf(this), 1); this.parentElement = null; },
    };
  }
  const tabs = element();
  const controls = element();
  const elevator = {
    panels: [],
    buttonClick() {}, buttonKeyDown() {},
    changeTab(tab) {
      assert.ok(this.panels.includes(this.activePanel), "old panel still exists during tab switch");
      if (this.activePanel) this.activePanel.enabled = false;
      this.activePanel = tab.pz_tab;
      this.activePanel.enabled = true;
    },
  };
  tabs.parentElement = { parentElement: { pz_panel: elevator } };
  const context = {
    document: {
      querySelector: (selector) => selector === ".elevatortabs" ? tabs : selector === ".elevatorcontrols" ? controls : null,
      createElement: element,
    },
    PZ: { ui: { generateIcon: element } },
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "zoidium/ui-kit.js"), "utf8"), context);
  const api = context.ZoidiumUI;
  const first = api.createMenubarTab({ title: "First", panel: element() });
  const second = api.createMenubarTab({ title: "Second", panel: element() });
  const descriptor = first.pz_tab;
  elevator.activePanel = descriptor;
  descriptor.enabled = true;
  assert.equal(api.removeMenubarTab(first), true);
  assert.equal(elevator.activePanel, second.pz_tab);
  assert.equal(descriptor.enabled, false);
  assert.equal(elevator.panels.length, 1);
  assert.equal(tabs.children.length, 1);
  assert.equal(controls.children.length, 1);
  assert.equal(first.onclick, null);
  assert.equal(first.onkeydown, null);
  assert.equal(api.removeMenubarTab(first), false);
  assert.equal(api.removeMenubarTab(second), true);
  assert.equal(elevator.activePanel, null);
  assert.equal(elevator.panels.length, 0);
  assert.equal(controls.children.length, 0);
});

test("preview ownership closes the old editor before transfer and stale release cannot release the new owner", () => {
  const context = { console };
  context.window = context;
  vm.runInNewContext(fs.readFileSync(path.join(projectRoot, "zoidium/ui-kit.js"), "utf8"), context);
  const viewport = {};
  const closed = [];
  const firstRelease = context.ZoidiumUI.acquirePreview(viewport, () => { closed.push("first"); firstRelease(); });
  const secondRelease = context.ZoidiumUI.acquirePreview(viewport, () => { closed.push("second"); secondRelease(); });
  assert.deepEqual(closed, ["first"]);
  firstRelease();
  const thirdRelease = context.ZoidiumUI.acquirePreview(viewport, () => closed.push("third"));
  assert.deepEqual(closed, ["first", "second"]);
  thirdRelease();
  context.ZoidiumUI.acquirePreview(viewport, () => closed.push("fourth"));
  assert.deepEqual(closed, ["first", "second"]);
});
