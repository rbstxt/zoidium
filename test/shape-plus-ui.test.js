"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { install } = require("../plugins/shape-plus/native-ui");
test("native Edit exposes only owned contents, focuses deep numeric selections and reverses its hooks", () => {
  class Node { get parentObject() { return this.parent; } }
  class Layer extends Node {}
  class Content extends Node {}
  class Group extends Node {}
  class Observable {
    constructor() { this.watchers = []; }
    watch(fn) { this.watchers.push(fn); }
    unwatch(fn) { this.watchers.splice(this.watchers.indexOf(fn), 1); }
    update() { for (const fn of this.watchers) fn(); }
  }
  class Edit {
    constructor() {
      this.options = { childFilter: () => false, showListItemButtons: false, keyframePanel: {} };
      this.selection = []; this.objects = [new Layer()]; this.onEnabledChanged = new Observable(); this.enabled = true;
    }
    generateListItem(container, object) { return this.options.childFilter(object.contents); }
    generateItemCommands() { return this.options.showListItemButtons; }
    selectItems() {}
  }
  class Keyframes {
    createKeyframeTrack() {
      const classes = new Set();
      return { classes, classList: { add: c => classes.add(c) }, pz_label: { classList: { add() {} } } };
    }
  }
  const PZ = { ui: { edit: Edit, timeline: { keyframes: Keyframes } }, property: { dynamic: { group: Group } } };
  const original = Edit.prototype.generateListItem, cleanup = [], styles = [];
  const previousDocument = global.document;
  global.document = { createElement: () => ({ remove() { styles.pop(); } }), head: { appendChild: style => styles.push(style) } };
  try {
    install(PZ, Layer, Content, fn => cleanup.push(fn));
    const edit = new Edit(), object = new Content(); object.contents = [];
    const filter = edit.options.childFilter;
    assert.equal(edit.generateListItem(null, object), true);
    assert.equal(edit.options.childFilter, filter);
    assert.equal(edit.generateListItem(null, { contents: [] }), false);
    assert.equal(edit.generateItemCommands(null, object), true);
    assert.equal(edit.options.showListItemButtons, false);
    const channel = new Node(); channel.parent = object;
    edit.selection = [channel]; edit.selectItems();
    assert.equal(edit.options.keyframePanel.objects, edit.selection);
    edit.options.keyframePanel.objects = edit.objects; edit.onEnabledChanged.update();
    assert.equal(edit.options.keyframePanel.objects, edit.selection, "tab reactivation keeps the selected contents root");
    const group = new Group(); group.definition = { zoidiumControl: "shape-plus/path" }; channel.parent = group; group.parent = object;
    const timeline = new Keyframes();
    assert.equal(timeline.createKeyframeTrack({ pz_parent: { pz_object: group } }, channel).classes.has("shape-plus-path-channel"), true);
    assert.equal(timeline.createKeyframeTrack({}, channel).classes.size, 0, "a directly selected scalar remains inspectable");
    edit.selection = []; edit.selectItems();
    assert.equal(edit.options.keyframePanel.objects, edit.objects);
    for (const dispose of cleanup.reverse()) dispose();
    assert.equal(Edit.prototype.generateListItem, original);
    assert.equal(edit.onEnabledChanged.watchers.length, 0);
    assert.equal(styles.length, 0);
  } finally { global.document = previousDocument; }
});
