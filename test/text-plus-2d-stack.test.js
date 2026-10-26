"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict"), test = require("node:test");
const { harness, canvas, clone } = require("./text-plus-2d-harness.js");
const { install } = require("../plugins/text-plus/text-plus-2d.js");
const { glyphBounds, center } = require("../plugins/text-plus/text-plus-2d-draw.js");

function render(layer, frame) { layer.update(frame); const ctx = canvas(); layer.draw(ctx); return ctx.log; }
function setup() {
  const h = harness(), layer = h.add();
  const native = render(layer, 0), nativeChildren = layer.children.slice();
  const dispose = install(h);
  return { ...h, layer, stack: layer.textPlusCharacterStack, native, nativeChildren, dispose };
}

test("later Character categories follow the first one and appear only after the previous one is used", async () => {
  const h = setup(), [first, second, third] = h.stack;
  assert.equal(h.stack.length, 3);
  assert.equal(h.layer.textPlusCharacters, first);
  assert.deepEqual([first, second, third].map(list => list._zoidiumCategoryName),
    ["Character", "Character 2", "Character 3"]);
  // Native children keep their addresses; categories are appended in order.
  assert.deepEqual(h.layer.children.slice(0, 3), h.nativeChildren);
  assert.deepEqual(h.layer.children.slice(3), [first, second, third]);
  assert.deepEqual([first.visible, second.visible, third.visible], [true, false, false]);
  let layerChanges = 0;
  h.layer.properties.onListChanged.watch(() => layerChanges++);
  first.mode.set(1);
  assert.deepEqual([second.visible, third.visible], [true, false]);
  await Promise.resolve();
  assert.equal(layerChanges, 1, "the layer panel rebuilds once a category appears");
  second.mode.set(3);
  assert.equal(third.visible, true);
  // A used later category stays visible even if an earlier one returns to None.
  first.mode.set(0);
  assert.deepEqual([second.visible, third.visible], [true, true]);
  second.mode.set(0);
  assert.deepEqual([second.visible, third.visible], [false, false]);
  h.dispose();
});

test("categories compose in order, with the last category applied outermost", () => {
  const h = setup(), [first, second] = h.stack;
  first.mode.set(1); first.charRotation.set(0.3);
  second.mode.set(1); second.charPosition.set([5, 8]);
  const log = render(h.layer, 0);
  const pivot = center(glyphBounds(h.layer.objects[0].objects[0], 0, new WeakMap()));
  assert.deepEqual(log[0], ["save"]);
  assert.deepEqual(log[1], ["translate", pivot[0] + 5, pivot[1] - 8], "Character 2 moves first on the canvas");
  assert.deepEqual(log[5], ["translate", pivot[0], pivot[1]], "Character 1 transforms inside it");
  assert.deepEqual(log[6], ["rotate", -0.3]);
  assert.equal(log.filter(entry => entry[0] === "save").length, log.filter(entry => entry[0] === "restore").length);
  assert.equal(log.filter(entry => entry[0] === "fill").length, 3);
  h.dispose();
});

test("neutral later categories cost nothing and older files keep their saved shape", () => {
  const h = setup(), [first, second] = h.stack;
  for (let mode = 0; mode <= 6; mode++) second.mode.set(mode);
  second.mode.set(0);
  assert.deepEqual(render(h.layer, 0), h.native);
  assert.equal(h.layer.zoidiumTextPlus2D, undefined);
  first.mode.set(1); first.charPosition.set([30, 0]);
  const single = clone(h.layer).zoidiumTextPlus2D;
  assert.equal(single.schemaVersion, 1);
  assert.equal("extraCharacterProperties" in single, false);
  second.mode.set(3);
  const stacked = clone(h.layer).zoidiumTextPlus2D;
  assert.equal(stacked.extraCharacterProperties.length, 2);
  assert.equal(stacked.extraCharacterProperties[0].mode, 3);
  h.dispose();
});

test("stacked settings round trip through paste, disposal and reactivation", () => {
  const h = setup(), [first, second] = h.stack;
  first.mode.set(1); first.charRotation.set(0.2);
  second.mode.set(1); second.charPosition.set([4, 6]);
  const expected = render(h.layer, 0), saved = clone(h.layer);
  const pasted = h.add(saved);
  assert.equal(pasted.textPlusCharacterStack[1].mode.get(0), 1);
  assert.deepEqual(render(pasted, 0), expected);
  h.dispose();
  assert.deepEqual(h.stack.map(list => list.visible), [false, false, false]);
  assert.deepEqual(render(h.layer, 0), h.native);
  assert.deepEqual(clone(h.layer).zoidiumTextPlus2D, saved.zoidiumTextPlus2D);
  const disposeAgain = install(h);
  assert.equal(h.layer.textPlusCharacterStack, h.stack);
  // Character 3 is offered again because Character 2 is in use.
  assert.deepEqual(h.stack.map(list => list.visible), [true, true, true]);
  assert.deepEqual(render(h.layer, 0), expected);
  disposeAgain();
});
