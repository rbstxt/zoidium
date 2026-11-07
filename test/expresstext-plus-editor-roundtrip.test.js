"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./helpers/expresstext-host.cjs");
const { editorFor } = require("./helpers/editor-identity-host.cjs");
const { markSections } = require("../plugins/expresstext-plus/expresstext-section-values.js");
const copy = value => JSON.parse(JSON.stringify(value));
const keys = list => Array.from(list, section => section.objects[0].definition.effectorKey);

test("native section moves use one undo operation and survive reopen and duplicate", () => {
  const h = fixture();
  try {
    const plain = h.section("Plain", { plainPosition: [4, 0, 0], plainRotation: [0, 1, 0] });
    const formula = h.section("Formula", { formulaExpression: "ry", formulaPosition: [1, 0, 0] });
    const random = h.section("Random", { randomSeed: 9 });
    const list = h.container.customProperties;
    assert.ok(plain instanceof list.type);
    assert.ok(formula instanceof list.type);
    assert.equal(new h.PZ.object3d.group() instanceof list.type, false);
    const before = copy(list);
    const evaluate = () => h.T.evaluateStack(h.T.customSections(h.container), h.T.staticProps({}), 13,
      0, {order: [0], total: 1}, [0, 0, 0]);
    const originalOutput = evaluate();
    const editor = editorFor(h.PZ, h.project);
    const context = { editor };
    const address = list.getAddress();
    editor.history.startOperation();
    h.PZ.ui.edit.prototype.moveObject.call(context, {
      oldParentAddress: address, oldIdx: 1, newParentAddress: address, newIdx: 0,
    });
    editor.history.finishOperation();
    assert.deepEqual(keys(list), ["formulaEnable", "plainEnable", "randomEnable"]);
    assert.notDeepEqual(evaluate(), originalOutput);
    assert.equal(list[0], formula);
    assert.equal(list[1], plain);
    assert.equal(list[2], random);
    assert.deepEqual(copy(list[1]), before[0]);
    assert.deepEqual(copy(list[2]), before[2]);
    editor.history.undo();
    assert.deepEqual(copy(list), before);
    assert.deepEqual(evaluate(), originalOutput);
    editor.history.redo();
    const saved = copy(h.container);
    const Container = h.T.createExpressObjectClass(h.PZ, h.T.getExpressDefinitions()[0]);
    for (let i = 0; i < 2; i++) {
      const reopened = new Container();
      h.project.objects.push(reopened);
      reopened.load(saved);
      assert.deepEqual(keys(reopened.customProperties), keys(list));
      assert.deepEqual(copy(reopened.customProperties), copy(list));
    }
  } finally { h.close(); }
});

test("Shake Noise is seekable and survives native undo, reopen, and duplicate", () => {
  const h = fixture();
  try {
    const section = h.section("Shake", { shakePosition: [3, 8, 2], shakeDelay: 4 });
    const row = section.objects.find(row => row.definition.effectorKey === "shakeMode");
    const props = h.T.groupReader(section);
    const sample = frame => {
      const out = h.T.blankControls();
      h.T.evaluateShake(props, frame, 2, { order: [0, 1, 2], total: 3 }, [0, 0, 0], out, [], {rate: 30});
      return out;
    };
    const sine = sample(13);
    const editor = editorFor(h.PZ, h.project), ops = new h.PZ.ui.properties(editor);
    editor.history.startOperation();
    ops.setValue({ property: row.getAddress(), frame: 0, value: 1 });
    editor.history.finishOperation();
    const noise = sample(13);
    assert.notDeepEqual(noise, sine);
    const frames = [-13, 0, 31, 5, 90];
    const expected = frames.map(sample);
    assert.deepEqual(frames.slice().reverse().map(sample).reverse(), expected);
    editor.history.undo(); assert.deepEqual(sample(13), sine);
    editor.history.redo(); assert.deepEqual(sample(13), noise);
    const saved = copy(h.container);
    const Container = h.T.createExpressObjectClass(h.PZ, h.T.getExpressDefinitions()[0]);
    for (let i = 0; i < 2; i++) {
      const reopened = new Container();h.project.objects.push(reopened);reopened.load(saved);
      const restored = h.T.groupReader(reopened.customProperties[0]);
      const out = h.T.blankControls();
      h.T.evaluateShake(restored, 13, 2, { order: [0, 1, 2], total: 3 }, [0, 0, 0], out, [], {rate: 30});
      assert.deepEqual(out, noise);
    }
    row.set(0, 0);
    assert.deepEqual(sample(13), sine);
  } finally { h.close(); }
});

test("old Shake sections gain Sine without changing saved row addresses or output", () => {
  const h = fixture();
  try {
    const def = h.T.effectorEntryDefs(h.PZ).find(entry => entry.name === "Shake").type;
    def.objects = def.objects.filter(row => row.effectorKey !== "shakeMode");
    const section = h.PZ.property.create(def);
    section.load();
    const rows = Array.from(section.objects);
    h.container.customProperties.push(section);
    const addresses = rows.map(row => copy(row.getAddress()));
    markSections(h.PZ, h.container.customProperties);
    assert.equal(section.objects.length, rows.length + 1);
    rows.forEach((row, i) => assert.deepEqual(copy(row.getAddress()), addresses[i]));
    const mode = section.objects[section.objects.length - 1];
    assert.equal(mode.definition.effectorKey, "shakeMode");assert.equal(mode.get(0), 0);
    markSections(h.PZ, h.container.customProperties);
    assert.equal(section.objects.length, rows.length + 1);
  } finally { h.close(); }
});
