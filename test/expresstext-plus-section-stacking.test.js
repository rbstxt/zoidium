"use strict";

// The section row control and the scene field editor patch the same generator.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { effectorEntryDefs } = require("../plugins/expresstext-plus/expresstext-properties.js");
const {
  installSectionRow, markSection, uninstallSectionRow,
} = require("../plugins/expresstext-plus/expresstext-section-values.js");

const types = { NUMBER: 0, VECTOR3: 2, OPTION: 6, TEXT: 7 };

// CM3's group.set(): one assignment per child, in order. A nested group reads
// its array and throws when the value is missing.
class Group {
  constructor(objects, definition = {}) { this.objects = objects; this.definition = definition; }
  set(value, frame) {
    for (let i = 0; i < this.objects.length; i += 1) this.objects[i].set(value[i], frame);
  }
}
class Row {
  constructor(definition, values) {
    this.definition = definition;
    this.keyframes = values.map((value, frame) => ({ value, frame }));
  }
  set(value) { this.keyframes[0].value = value; }
}
const PZ = { property: { type: types, dynamic: { group: Group } } };
function buildGroup(definition) {
  return new Group(definition.objects.map(row => row.objects
    ? new Group(row.objects.map(child => new Row(child, [child.value])), row)
    : new Row(row, [row.value])), { ...definition });
}
const entries = effectorEntryDefs({ property: { type: types } });
const section = name => buildGroup(entries.find(entry => entry.name === name).type);

// The real dispatcher from zoidium/plugin-apis.js, on a fake generator chain.
function withControls(run, stock = () => "stock") {
  const document = { createElement: () => ({ classList: { add() {}, contains: () => true } }) };
  const host = { ...PZ, ui: { controls: { generateInput3: stock }, properties: class {} } };
  const sandbox = vm.createContext({ PZ: host, document, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "zoidium", "plugin-apis.js"), "utf8"), sandbox);
  return run(host, sandbox.ZoidiumPluginApis);
}

test("section rows stack with the scene field editor in either order and either disposal order", () => {
  const { installFieldEdit } = require("../plugins/scene-plus/scene-field-edit.js");
  const previous = { CM: globalThis.CM, ui: globalThis.ZoidiumUI };
  const surface = () => ({ style: {}, addEventListener() {}, removeEventListener() {} });
  const observable = () => ({ watch() {}, unwatch() {} });
  const canvas = surface(), page = surface();
  page.defaultView = surface();
  page.createElement = () => ({ classList: { add() {}, contains: () => true }, style: {}, remove() {} });
  canvas.ownerDocument = page;
  const objects = []; objects.onListChanged = observable();
  const viewport = { renderMode: false, canvas, helper3d: { objects }, onEditChanged: observable() };
  globalThis.CM = { history: { operation: null }, mainViewport: viewport, onProjectChanged: observable() };
  let toggles = 0;
  globalThis.ZoidiumUI = { controls: { checkbox() {
    toggles += 1;
    return { element: { style: {}, querySelector: () => ({ style: {} }), remove() {} }, set() {} };
  } } };
  try {
    for (const fieldFirst of [true, false]) for (const fieldDisposedFirst of [true, false]) {
      const stockEditbox = () => ({ append() {}, classList: { contains: () => true, add() {} } });
      withControls((host, apis) => {
        const installField = () => installFieldEdit(host, {});
        let field;
        if (fieldFirst) { field = installField(); installSectionRow(host, apis); }
        else { installSectionRow(host, apis); field = installField(); }
        const target = { properties: {}, threeObj: { __zoidiumEffectorOwner: true } };
        const fieldPosition = { parentObject: target, definition: { type: types.VECTOR3 } };
        target.properties.fieldPosition = fieldPosition;
        const group = section("Voronoi");
        markSection(host, group);
        const generate = property => host.ui.controls.generateInput3(property);
        const before = toggles;
        generate(fieldPosition);
        assert.equal(toggles, before + 1, "the field toggle renders");
        const box = generate(group);
        assert.equal(typeof box.pz_update, "function", "the section row stays empty");
        assert.equal(toggles, before + 1, "a section row has no field toggle");
        const dispose = [() => field.dispose(), () => uninstallSectionRow()];
        if (!fieldDisposedFirst) dispose.reverse();
        dispose[0]();
        const mid = toggles;
        generate(fieldPosition);
        generate(group);
        if (fieldDisposedFirst) {
          assert.equal(toggles, mid, "a disposed field editor adds no toggle");
          assert.equal(typeof generate(group).pz_update, "function", "sections stay empty while ExpressText+ runs");
        } else {
          assert.equal(toggles, mid + 1, "the field editor still works");
          assert.equal(typeof generate(group).append, "function", "sections return to the stock editor");
        }
        dispose[1]();
        const end = toggles;
        generate(fieldPosition);
        assert.equal(toggles, end, "nothing remains after both plugins leave");
        assert.equal(typeof generate(group).append, "function", "the stock editor renders");
      }, stockEditbox);
    }
  } finally { globalThis.CM = previous.CM; globalThis.ZoidiumUI = previous.ui; uninstallSectionRow(); }
});
