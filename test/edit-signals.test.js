"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../plugins/core/edit-signals.js"), "utf8");

function sandbox({ history = true } = {}) {
  const events = new Map(), docEvents = new Map(), fontEvents = new Map();
  const clock = { now: 1000 };
  function observable() {
    return { watch() {}, unwatch() {} };
  }
  class History {
    startOperation() { this.calls = (this.calls || []).concat("start"); }
    pushCommand() { this.calls = (this.calls || []).concat("push"); }
    finishOperation() { this.calls = (this.calls || []).concat("finish"); }
    discardOperation() { this.calls = (this.calls || []).concat("discard"); }
    undo() { this.calls = (this.calls || []).concat("undo"); }
    redo() { this.calls = (this.calls || []).concat("redo"); }
  }
  const document = {
    addEventListener: (name, fn) => docEvents.set(name, fn),
    removeEventListener: name => docEvents.delete(name),
    fonts: {
      addEventListener: (name, fn) => fontEvents.set(name, fn),
      removeEventListener: name => fontEvents.delete(name),
    },
  };
  const context = vm.createContext({
    console, document, performance: { now: () => clock.now },
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: name => events.delete(name),
    PZ: history ? { ui: { history: History } } : {},
    project: { ui: { onChanged: observable() } },
  });
  vm.runInContext(source, context);
  return { context, api: context.ZoidiumEditSignals, History, events, docEvents, fontEvents, clock };
}

test("signals advance the epoch, stamp the time and reach subscribers", () => {
  const h = sandbox();
  const seen = [];
  const subscription = h.api.subscribe((reason, epoch) => seen.push([reason, epoch]));
  assert.equal(h.api.lastSignalAt, -Infinity);
  assert.equal(h.api.isHot(), false);
  h.clock.now = 1200;
  h.api.signal("pointerdown");
  assert.equal(h.api.epoch, 1);
  assert.equal(h.api.lastSignalAt, 1200);
  assert.equal(h.api.isHot(), true);
  assert.deepEqual(seen, [["pointerdown", 1]]);
  h.clock.now = 1200 + 1500;
  assert.equal(h.api.isHot(), false);
  h.clock.now = 1300;
  h.api.touch("layer-input-source");
  assert.deepEqual(seen[1], ["api.layer-input-source", 2]);
  subscription.unwatch();
  h.api.signal("keydown");
  assert.equal(seen.length, 2);
  assert.equal(h.api.epoch, 3, "the epoch still advances without subscribers");
});

test("a failing subscriber does not stop the others", () => {
  const h = sandbox();
  const seen = [];
  h.api.subscribe(() => { throw new Error("boom"); });
  h.api.subscribe(reason => seen.push(reason));
  const error = console.error;
  console.error = () => {};
  try { h.api.signal("input"); } finally { console.error = error; }
  assert.deepEqual(seen, ["input"]);
});

test("input events signal except hover without a pressed button", () => {
  const h = sandbox();
  assert.equal(h.events.size, 19);
  h.events.get("pointermove")({ type: "pointermove", buttons: 0 });
  assert.equal(h.api.epoch, 0, "hovering cannot edit");
  h.events.get("pointerdown")({ type: "pointerdown" });
  assert.equal(h.api.epoch, 1);
  assert.equal(h.api.gestureActive(), true);
  h.events.get("pointermove")({ type: "pointermove", buttons: 1 });
  assert.equal(h.api.epoch, 2);
  assert.equal(h.api.gestureActive(), true);
  h.events.get("pointerup")({ type: "pointerup" });
  assert.equal(h.api.gestureActive(), false);
  h.events.get("touchstart")({ type: "touchstart" });
  assert.equal(h.api.gestureActive(), true);
  h.events.get("touchcancel")({ type: "touchcancel" });
  assert.equal(h.api.gestureActive(), false);
});

test("document and font events signal and bump their own epoch", () => {
  const h = sandbox();
  h.docEvents.get("zoidium:plugin-state-change")();
  assert.equal(h.api.pluginEpoch, 1);
  assert.equal(h.api.epoch, 1);
  assert.equal(h.api.graphReason("plugin-state-change"), true);
  h.docEvents.get("zoidium:project-load-start")();
  assert.equal(h.api.graphReason("project-load-start"), true);
  h.docEvents.get("zoidium:asset-reloaded")();
  assert.equal(h.api.graphReason("asset-reloaded"), true);
  assert.equal(h.api.graphReason("pointerdown"), false);
  h.fontEvents.get("loadingdone")({ type: "loadingdone" });
  assert.equal(h.api.fontEpoch, 1);
  assert.equal(h.api.epoch, 4);
});

test("history operations signal before and after, and disposal restores them", () => {
  const h = sandbox();
  const proto = h.History.prototype;
  const hookedUndo = proto.undo;
  const instance = new h.History();
  const reasons = [];
  h.api.subscribe(reason => reasons.push(reason));
  proto.undo.call(instance);
  assert.deepEqual(instance.calls, ["undo"]);
  assert.deepEqual(reasons, ["history.undo", "history.undo"]);
  assert.equal(h.api.epoch, 2);
  h.api.dispose();
  assert.notEqual(proto.undo, hookedUndo);
  assert.equal(h.events.size, 0);
  assert.equal(h.docEvents.size, 0);
  assert.equal(h.fontEvents.size, 0);
});

test("the signal module is a single shared instance", () => {
  const h = sandbox();
  vm.runInContext(source, h.context);
  assert.equal(vm.runInContext("ZoidiumEditSignals", h.context), h.api);
});
