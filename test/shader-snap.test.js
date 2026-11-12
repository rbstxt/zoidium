"use strict";
// Snap (B35) is a grid separate from Step: committed row edits round to
// multiples of snap, while blank or 0 keeps current behaviour bit-for-bit.
// Only Slider, Seed, Angle and Time sample definitions opt in, and only the
// specific native input instance of a Shader+ row is wrapped.
const test = require("node:test"), assert = require("node:assert/strict");
const { snapValue, isSnapActive, wrapInputInstance, createWithSnap } = require("../plugins/shader-plus/snap");
const { KINDS } = require("../plugins/shader-plus/kinds");

function definition(kind, extra = {}) {
  const base = KINDS[kind].create();
  return { ...base, ...extra };
}

test("snap math clamps, grids from min, and clamps again", () => {
  const d = definition("slider", { min: 0, max: 1, snap: 0.5 });
  assert.equal(snapValue(0.24, d), 0);
  assert.equal(snapValue(0.26, d), 0.5);
  assert.equal(snapValue(1.4, d), 1, "clamp before snap keeps the range");
  assert.equal(snapValue(-3, d), 0);
  const offset = definition("slider", { min: 0.1, max: 2, snap: 0.5 });
  assert.equal(snapValue(0.4, offset), 0.6, "grid offsets from min, not from 0");
  assert.equal(snapValue(1.9, offset), 2, "the second clamp holds the range");
});

test("half-way cases round away from zero, including negatives", () => {
  const d = definition("slider", { min: -10, max: 10, snap: 1 });
  assert.equal(snapValue(2.5, d), 3);
  assert.equal(snapValue(-2.5, d), -3, "a half-way value rounds away from zero, not the quotient");
  assert.equal(snapValue(-2.4, d), -2);
  const free = definition("timeSample", { snap: 0.5 });
  assert.equal(snapValue(-0.75, free), -1);
  assert.equal(snapValue(-0.24, free), 0);
});

test("a missing, blank, zero, negative, or non-finite snap leaves the value alone", () => {
  const base = definition("slider", { min: 0, max: 1 });
  for (const snap of [undefined, 0, -0.5, NaN, Infinity, "0.5"]) {
    assert.equal(snapValue(0.62, { ...base, snap }), 0.62, "snap " + String(snap));
    assert.equal(isSnapActive({ ...base, snap }), false);
  }
  assert.equal(snapValue(5, base), 5, "no snap field still clamps only");
  assert.equal(isSnapActive(definition("slider", { snap: 0.5 })), true);
});

test("snap stays inactive for kinds and native rows outside Shader+ snap scope", () => {
  assert.equal(isSnapActive({ ...KINDS.checkbox.create(), snap: 0.5 }), false);
  assert.equal(isSnapActive({ ...KINDS.dropdown.create(), snap: 1 }), false);
  assert.equal(isSnapActive({ custom: true, dynamic: true, type: 0, value: 0.5, snap: 0.5 }), false,
    "a kind-less native definition never opts in");
  assert.equal(snapValue(0.62, { custom: true, dynamic: true, type: 0, value: 0, snap: 0.5 }), 0.62);
});

test("a non-finite value passes through instead of throwing", () => {
  const d = definition("slider", { snap: 0.5 });
  assert.equal(snapValue(NaN, d), NaN);
  assert.equal(snapValue(Infinity, d), Infinity);
});

test("wrapping an instance snaps set while the prototype and peers stay native", () => {
  const calls = [];
  const proto = { set(value) { calls.push(value); this.value = value; } };
  const make = () => Object.assign(Object.create(proto), { value: 0 });
  const a = make(), b = make();
  wrapInputInstance(a, definition("slider", { min: 0, max: 10, snap: 5 }));
  a.set(7); b.set(7);
  assert.equal(a.value, 5);
  assert.equal(b.value, 7, "an unwrapped peer keeps the raw value");
  assert.equal(Object.hasOwn(a, "set"), true, "the override is an own property of the instance");
  assert.equal(Object.hasOwn(b, "set"), false);
  wrapInputInstance(a, definition("slider", { snap: 5 }));
  a.set(8); assert.equal(a.value, 10, "double wrapping still snaps exactly once");
  assert.deepEqual(calls, [5, 7, 10]);
});

test("createWithSnap restores the constructor, including on throw", () => {
  const PZ = { ui: { input: function Input() { this.marker = true; } } };
  const Original = PZ.ui.input;
  const snapped = { definition: definition("slider", { snap: 0.5 }) };
  const made = createWithSnap(PZ, snapped, () => new PZ.ui.input());
  assert.equal(PZ.ui.input, Original);
  assert.equal(made.__zoidiumSnapWrapped, true);
  assert.throws(() => createWithSnap(PZ, snapped, () => { throw new Error("boom"); }), /boom/);
  assert.equal(PZ.ui.input, Original);
  let plain;
  createWithSnap(PZ, { definition: definition("slider") }, () => { plain = new PZ.ui.input(); });
  assert.equal(plain.__zoidiumSnapWrapped, undefined, "an inactive snap constructs a plain input");
});
