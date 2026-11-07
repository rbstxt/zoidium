"use strict";

// Section header rows and recovery of values damaged by the old header editor.

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const { effectorEntryDefs } = require("../plugins/expresstext-plus/expresstext-properties.js");
const {
  SECTION_ROW_CONTROL, installSectionRow, isSection, markSection, markSections,
  recoverSectionValues, uninstallSectionRow, watchSections,
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
const row = (group, key) => group.objects.find(item => item.definition.effectorKey === key);

// The real dispatcher from zoidium/plugin-apis.js, on a fake generator chain.
function withControls(run, stock = () => "stock") {
  const document = { createElement: () => ({ classList: { add() {}, contains: () => true } }) };
  const host = { ...PZ, ui: { controls: { generateInput3: stock }, properties: class {} } };
  const sandbox = vm.createContext({ PZ: host, document, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "zoidium", "plugin-apis.js"), "utf8"), sandbox);
  return run(host, sandbox.ZoidiumPluginApis);
}

test("section rows use the shared control, and only stamped sections get it", () => {
  withControls((host, apis) => {
    assert.equal(installSectionRow(host, apis), true);
    try {
      const generate = (...args) => host.ui.controls.generateInput3(...args);
      assert.equal(entries.length, 11);
      for (const entry of entries) {
        const group = buildGroup(entry.type);
        assert.ok(isSection(host, group), entry.name + " is a section");
        assert.equal(generate(group), "stock", entry.name + " stays stock until it is marked");
        markSection(host, group);
        const box = generate(group);
        assert.equal(typeof box.pz_update, "function", entry.name + " row keeps the panel's update call");
        assert.doesNotThrow(() => box.pz_update(0));
      }
      // Another plugin's large group has no stamped rows: its fields stay.
      const foreign = new Group([1, 2, 3, 4, 5].map(() => new Row({ type: types.NUMBER, value: 0, name: "Other" }, [0])), { type: types.VECTOR3 });
      assert.equal(isSection(host, foreign), false);
      markSection(host, foreign);
      assert.equal(foreign.definition.zoidiumControl, undefined);
      assert.equal(generate(foreign), "stock", "a foreign oversized group keeps its controls");
      // A vector that merely shares a name with a section key prefix is not a section.
      const vector = new Group([1, 2, 3].map(() => new Row({ type: types.NUMBER, value: 0, effectorKey: "plainThing" }, [0])), { type: types.VECTOR3 });
      assert.equal(isSection(host, vector), false, "three rows fit three fields");
    } finally { uninstallSectionRow(); }
    const group = section("Voronoi");
    markSection(host, group);
    assert.equal(host.ui.controls.generateInput3(group), "stock", "deactivation returns sections to the stock editor");
    assert.equal(installSectionRow(host, apis), true, "reactivation registers again");
    assert.notEqual(host.ui.controls.generateInput3(group), "stock");
    uninstallSectionRow();
  });
});

test("the stamp never reaches a saved file", () => {
  const group = section("Voronoi");
  const saved = JSON.stringify(group.definition);
  markSections(PZ, [group]);
  assert.equal(group.definition.zoidiumControl, SECTION_ROW_CONTROL);
  assert.equal(JSON.stringify(group.definition), saved);
});

test("sections added through the list are marked before later watchers run", () => {
  const seen = [];
  const watchers = [];
  const list = { onObjectAdded: { watch: fn => watchers.push(fn) } };
  watchSections(PZ, list);
  watchers.push(property => seen.push(property.definition.zoidiumControl));
  const group = section("Shake");
  for (const fn of watchers) fn(group, 0);
  assert.deepEqual(seen, [SECTION_ROW_CONTROL]);
  assert.doesNotThrow(() => watchSections(PZ, {}));
});

test("the old header edit damages rows, and loading restores exactly those rows", () => {
  for (const entry of entries) {
    const group = buildGroup(entry.type);
    const firstGroup = group.objects.findIndex(item => item.objects);
    const before = group.objects.map(item => item.keyframes?.[0].value);
    // What CM3's three-field editor sends when the middle field is clicked and blurred.
    assert.throws(() => group.set([0, NaN, 0], 0), TypeError, entry.name + " stops at its first vector");
    const saved = JSON.parse(JSON.stringify(group.objects.map(item => item.keyframes ? { ...item.keyframes[0] } : null)));
    group.objects.forEach((item, index) => { if (item.keyframes) item.keyframes[0] = saved[index]; });
    recoverSectionValues(PZ, [group]);
    const after = group.objects.map(item => item.keyframes?.[0].value);
    const expected = before.map((value, index) => {
      if (index === 0) return group.objects[0].definition.type === types.OPTION ? 0 : value;
      // The third row took 0, which is a real choice for a number row.
      if (index === 2 && group.objects[2].definition.type !== types.TEXT) return 0;
      return value;
    });
    assert.deepEqual(after, expected, entry.name);
    assert.ok(firstGroup > 2, entry.name + " starts with its plain rows");
  }
});

test("recovery changes only what the old row could write", () => {
  const group = section("Formula");
  const set = (key, values) => {
    const item = row(group, key);
    item.keyframes = values.map((value, frame) => ({ value, frame }));
    return item;
  };
  // Rows 1 to 3 could take a number or NaN. Later rows could take only undefined.
  const letters = set("formulaLetters", [null, "1-3", 0, 5, NaN, "", "bad"]);
  const strength = set("formulaStrength", [null, undefined, NaN, 0, -3, Infinity, -Infinity, "", "12", "bad"]);
  const minimum = set("formulaMinimum", [undefined, null, 5, Infinity, ""]);
  const expression = set("formulaExpression", [undefined, null, "sin(u)", 7, ""]);
  const enable = set("formulaEnable", [null, 0, 1, Infinity]);
  const seedAfterVector = set("formulaDelay", [null, undefined, NaN, 2]);
  const fieldAfterVector = set("formulaField", [null, 1]);
  const axis = row(group, "formulaPosition").objects[0];
  axis.keyframes = [{ value: null, frame: 0 }, { value: NaN, frame: 1 }];

  recoverSectionValues(PZ, [group]);

  assert.deepEqual(letters.keyframes.map(k => k.value), ["", "1-3", "", "", "", "", "bad"]);
  assert.deepEqual(strength.keyframes.map(k => k.value), [100, 100, 100, 0, -3, Infinity, -Infinity, "", "12", "bad"]);
  assert.deepEqual(minimum.keyframes.map(k => k.value), [0, 0, 5, Infinity, ""]);
  assert.deepEqual(expression.keyframes.map(k => k.value), ["sin(u*360*f+t*90)", "sin(u*360*f+t*90)", "sin(u)", 7, ""], "only rows 1 to 3 can hold a number from the old row");
  assert.deepEqual(enable.keyframes.map(k => k.value), [1, 0, 1, Infinity]);
  assert.ok(seedAfterVector.keyframes[0].value === null && seedAfterVector.keyframes[1].value === undefined, "rows after the first vector stay");
  assert.ok(Number.isNaN(seedAfterVector.keyframes[2].value));
  assert.equal(fieldAfterVector.keyframes[0].value, null);
  assert.equal(axis.keyframes[0].value, null, "nested rows stay");
  assert.ok(Number.isNaN(axis.keyframes[1].value));
  assert.deepEqual(strength.keyframes.map(k => k.frame), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], "frames stay");
});

test("recovery leaves other plugins' groups alone", () => {
  const number = { type: types.NUMBER, value: 8, name: "Other" };
  const foreign = new Group([1, 2, 3, 4, 5].map(() => new Row(number, [NaN, null])));
  recoverSectionValues(PZ, [foreign]);
  assert.ok(Number.isNaN(foreign.objects[0].keyframes[0].value));
  assert.equal(foreign.objects[0].keyframes[1].value, null);
  const vector = new Group([1, 2, 3].map(() => new Row({ ...number, effectorKey: "plainThing" }, [NaN])));
  recoverSectionValues(PZ, [vector]);
  assert.ok(Number.isNaN(vector.objects[0].keyframes[0].value), "a true vector stays");
  assert.doesNotThrow(() => recoverSectionValues(null, null));
});
