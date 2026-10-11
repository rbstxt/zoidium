"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function element(tag = "div") {
  const node = {
    tagName: tag.toUpperCase(), children: [],
    classList: { values: new Set(), add(value) { this.values.add(value); }, contains(value) { return this.values.has(value); } },
    set className(value) { value.split(/\s+/).forEach((name) => this.classList.add(name)); },
    appendChild(child) { this.children.push(child); return child; },
    insertBefore(child) { this.children.unshift(child); return child; },
    get firstChild() { return this.children[0]; },
    querySelector() { return this.children.find((child) => child.classList.contains("zoidium-editor-launch")) || null; },
    addEventListener() {},
  };
  return node;
}

function harness(options) {
  class ObjectTarget {}
  class PropertyList extends ObjectTarget {}
  class Edit {
    constructor() {
      this.options = { showPropertyControls: true, showListItemButtons: true, hideAllListItemButtons: false, columnLayout: 0, ...options };
    }
    generateItemCommands() { return "commands"; }
    generateChildrenList(item) { item.nextElementSibling = element("ul"); return "children"; }
    generatePropertyList(item) { item.nextElementSibling = element("ul"); return "properties"; }
    unloadListItem() { return "unloaded"; }
    generateButton() { return element("button"); }
  }
  const originals = { ...Edit.prototype };
  originals.commands = Edit.prototype.generateItemCommands;
  const edit = new Edit();
  let refreshed = 0;
  edit.enabled = true;
  edit.objectsChanged = () => refreshed++;
  const panelNode = element(); panelNode.pz_panel = edit;
  const context = { console, PZ: { object: ObjectTarget, propertyList: PropertyList, ui: { edit: Edit } }, document: { createElement: element, querySelectorAll: () => [panelNode] } };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../zoidium/ui-panels.js"), "utf8"), context);
  const api = context.ZoidiumUIModules[0].install({ controls: { button: ({ title, onClick }) => { const button = element("button"); button.title = title; button.onclick = onClick; return { element: button }; } } });
  const target = new ObjectTarget();
  let opened = 0;
  const unregister = api.registerEditor({ title: "Flare Editor", match: (value) => value === target, open: () => opened++ });
  const item = element("li"); item.pz_object = target; item.children = [element(), element()];
  const watchers = new Set();
  const list = { onListChanged: { watch: (fn) => watchers.add(fn), unwatch: (fn) => watchers.delete(fn) } };
  return { edit, refreshed: () => refreshed, api, item, target, list, watchers, unregister, opened: () => opened, Edit, originals };
}

for (const [name, options] of [
  ["stock CM3 Graph editor", { columnLayout: 2, showPropertyControls: false, hideAllListItemButtons: true }],
  ["Graph Editor 2", { columnLayout: 2, showPropertyControls: false, hideAllListItemButtons: true }],
  ["name-only track list", { showPropertyControls: false }],
  ["commands suppressed", { hideAllListItemButtons: true }],
]) {
  test(`${name} gets no launch rows or watchers`, () => {
    const h = harness(options);
    assert.equal(h.edit.generateChildrenList(h.item), "children");
    assert.equal(h.item.nextElementSibling.children.length, 0);
    assert.equal(h.edit.generatePropertyList(h.item, h.list), "properties");
    assert.equal(h.item.nextElementSibling.children.length, 0);
    assert.equal(h.watchers.size, 0);
    h.unregister();
  });
}

for (const options of [{ showPropertyControls: false, showListItemButtons: false }, { hideAllListItemButtons: true, showListItemButtons: false }]) {
  test(`suppressed list commands do not gain editor gears: ${JSON.stringify(options)}`, () => {
    const h = harness(options);
    assert.equal(h.edit.generateItemCommands(h.item, h.target), "commands");
    assert.equal(h.item.children[1].children.length, 0);
  });
}

test("Objects/Effects property panels keep launch rows, clicks, rebuilds and watcher cleanup", () => {
  // keyframePanel is also present on value panels, so it cannot disqualify them.
  const h = harness({ keyframePanel: {} });
  h.edit.generateChildrenList(h.item);
  assert.equal(h.item.nextElementSibling.children.length, 1);
  const button = h.item.nextElementSibling.firstChild.firstChild;
  assert.equal(button.title, "Open Flare Editor");
  let prevented = 0, stopped = 0;
  button.onclick({ preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  assert.equal(h.opened(), 1); assert.equal(prevented, 1); assert.equal(stopped, 1);
  h.edit.generatePropertyList(h.item, h.list);
  const ul = h.item.nextElementSibling;
  assert.equal(h.watchers.size, 1);
  for (const refresh of h.watchers) refresh();
  assert.equal(ul.children.length, 1, "no duplicate launch rows");
  ul.children.length = 0;
  for (const refresh of h.watchers) refresh();
  assert.equal(ul.children.length, 1, "reinsert after CM3 rebuild");
  assert.equal(h.edit.unloadListItem(h.item), "unloaded");
  assert.equal(h.watchers.size, 0);
  h.unregister();
  assert.equal(h.Edit.prototype.generateItemCommands, h.originals.commands);
});

for (const [name, options] of [
  ["Objects/Effects object list", { columnLayout: 1, showListItemButtons: false }],
  ["Edit panel", { showListItemButtons: false, keyframePanel: {} }],
  ["Zoidium property view", { showListItemButtons: false, alwaysShowListItemButtons: false }],
]) {
  test(`${name} keeps its gear behavior without gaining a launch row`, () => {
    const h = harness(options);
    h.edit.generateItemCommands(h.item, h.target);
    assert.equal(h.item.children[1].children.length, 1);
    h.item.children[1].firstChild.onclick({ stopPropagation() {} });
    assert.equal(h.opened(), 1);
    h.edit.generateChildrenList(h.item);
    assert.equal(h.item.nextElementSibling.children.length, 0);
  });
}


test("editor registration and refresh leave name-only graph selection alone", () => {
  const h = harness({ columnLayout: 2, showPropertyControls: false, hideAllListItemButtons: true });
  assert.equal(h.refreshed(), 0);
  h.api.refreshEditors();
  h.unregister();
  assert.equal(h.refreshed(), 0);
});

test("editor registration and refresh still rebuild native property panels", () => {
  const h = harness({});
  assert.equal(h.refreshed(), 1);
  h.api.refreshEditors();
  assert.equal(h.refreshed(), 2);
  h.unregister();
  assert.equal(h.refreshed(), 3);
});
