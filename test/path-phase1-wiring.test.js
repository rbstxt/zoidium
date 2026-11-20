"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createEditorPathRegistry } = require("../plugins/shape-plus/path-hosts.js");

test("editor registry shares adapters and disposes the controller on project change", () => {
  const watchers = new Set();
  const editor = { project: {}, onProjectChanged: {
    watch: fn => watchers.add(fn), unwatch: fn => watchers.delete(fn),
  } };
  const viewport = {}, layer = {};
  const session = { selectItem(id) { this.activeId = id; }, read: () => [{ kind: "group", contents: [
    { kind: "path", id: "path", vertexIds: ["vertex"] },
  ] }], nextId: () => "new" };
  const registry = createEditorPathRegistry(editor, viewport);
  const original = registry.controller;
  const host = registry.register("shape", layer, session);
  assert.equal(registry.register("shape", layer, session), host);
  assert.equal(registry.activate("shape", layer, "missing"), false);
  assert.equal(registry.activate("shape", layer, "path"), true);
  assert.equal(session.activeId, "path");
  assert.deepEqual(host.listVertexIds("path"), ["vertex"]);
  editor.project = {};
  for (const fn of watchers) fn();
  assert.equal(original.disposed, true);
  assert.notEqual(registry.controller, original);
  assert.equal(registry.controller.activePathId, null);
  registry.dispose();
  assert.equal(watchers.size, 0);
  assert.equal(registry.controller.disposed, true);
});
