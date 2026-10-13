"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  parseCharacterSelection: parse, matchesCharacter: matches,
  acquireSelectionFilter, syncCharacterRequests, releaseCharacterRequests,
} = require("../plugins/scene-plus/effector-fracture-characters.js");
const { getTextLayout } = require("../plugins/text-plus/text-plus-utils.js");

test("fracture ranges accept inclusive one-based ranges without expanding large ranges", () => {
  const selection = parse(" 1 - 3, 6, 6, 9007199254740991 ");
  assert.equal(selection.valid, true);
  assert.deepEqual([0, 1, 2, 3, 5, 6].map(index => matches(selection, { index })), [true, true, true, false, true, false]);
  assert.equal(matches(parse("1-9007199254740991"), { index: 45 }), true);
  assert.deepEqual(parse(" \t "), { all: true, valid: true, ranges: [] });
  assert.equal(matches(parse(""), null, true), true);
});

test("invalid ranges fracture no characters even when inverted", () => {
  for (const value of ["0", "-2", "3-1", "1,", "1,,2", "1.5", "1 2", "A", "1-2-3", "9007199254740992"]) {
    const selection = parse(value);
    assert.equal(selection.valid, false, value);
    assert.equal(matches(selection, { index: 0 }, false), false);
    assert.equal(matches(selection, { index: 0 }, true), false);
  }
});

test("selection maps repeated glyphs, spaces and multiple lines onto local indices", () => {
  const layout = getTextLayout("O O\nO", { resolution: 1000, glyphs: { O: { ha: 600 }, " ": { ha: 250 } } }, 20);
  assert.deepEqual(layout.units.map(unit => [unit.index, unit.sourceIndex]), [[0, 0], [1, 1], [2, 2], [3, 4]]);
  assert.deepEqual(layout.units.map(unit => matches(parse("3"), unit)), [false, false, true, false]);
  assert.deepEqual(layout.units.map(unit => matches(parse("3"), unit, true)), [true, true, false, true]);
  assert.equal(matches(parse("9"), { index: 1, sourceIndex: 2, count: 4 }), false);
});

test("the owned filter preserves the exact empty chain and only removes rejected fractures", () => {
  const calls = [];
  const deformer = { deformMesh(...args) { calls.push(args); } };
  const original = deformer.deformMesh;
  const release = acquireSelectionFilter(deformer), releaseOther = acquireSelectionFilter(deformer);
  const fracture = { acceptsCharacterMesh: mesh => mesh.selected };
  const twist = {}, plain = {};
  const chain = [{ effector: twist }, { effector: fracture }, { effector: plain }];
  const mesh = { selected: true };
  deformer.deformMesh(mesh, chain, 17, 4);
  assert.equal(calls[0][1], chain);
  mesh.selected = false;
  deformer.deformMesh(mesh, chain, 18, 4);
  assert.deepEqual(calls[1], [mesh, [chain[0], chain[2]], 18, 4]);
  release(); release();
  assert.notEqual(deformer.deformMesh, original);
  releaseOther();
  assert.equal(deformer.deformMesh, original);
});

test("selection requests restore pristine sources before acquiring and release on clearing or unloading", () => {
  const calls = [];
  const text = { threeObj: {}, zoidiumRequestCharacterSplit(owner) {
    calls.push(["acquire", owner]);
    return () => calls.push(["release", owner]);
  } };
  const owner = { objects: [{ objects: [text] }, text] };
  const restore = mesh => calls.push(["restore", mesh]);
  syncCharacterRequests(owner, parse("2"), restore);
  syncCharacterRequests(owner, parse("3"), restore);
  assert.deepEqual(calls, [["restore", text.threeObj], ["acquire", owner]]);
  syncCharacterRequests(owner, parse(""), restore);
  assert.deepEqual(calls.slice(2), [["restore", text.threeObj], ["release", owner]]);
  syncCharacterRequests(owner, parse("bad"), restore);
  releaseCharacterRequests(owner, restore);
  releaseCharacterRequests(owner, restore);
  assert.equal(calls.filter(item => item[0] === "release").length, 2);
});

test("disposing generated clone geometry removes character and anchor identity without touching a newer record", () => {
  const { trackCharacterCloneDisposal } = require("../plugins/scene-plus/effector-fracture-characters.js");
  const listeners = new Set();
  const geometry = {
    addEventListener(name, callback) { assert.equal(name, "dispose"); listeners.add(callback); },
    removeEventListener(name, callback) { listeners.delete(callback); },
  };
  const root = { userData: { zoidiumTextPlusCharacters: true } };
  const anchor = { parent: root, userData: { zoidiumTextPlusCharacter: { index: 1 } } };
  const mesh = { parent: anchor, geometry, __zoidiumEffectorGeneratedClone: true,
    userData: { zoidiumTextPlusCharacter: { index: 1 } } };
  trackCharacterCloneDisposal(mesh);
  trackCharacterCloneDisposal(mesh);
  assert.equal(listeners.size, 1);
  const replacement = { index: 2 };
  mesh.userData.zoidiumTextPlusCharacter = replacement;
  for (const callback of listeners) callback();
  assert.equal(mesh.userData.zoidiumTextPlusCharacter, replacement);
  assert.equal(anchor.userData.zoidiumTextPlusCharacter, undefined);
  assert.equal(root.userData.zoidiumTextPlusCharacters, undefined);
  assert.equal(listeners.size, 0);
});
