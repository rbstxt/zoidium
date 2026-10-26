"use strict";

require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict"), test = require("node:test");
const { harness, canvas, glyph, clone } = require("./text-plus-2d-harness.js");
const { install } = require("../plugins/text-plus/text-plus-2d.js");
const { controlSource, loadCharacters } = require("../plugins/text-plus/text-plus-2d-properties.js");
const { glyphBounds, center, unionBounds } = require("../plugins/text-plus/text-plus-2d-draw.js");
const { getTextPlusControls } = require("../plugins/text-plus/text-plus-controls.js");

function render(layer, frame) { layer.update(frame); const ctx = canvas(); layer.draw(ctx); return ctx.log; }
function setup() {
  const h = harness(), layer = h.add();
  const native = render(layer, 0), nativeChildren = layer.children.slice();
  const dispose = install(h);
  return { ...h, layer, p: layer.textPlusCharacters, native, nativeChildren, dispose };
}

test("all six neutral modes call native drawing without extra operations or path changes", () => {
  const h = setup(), paths = h.layer.objects[0].objects.map(child => child.path);
  assert.equal(h.layer.zoidiumTextPlus2D, undefined);
  for (let mode = 0; mode <= 6; mode++) {
    h.p.mode.set(mode);
    assert.deepEqual(render(h.layer, 0), h.native);
    assert.deepEqual(h.layer.objects[0].objects.map(child => child.path), paths);
  }
  assert.deepEqual(h.layer.children.slice(0, 3), h.nativeChildren);
  h.dispose();
  assert.deepEqual(render(h.layer, 0), h.native);
});

test("2D controls use native types and expose only the chosen mode's fields", () => {
  const h = setup(), p = h.p;
  assert.equal(p._zoidiumCategoryName, "Character");
  assert.deepEqual(Object.keys(p).filter(key => p[key].visible), ["mode"]);
  p.mode.set(1);
  assert.equal(p.charPosition.definition.type, h.PZ.property.type.VECTOR2);
  assert.equal(p.charRotation.definition.type, h.PZ.property.type.NUMBER);
  assert.equal(p.charScale.definition.linkRatio, true);
  assert.equal(p.charScale.objects.length, 2);
  assert.equal(p.charPosition.visible, true);
  assert.equal(p.characterNumbers.visible, false);
  assert.equal(p.shakeAmplitude.visible, false);
  assert.equal(p.charEulerOrder, undefined);
  assert.equal(p.shakeAxis, undefined);
  p.mode.set(5);
  assert.equal(p.characterNumbers.visible, true);
  assert.equal(p.shakeAmplitude.visible, true);
  assert.equal(p.charPosition.visible, false);
  h.dispose();
});

test("reload replaces native keyframes and expressions without changing property identities", () => {
  const h = setup(), property = h.p.charRotation;
  assert.equal(property.keyframes.length, 1);
  assert.equal(h.p.charPosition.objects[0].keyframes.length, 1);
  h.p.charRotation.expression = "frame * 2";
  h.p.charRotation.animated = true;
  for (let i = 0; i < 3; i++) {
    loadCharacters(h.p, { charRotation: { animated: true, keyframes: [
      { frame: 0, value: 0 }, { frame: 24, value: 0.6 },
    ] } });
    assert.equal(h.p.charRotation, property);
    assert.equal(property.expression, null);
    assert.equal(property.keyframes.length, 2);
    assert.equal(property.get(12), 0.3);
  }
  loadCharacters(h.p);
  assert.equal(property.animated, false);
  assert.equal(property.keyframes.length, 1);
  assert.equal(property.get(0), 0);
  h.dispose();
});

test("mode changes defer panel rebuilding until the native option handler finishes", async () => {
  const h = setup();
  await Promise.resolve();
  let changes = 0;
  h.p.onListChanged.watch(() => changes++);
  h.p.mode.set(1);
  assert.equal(changes, 0);
  h.p.mode.set(3);
  await Promise.resolve();
  assert.equal(changes, 1);
  assert.equal(h.p.shakeAmplitude.visible, true);
  h.dispose();
});

test("character transforms keep native paints, positive Y, and per-character pivots", () => {
  const h = setup();
  h.p.mode.set(1); h.p.charPosition.set([5, 8]); h.p.charRotation.set(0.3);
  const log = render(h.layer, 0);
  const box = glyphBounds(h.layer.objects[0].objects[0], 0, new WeakMap()), pivot = center(box);
  assert.deepEqual(log[1], ["translate", pivot[0] + 5, pivot[1] - 8]);
  assert.deepEqual(log[2], ["rotate", -0.3]);
  assert.equal(log.filter(entry => entry[0] === "fill").length, 3);
  assert.equal(log.filter(entry => entry[0] === "stroke").length, 3);
  h.p.pivot.set(1);
  const textCenter = center(unionBounds(h.layer.objects[0].objects.map(child => glyphBounds(child, 0, new WeakMap()))));
  assert.deepEqual(render(h.layer, 0)[1], ["translate", textCenter[0] + 5, textCenter[1] - 8]);
  h.dispose();
});

test("delay evaluates properties and expressions at explicit delayed frames", () => {
  const h = setup();
  h.p.mode.set(1); h.p.delayPerCharacter.set(3);
  h.p.charRotation.expression = "frame * 2";
  const source = controlSource(h.p);
  assert.equal(getTextPlusControls(source, 10, 0, 3).rotation[2], 20);
  assert.equal(getTextPlusControls(source, 10, 2, 3).rotation[2], 8);
  assert.equal(getTextPlusControls(source, 1, 2, 3).rotation[2], 0);
  assert.ok(h.p.charRotation.reads.every(Number.isFinite));
  h.dispose();
});

test("selection counts native glyph slots, including spaces, and delays only selected slots", () => {
  const h = setup();
  h.p.mode.set(4); h.p.characterNumbers.set("1,3"); h.p.delayPerCharacter.set(2);
  h.p.charRotation.expression = "frame * 2";
  const source = controlSource(h.p);
  assert.equal(getTextPlusControls(source, 10, 0, 3).rotation[2], 20);
  assert.equal(getTextPlusControls(source, 10, 1, 3).rotation[2], 0);
  assert.equal(getTextPlusControls(source, 10, 2, 3).rotation[2], 16);
  assert.equal(render(h.layer, 10).filter(entry => entry[0] === "rotate").length, 2);
  h.dispose();
});

test("gradient interpolates 2D vectors and scalar rotation, including single glyphs", () => {
  const h = setup();
  h.p.mode.set(2); h.p.firstRotation.set(0.1); h.p.lastRotation.set(0.9);
  h.p.lastPosition.set([20, 10]);
  const source = controlSource(h.p), middle = getTextPlusControls(source, 0, 1, 3);
  assert.deepEqual(middle.position, [10, 5, 0]);
  assert.equal(middle.rotation[2], 0.5);
  assert.equal(getTextPlusControls(source, 0, 0, 1).rotation[2], 0.1);
  h.dispose();
});

test("shake is phase driven and preserves selected phase offsets", () => {
  const h = setup();
  h.p.mode.set(5); h.p.characterNumbers.set("1,3");
  h.p.shakeAmplitude.set(1); h.p.shakePeriod.set(4); h.p.shakePhase.set(1);
  h.p.shakeDelayPerCharacter.set(1);
  const source = controlSource(h.p);
  assert.equal(getTextPlusControls(source, 20, 0, 3).shake, 1);
  assert.equal(getTextPlusControls(source, 20, 1, 3).shake, 0);
  assert.equal(getTextPlusControls(source, 20, 2, 3).shake, 0);
  assert.deepEqual(render(h.layer, 20), render(h.layer, 120).map(entry => entry[0] === "path" ? [entry[0], entry[1], 20] : entry));
  h.dispose();
});

test("scatter has no render history and preserves fractional seeds", () => {
  const h = setup();
  h.p.mode.set(6); h.p.amount.set(1); h.p.seed.set(1.1);
  const first = render(h.layer, 12);
  render(h.layer, 80); render(h.layer, 0);
  assert.deepEqual(render(h.layer, 12), first);
  h.p.seed.set(1.2);
  assert.notDeepEqual(render(h.layer, 12), first);
  h.p.amount.set(0);
  assert.deepEqual(render(h.layer, 0), h.native);
  h.dispose();
});

test("settings, hidden property addresses, and native rendering survive disposal and reactivation", () => {
  const h = setup();
  h.p.mode.set(1); h.p.charPosition.set([30, 0]);
  const address = h.p.charPosition.getAddress(), expected = render(h.layer, 0), saved = clone(h.layer);
  assert.equal(h.layer.addressLookup(address), h.p.charPosition);
  h.dispose();
  assert.equal(h.p.visible, false);
  assert.deepEqual(render(h.layer, 0), h.native);
  assert.deepEqual(clone(h.layer).zoidiumTextPlus2D, saved.zoidiumTextPlus2D);
  // Native undo still reaches the live property after disabling Text+.
  h.layer.addressLookup(address).set([8, 0]);
  assert.equal(clone(h.layer).zoidiumTextPlus2D.characterProperties.charPosition.objects[0].keyframes[0].value, 8);
  h.layer.addressLookup(address).set([30, 0]);
  const pasted = h.add(clone(h.layer));
  assert.equal(pasted.type, 7);
  assert.deepEqual(clone(pasted).zoidiumTextPlus2D, saved.zoidiumTextPlus2D);
  const disposeAgain = install(h);
  assert.equal(h.layer.textPlusCharacters, h.p);
  assert.equal(h.layer.addressLookup(address), h.p.charPosition);
  assert.deepEqual(render(h.layer, 0), expected);
  assert.deepEqual(render(pasted, 0), expected);
  disposeAgain();
});

test("glyph rebuilds use new native paths, and failures restore every temporary wrapper", () => {
  const h = setup();
  h.p.mode.set(1); h.p.charPosition.set([4, 0]);
  const original = h.layer.objects[0].objects[0];
  render(h.layer, 0);
  const next = glyph(100); h.layer.objects[0].objects = [next];
  assert.deepEqual(render(h.layer, 0).find(entry => entry[0] === "path"), ["path", 100, 0]);
  const draw = next.draw;
  const ctx = canvas(); ctx.path = () => { throw Error("draw failed"); };
  assert.throws(() => h.layer.draw(ctx), /draw failed/);
  assert.equal(next.draw, draw);
  assert.equal(original.draw.name, "draw");
  assert.equal(ctx.log.filter(entry => entry[0] === "save").length, ctx.log.filter(entry => entry[0] === "restore").length);
  h.dispose();
});

test("future metadata renders native Text and round trips without schema rewriting", () => {
  const h = harness(), dispose = install(h);
  const settings = { schemaVersion: 99, payload: { unknown: [1, 2] } };
  const layer = h.add({ zoidiumTextPlus2D: settings });
  assert.equal(layer.textPlusCharacters, undefined);
  assert.deepEqual(clone(layer).zoidiumTextPlus2D, settings);
  assert.equal(render(layer, 0).filter(entry => entry[0] === "path").length, 3);
  dispose();
});
