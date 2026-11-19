"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { FakeElement } = require("./fake-dom.js");
const { installNotices } = require("../plugins/asset-manager/assets-notices.js");

test("asset notices cancel pending save and project timers on disable", () => {
  const host = new FakeElement("window"), timers = new Map(), subscribers = new Set(); let next = 0;
  host.setTimeout = fn => { const id = ++next; timers.set(id, fn); return id; };
  host.clearTimeout = id => timers.delete(id);
  const registry = { subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); }, snapshot: () => ({ items: [] }) };
  const editor = { project: {} }, session = { window: host, editor, registry: () => registry, notify() {}, openWindow() {} };
  for (let i = 0; i < 15; i++) {
    const dispose = installNotices(session);
    host.dispatch("zoidium:project-saved", {});
    editor.project = {}; for (const fn of subscribers) fn();
    assert.equal(timers.size, 2);
    dispose();
    assert.equal(timers.size, 0); assert.equal(subscribers.size, 0);
    assert.equal(host.listeners["zoidium:project-saved"].length, 0);
  }
});
