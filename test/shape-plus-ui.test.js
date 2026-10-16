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

test("cached native list factories support add, clone, reorder and deletion history without a schema change", t => {
  const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
  const cache = path.resolve(__dirname, "../.zoidium-resources");
  if (!fs.existsSync(path.join(cache, "core-1.0.102.js"))) { t.skip("CM3 cache unavailable"); return; }
  const core = fs.readFileSync(path.join(cache, "core-1.0.102.js"), "utf8");
  const ui = fs.readFileSync(path.join(cache, "ui-1.0.72.js"), "utf8");
  class Observable { watch() {} unwatch() {} update() {} }
  class Node {
    get parentObject() { return this.parent?.parentObject; }
    getAddress(child) {
      const address = this.parent ? this.parent.getAddress(this) : [];
      if (child) address.push(this.children.indexOf(child));
      return address;
    }
  }
  const Host = { ...PZ, object: Node, observable: Observable, ui: { edit: function () {} } };
  const sandbox = { PZ: Host };
  // Execute the actual classes and structural commands from the ignored cache.
  // Native runtime text is never checked into the repository.
  vm.runInNewContext(core.slice(core.indexOf("PZ.objectList=class"), core.indexOf(",PZ.objectSingleton=class")), sandbox);
  const start = ui.indexOf("createObject(e){", ui.indexOf("PZ.ui.edit.prototype="));
  const end = ui.indexOf(",generateAdd:", start);
  vm.runInNewContext("PZ.ui.edit.prototype={" + ui.slice(start, end) + "}", sandbox);
  const { Content } = createModel(Host), root = new Node();
  root.contents = new Host.objectList(root, Content); root.children = [root.contents];
  let operation = null;
  const undo = [], redo = [];
  const history = {
    pushCommand(fn, data) { operation.push(() => fn(data)); },
    run(work, destination = undo) { operation = []; work(); destination.push(operation); operation = null; },
    replay(source, destination) {
      const commands = source.pop();
      this.run(() => { for (const command of commands.slice().reverse()) command(); }, destination);
    },
  };
  const panel = new Host.ui.edit();
  panel.editor = { history, project: { addressLookup: address => address.reduce((node, key) => node.children ? node.children[key] : node[key], root) } };
  const add = (kind, data) => panel.createObject({ newParentAddress: [0], baseType: Content, subType: kind, data });
  history.run(() => add("rectangle", { id: "rect", properties: {} }));
  history.run(() => add("stroke", { id: "paint", properties: {} }));
  const saved = JSON.stringify(root.contents);
  history.run(() => add("rectangle", JSON.parse(JSON.stringify(root.contents[0]))));
  assert.notEqual(root.contents[0].id, root.contents[2].id);
  history.replay(undo, redo); assert.equal(JSON.stringify(root.contents), saved);
  history.replay(redo, undo); assert.equal(root.contents.length, 3);
  history.run(() => panel.moveObject({ oldParentAddress: [0], oldIdx: 2, newParentAddress: [0], newIdx: 0 }));
  assert.equal(root.contents[1].id, "rect");
  history.replay(undo, redo); assert.equal(root.contents[0].id, "rect");
  const beforeDelete = JSON.stringify(root.contents);
  history.run(() => panel.deleteObject({ oldParentAddress: [0], oldIdx: 0 }));
  history.replay(undo, redo); assert.equal(JSON.stringify(root.contents), beforeDelete);
  const roundtrip = new Content("group"); roundtrip.load({ contents: JSON.parse(beforeDelete) });
  assert.equal(JSON.stringify(roundtrip.contents), beforeDelete);
});
