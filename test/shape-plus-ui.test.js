"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { connectObjectsPanel, findObjectsPanel } = require("../plugins/shape-plus/native-ui");
const { PZ } = require("./shape-plus-host");
const { createModel } = require("../plugins/shape-plus/model");
test("Objects filters admit Shape+ lists and retain every native filter result", () => {
  const { Content } = createModel(PZ), dispose = [];
  class Object3d {}
  const native = new PZ.objectList(null, Object3d);
  const contents = new PZ.objectList(null, Content);
  const properties = new PZ.propertyList({}, null);
  const top = { options: { childFilter: child => child === native }, objectsChanged() {} };
  const bottom = { options: { childFilter: child => child !== native }, objectsChanged() {} };
  const originalTop = top.options.childFilter, originalBottom = bottom.options.childFilter;
  connectObjectsPanel(PZ, top, bottom, Content, fn => dispose.push(fn));
  assert.equal(top.options.childFilter(contents), true);
  assert.equal(bottom.options.childFilter(contents), false);
  for (const child of [native, properties, {}, null]) {
    assert.equal(top.options.childFilter(child), originalTop(child));
    assert.equal(bottom.options.childFilter(child), originalBottom(child));
  }
  for (const fn of dispose.reverse()) fn();
  assert.equal(top.options.childFilter, originalTop);
  assert.equal(bottom.options.childFilter, originalBottom);
});
test("Objects panel discovery uses the viewport selection identity", () => {
  class Edit {}
  const top = new Edit(), bottom = new Edit(), effects = new Edit();
  top.selection = []; bottom.objects = top.selection; effects.selection = [];
  const document = { querySelectorAll: () => [effects, top, bottom].map(pz_panel => ({ pz_panel })) };
  assert.deepEqual(findObjectsPanel({ ui: { edit: Edit } }, { mainViewport: { options: { helper3dObjects: top.selection } } }, document), { top, bottom });
});
