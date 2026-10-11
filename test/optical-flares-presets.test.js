"use strict";

// Characterization of the Optical Flares catalogues: pinned element types,
// presets and serialized preset records for the file split. Verified against
// the original plugins/optical-flares/optflares.js before the split.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const flaresDir = path.join(projectRoot, "plugins", "optical-flares");

function readFlareSource(file) {
  return fs.readFileSync(path.join(flaresDir, file), "utf8");
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

class Observable {
  constructor() {
    this.watchers = [];
  }
  watch(fn) {
    this.watchers.push(fn);
  }
  update(...args) {
    for (const fn of this.watchers.slice()) fn(...args);
  }
}

class Prop {
  constructor(definition) {
    this.definition = definition;
    this.onChanged = new Observable();
    this.value = clone(
      definition.group ? definition.objects.map((entry) => entry.value) : definition.value
    );
  }
  get() {
    return clone(this.value);
  }
  set(value) {
    this.value = clone(value);
    this.onChanged.update();
  }
  load(data) {
    if (data !== undefined && data !== null) this.value = clone(data);
  }
  toJSON() {
    return this.get();
  }
}

class PropList {
  constructor(definitions) {
    this.addAll(definitions || {});
  }
  addAll(definitions) {
    for (const key of Object.keys(definitions)) {
      const entry = definitions[key];
      this[key] = entry instanceof Prop || entry instanceof PropList ? entry : PZ.property.create(entry);
    }
  }
  load(data) {
    const source = data || {};
    for (const key of Object.keys(this)) {
      if (this[key] instanceof Prop || this[key] instanceof PropList) this[key].load(source[key]);
    }
  }
}

function buildCatalogue() {
  const THREE = {};
  class PZObject {}
  const PZ = {};
  PZ.object = PZObject;
  PZ.property = {
    type: { NUMBER: 1, OPTION: 2, VECTOR2: 3, VECTOR3: 4, COLOR: 5, ASSET: 6, TEXT: 7 },
    create(definition) {
      return new Prop(definition);
    },
  };
  PZ.asset = { type: { IMAGE: "image" } };
  PZ.propertyList = PropList;
  PZ.objectList = class extends Array {};
  PZ.object3d = class extends PZObject {};
  PZ.ui = { objectTypes: new Map() };
  for (const file of ["optflares-math.js", "optflares.js"]) {
    new Function("PZ", "THREE", readFlareSource(file))(PZ, THREE);
  }
  return PZ;
}

const PZ = buildCatalogue();

test("the element catalogue keeps twelve ordered types", () => {
  assert.deepEqual(
    PZ.opticalflares.ELEMENT_TYPES.map((entry) => entry.key),
    [
      "glow",
      "multiiris",
      "iris",
      "streak",
      "shimmer",
      "glint",
      "spikeball",
      "sparkle",
      "ring",
      "hoop",
      "caustic",
      "lensorbs",
    ]
  );
  assert.equal(PZ.opticalflares.ELEMENT_TYPES[0].seed, 5000);
  assert.equal(PZ.opticalflares.ELEMENT_TYPES[11].seed, 6100);
});

test("the preset catalogue keeps five entries", () => {
  assert.deepEqual(
    PZ.opticalflares.PRESETS.map((preset) => preset.key),
    ["default", "anamorphic", "sparkle", "cinematic", "scifi"]
  );
});

test("every preset serializes a stable element stack", () => {
  const expected = { default: 15, anamorphic: 6, sparkle: 6, cinematic: 6, scifi: 6 };
  for (const [key, count] of Object.entries(expected)) {
    const records = PZ.opticalflares.presetData(key);
    assert.equal(records.length, count, key);
    for (const record of records) {
      assert.ok(Number.isInteger(record.properties.element.elementType));
    }
  }
  assert.deepEqual(PZ.opticalflares.presetData("unknown").length, 15, "unknown keys fall back");
});

test("the default stack starts with two glows and pins its first record", () => {
  const records = PZ.opticalflares.presetData("default");
  assert.equal(records[0].properties.element.elementType, 0);
  assert.equal(records[1].properties.element.elementType, 0);
  assert.equal(records[0].properties.globalParams.scale, 100);
  assert.equal(records[1].properties.globalParams.scale, 139.5);
  assert.equal(records[1].properties.element.opacity, 80);
  assert.equal(records[14].properties.element.elementType, 11);
  const again = PZ.opticalflares.presetData("default");
  assert.deepEqual(again, records, "preset records are deterministic");
});

test("spec() builds a full element record with type defaults", () => {
  const entry = PZ.opticalflares.spec(3, { scale: 110, aspect: 9 });
  assert.deepEqual(entry, {
    type: 3,
    scale: 110,
    distance: 0,
    aspect: 9,
    texture: 0,
    color: [0.55, 0.72, 1],
    seed: 5300,
    rotation: 0,
    opacity: 100,
    blend: 0,
    enabled: 1,
  });
});
