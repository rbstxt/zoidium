"use strict";
// Mask properties model: validated default metadata, rename, duplicate with
// fresh IDs, reorder, lock, and colour operations over snapshots.
const test = require("node:test"),
  assert = require("node:assert/strict");
const metadata = require("../plugins/shape-plus/mask-metadata.js");

const PATH_VALUE = [0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 100, 100, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0];
function mask(overrides = {}) {
  return {
    id: "m1",
    kind: "path",
    mode: "add",
    feather: 0,
    opacity: 1,
    invert: 0,
    vertexIds: ["a", "b", "c", "d"],
    vertexModes: {},
    properties: {
      name: "Mask 1",
      enabled: 1,
      closed: 1,
      path: { animated: false, keyframes: [{ frame: 0, value: PATH_VALUE.slice(), tween: 1 }] },
    },
    ...overrides,
  };
}
function legacyMask(overrides = {}) {
  const item = mask(overrides);
  delete item.outlineColor;
  delete item.locked;
  delete item.expansion;
  return item;
}
const ids = masks => masks.map(m => m.id);

test("legacy masks read with defaults without mutating the snapshot", () => {
  const original = [legacyMask(), { ...legacyMask(), id: "m2" }];
  const snapshot = JSON.parse(JSON.stringify(original));
  const ensured = metadata.ensureMetadata(original);
  assert.equal(ensured.length, 2);
  for (const item of ensured) {
    assert.equal(metadata.outlineColorOf(item), metadata.DEFAULT_OUTLINE_COLOR);
    assert.equal(metadata.isLocked(item), false);
    assert.equal(metadata.expansionOf(item), 0);
  }
  assert.deepEqual(original, snapshot);
  // Defaults are present on the returned copies only; legacy fields are kept.
  assert.equal(ensured[0].outlineColor, metadata.DEFAULT_OUTLINE_COLOR);
  assert.equal(ensured[0].locked, false);
  assert.equal(ensured[0].expansion, 0);
  assert.equal(ensured[0].mode, "add");
  assert.deepEqual(ensured[0].vertexIds, ["a", "b", "c", "d"]);
  assert.deepEqual(metadata.metadataOf(legacyMask()).name, "Mask 1");
});

test("metadata validation rejects bad colours, locks, expansions and names", () => {
  assert.doesNotThrow(() => metadata.validateMetadataCollection([mask(), legacyMask({ id: "m2" })]));
  assert.throws(() => metadata.validateMetadataCollection([{ ...mask(), outlineColor: "red" }]), /outline/i);
  assert.throws(() => metadata.validateMetadataCollection([{ ...mask(), outlineColor: "#12345" }]), /outline/i);
  assert.throws(() => metadata.validateMetadataCollection([{ ...mask(), locked: "yes" }]), /lock/i);
  assert.doesNotThrow(() => metadata.validateMetadataCollection([{ ...mask(), locked: 1 }]));
  assert.doesNotThrow(() => metadata.validateMetadataCollection([{ ...mask(), locked: 0 }]));
  assert.throws(() => metadata.validateMetadataCollection([{ ...mask(), expansion: Number.NaN }]), /expansion/i);
  assert.throws(() => metadata.validateMetadataCollection([{ ...mask(), expansion: "2" }]), /expansion/i);
  assert.throws(() => metadata.validateMetadataCollection([{ ...mask(), expansion: Infinity }]), /expansion/i);
  assert.throws(() => metadata.validateMetadataCollection("nope"), /array/i);
});

test("rename changes only the name and keeps ids and references", () => {
  const original = [mask(), { ...mask(), id: "m2", properties: { ...mask().properties, name: "Mask 2" } }];
  const renamed = metadata.rename(original, "m1", "Hero");
  assert.equal(renamed[0].properties.name, "Hero");
  assert.equal(renamed[0].id, "m1");
  assert.equal(renamed[1].properties.name, "Mask 2");
  assert.equal(original[0].properties.name, "Mask 1");
  assert.throws(() => metadata.rename(original, "m1", "   "), /name/i);
  assert.throws(() => metadata.rename(original, "m1", ""), /name/i);
  assert.throws(() => metadata.rename(original, "missing", "Hero"), /unknown|no mask/i);
  assert.throws(() => metadata.rename(original, "m1", "x".repeat(129)), /name/i);
});

test("duplicate mints fresh mask and vertex ids and retains geometry", () => {
  const original = [{ ...mask(), outlineColor: "#f0883e", locked: false, expansion: 2.5 }];
  let n = 0;
  const nextId = () => "fresh-" + (++n);
  const { masks: doubled, id: copyId } = metadata.duplicate(original, "m1", nextId);
  assert.equal(doubled.length, 2);
  assert.equal(original.length, 1);
  const copy = doubled.find(m => m.id === copyId);
  assert.ok(copy);
  assert.ok(!["m1", "a", "b", "c", "d"].includes(copyId));
  assert.equal(new Set(copy.vertexIds).size, copy.vertexIds.length);
  for (const vertexId of copy.vertexIds) assert.ok(!["a", "b", "c", "d"].includes(vertexId));
  // Geometry, keys, properties and mode are retained.
  assert.equal(copy.mode, "add");
  assert.equal(copy.feather, 0);
  assert.deepEqual(copy.properties.path, original[0].properties.path);
  assert.notEqual(copy.properties.path, original[0].properties.path);
  assert.equal(copy.outlineColor, "#f0883e");
  assert.equal(copy.expansion, 2.5);
  assert.ok(copy.properties.name.includes("copy"));
  assert.ok(copy.properties.name !== "Mask 1" || ids(doubled).filter(i => i).length === 2);
  metadata.validateMetadataCollection(doubled);
});

test("duplicate uniquifies copy names and skips colliding generator ids", () => {
  const original = [mask(), { ...mask(), id: "m2", properties: { ...mask().properties, name: "Mask 1 copy" } }];
  const taken = new Set(["m1", "m9", ...original.flatMap(m => m.vertexIds)]);
  let n = 0;
  const nextId = () => (++n <= 2 ? "m1" : "m9-" + n);
  const { masks: doubled, id: copyId } = metadata.duplicate(original, "m1", nextId);
  assert.ok(!taken.has(copyId));
  const copy = doubled.find(m => m.id === copyId);
  assert.ok(copy.properties.name !== "Mask 1 copy");
  assert.ok(copy.properties.name.includes("copy"));
});

test("move and reorder change combine order and validate the id set", () => {
  const original = [mask(), { ...mask(), id: "m2" }, { ...mask(), id: "m3" }];
  assert.deepEqual(ids(metadata.move(original, "m3", 0)), ["m3", "m1", "m2"]);
  assert.deepEqual(ids(metadata.move(original, "m1", 99)), ["m2", "m3", "m1"]);
  assert.deepEqual(ids(metadata.move(original, "m1", -99)), ["m1", "m2", "m3"]);
  assert.deepEqual(ids(original), ["m1", "m2", "m3"]);
  assert.deepEqual(ids(metadata.reorder(original, ["m2", "m3", "m1"])), ["m2", "m3", "m1"]);
  assert.throws(() => metadata.reorder(original, ["m1", "m2"]), /same|id/i);
  assert.throws(() => metadata.reorder(original, ["m1", "m2", "m2"]), /same|id|duplicate/i);
  assert.throws(() => metadata.reorder(original, ["m1", "m2", "mx"]), /unknown|same|id/i);
  assert.throws(() => metadata.move(original, "mx", 0), /unknown|no mask/i);
});

test("lock blocks mutations but allows unlocking and selection", () => {
  const original = [mask()];
  const locked = metadata.setLocked(original, "m1", true);
  assert.equal(metadata.isLocked(locked[0]), true);
  assert.equal(metadata.isLocked(original[0]), false);
  for (const action of ["geometry", "topology", "keyframe", "delete", "edit"]) {
    assert.throws(() => metadata.assertEditable(locked, "m1", action), /locked/i);
  }
  assert.doesNotThrow(() => metadata.assertEditable(locked, "m1", "select"));
  assert.doesNotThrow(() => metadata.assertEditable(locked, "m1", "unlock"));
  const unlocked = metadata.setLocked(locked, "m1", false);
  assert.doesNotThrow(() => metadata.assertEditable(unlocked, "m1", "geometry"));
  assert.throws(() => metadata.setLocked(original, "mx", true), /unknown|no mask/i);
  assert.throws(() => metadata.setLocked(original, "m1", "yes"), /lock/i);
});

test("colour operations validate, default and cycle unused palette entries", () => {
  assert.equal(metadata.outlineColorOf(legacyMask()), metadata.DEFAULT_OUTLINE_COLOR);
  const original = [mask()];
  const coloured = metadata.setOutlineColor(original, "m1", "#f0883e");
  assert.equal(coloured[0].outlineColor, "#f0883e");
  assert.equal(original[0].outlineColor, undefined);
  assert.throws(() => metadata.setOutlineColor(original, "m1", "red"), /outline/i);
  assert.throws(() => metadata.setOutlineColor(original, "m1", "#12345"), /outline/i);
  assert.throws(() => metadata.setOutlineColor(original, "mx", "#ffffff"), /unknown|no mask/i);
  const first = metadata.nextOutlineColor([]);
  assert.equal(first, metadata.OUTLINE_PALETTE[0]);
  const second = metadata.nextOutlineColor([{ ...mask(), outlineColor: metadata.OUTLINE_PALETTE[0] }]);
  assert.equal(second, metadata.OUTLINE_PALETTE[1]);
  assert.match(metadata.nextOutlineColor([mask()]), /^#[0-9a-f]{6}$/i);
});

test("expansion sets signed values without clamping and rejects non-numbers", () => {
  const original = [mask()];
  assert.equal(metadata.expansionOf(legacyMask()), 0);
  assert.equal(metadata.setExpansion(original, "m1", 12.5)[0].expansion, 12.5);
  assert.equal(metadata.setExpansion(original, "m1", -8)[0].expansion, -8);
  assert.equal(metadata.setExpansion(original, "m1", 0)[0].expansion, 0);
  assert.equal(original[0].expansion, undefined);
  assert.throws(() => metadata.setExpansion(original, "m1", Number.NaN), /expansion/i);
  assert.throws(() => metadata.setExpansion(original, "m1", "4"), /expansion/i);
  assert.throws(() => metadata.setExpansion(original, "mx", 4), /unknown|no mask/i);
  // The supported range is decided by coverage measurement (P1.9); until
  // then values persist unclamped and the range stays documented as open.
  assert.equal(metadata.SUPPORTED_EXPANSION_RANGE, null);
});
