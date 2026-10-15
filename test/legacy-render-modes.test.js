"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const test = require("node:test");
const fixtures = require("./fixtures/legacy-render-outputs.json");
const { migrateProject } = require("../zoidium/project-compatibility.js");
const { harness } = require("./material-node-harness.js");
const NodeMaterial = require("../plugins/material-plus/node-material.js");
const Pbr = require("../plugins/material-plus/pbr-plus.js");
const textGeometry = require("../plugins/text-plus/text-plus-geometry.js");
const { withFakeThree, makeTextObject, makeTransformLayer, characterMeshes, matricesClose } = require("./text-scale-harness.js");
const core = require("../plugins/scene-plus/effector-core.js");
const { createTwistClass, createWarpClass } = require("../plugins/scene-plus/scene-effectors.js");
const { curvePolygonCount } = require("../plugins/scene-plus/scene-deform.js");
const state = require("../plugins/scene-plus/scene-state.js");
const plain = value => JSON.parse(JSON.stringify(value));
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Saved data passes through the project migration; plugin versions in the
// file do not matter, only an explicit mode does.
function loadedObject(object) {
  const project = { sequence: { objects: [object] }, plugins: [{ id: "material-plus", version: "16" }, { id: "text-plus", version: "23" }, { id: "repeater", version: "30" }] };
  return migrateProject(project).sequence.objects[0];
}

function extrusion() {
  const vector = (x, y) => ({ x, y, set(x, y) { this.x = x; this.y = y; } });
  return {
    type: fixtures.uv.type, parameters: {},
    vertices: fixtures.uv.vertices.map(([x, y, z]) => ({ x, y, z })),
    faces: fixtures.uv.faces.map(([a, b, c]) => ({ a, b, c })),
    faceVertexUvs: [fixtures.uv.uvs.map(face => face.map(uv => vector(...uv)))],
  };
}
const uvArray = geometry => geometry.faceVertexUvs[0].map(face => face.map(uv => [uv.x, uv.y]));

test("PBR+ new materials serialize current UVs; old, current and explicit saved modes round-trip", async () => {
  const h = harness(); NodeMaterial.activate(h.context); Pbr.activate(h.context);
  const create = async data => {
    const material = h.material("pbrplus");
    const geometry = extrusion();
    const mesh = { geometry, material: null };
    material.parentObject = { threeObj: mesh };
    (await h.PZ.material.fnList.pbrplus).call(material);
    material.load(data);
    mesh.material = material.threeObj;
    material.update(0);
    return { material, geometry };
  };
  try {
    const fresh = await create({ type: "pbrplus" });
    assert.equal(plain(fresh.material).zoidiumUvMode, "current");
    assert.notDeepEqual(uvArray(fresh.geometry), fixtures.uv.uvs);
    fresh.material.unload();
    for (const [saved, mode] of [[{ type: "pbrplus" }, "legacy"], [{ type: "pbrplus", zoidiumUvMode: "current" }, "current"]]) {
      const data = loadedObject({ type: 1, material: saved }).material;
      const { material, geometry } = await create(data);
      assert.equal(plain(material).zoidiumUvMode, mode);
      if (mode === "legacy") assert.deepEqual(uvArray(geometry), fixtures.uv.uvs, "09b7c04^ PBR+ UV arrays");
      else assert.notDeepEqual(uvArray(geometry), fixtures.uv.uvs);
      const copy = await create(plain(material));
      assert.equal(plain(copy.material).zoidiumUvMode, mode);
      assert.deepEqual(uvArray(copy.geometry), uvArray(geometry));
      material.unload(); copy.material.unload();
    }
    const layout = new Function(fs.readFileSync("plugins/material-plus/uv-layout.js", "utf8"))()();
    const { material, geometry } = await create({ zoidiumUvMode: "legacy" });
    layout.applyToGeometry(geometry);
    assert.notDeepEqual(uvArray(geometry), fixtures.uv.uvs);
    material.update(0);
    assert.deepEqual(uvArray(geometry), fixtures.uv.uvs, "switching from a normalized material restores native coordinates");
    material.unload();
  } finally { for (const dispose of h.dispose.reverse()) dispose(); }
});

test("legacy Text matrices match a9007ee^ with singular, negative, uniform and nonuniform scales and nested pivots", () => {
  withFakeThree(THREE => {
    for (const sample of fixtures.text.samples) {
      const loaded = loadedObject({ type: "zoidium:text-plus/text-plus", objects: [{ type: 1 }] }).objects[0];
      const text = makeTextObject(THREE, { textScale: sample.scale, text: "AB" });
      text.zoidiumTextScaleMode = loaded.zoidiumTextScaleMode;
      const layers = sample.transforms.map(makeTransformLayer), split = { entries: [], layers: [] };
      textGeometry.neutralizeTextScale(text, split, 12);
      textGeometry.buildCharacterRendering(text, split, layers);
      textGeometry.updateCharacterRendering(text, split, layers, 12);
      text.threeObj.updateMatrixWorld();
      characterMeshes(text).forEach((mesh, index) => {
        assert.ok(matricesClose(mesh.matrixWorld.elements, sample.matrices[index]), JSON.stringify({ scale: sample.scale, pivot: sample.pivot }));
      });
      textGeometry.restoreTextScale(text, split);
      assert.deepEqual([text.threeObj.scale.x, text.threeObj.scale.y, text.threeObj.scale.z], sample.scale);
    }
  });
});

test("new and explicitly current saved Text keep corrected character rotation under Scale Z zero", () => {
  withFakeThree(THREE => {
    const saved = loadedObject({ type: "zoidium:text-plus/text-plus", objects: [{ type: 1, zoidiumTextScaleMode: "current" }] }).objects[0];
    for (const mode of [undefined, saved.zoidiumTextScaleMode]) {
      const sample = fixtures.text.samples[0];
      const text = makeTextObject(THREE, { textScale: sample.scale, text: "AB" });
      text.zoidiumTextScaleMode = mode;
      const layers = sample.transforms.map(makeTransformLayer), split = { entries: [], layers: [] };
      textGeometry.neutralizeTextScale(text, split, 12);
      textGeometry.buildCharacterRendering(text, split, layers);
      textGeometry.updateCharacterRendering(text, split, layers, 12);
      text.threeObj.updateMatrixWorld();
      assert.ok(!matricesClose(characterMeshes(text)[0].matrixWorld.elements, sample.matrices[0]));
    }
  });
});

function baseStage() {
  const base = plain(fixtures.subdivision.base);
  base.positions = new Float32Array(base.positions);
  base.index = new Uint16Array(base.index);
  for (const attribute of Object.values(base.attributes)) attribute.array = new Float32Array(attribute.array);
  return base;
}
function stageOutputs(stage) {
  return { count: stage.count, positions: Array.from(stage.positions), uv: Array.from(stage.attributes.uv.array),
    normal: Array.from(stage.attributes.normal.array), groups: stage.groups };
}

test("legacy subdivision matches be6ea2b^ templates and interpolated arrays, including the seven-triangle topology", () => {
  const legacy = require("../plugins/scene-plus/legacy-subdivision.js");
  for (const sample of fixtures.subdivision.samples) {
    assert.equal(digest(legacy.getSubdivisionTemplate(sample.count)), sample.templateHash);
    assert.equal(digest(stageOutputs(core.subdivideStage(baseStage(), sample.count, true))), sample.stageHash);
  }
  assert.deepEqual(stageOutputs(core.subdivideStage(baseStage(), 7, true)), fixtures.subdivision.seven);
  assert.equal(core.subdivideStage(baseStage(), 7, false).count / 3, 8, "current count rounds to four per source triangle");
  assert.equal(core.budgetSubdivision(7, 6, true), 6, "legacy budget clamps without power-of-four rounding");
  assert.equal(core.budgetSubdivision(7, 6, false), 4);
});

function effectorHarness() {
  class Properties {
    constructor(owner) { this.owner = owner; }
    addAll(definitions) {
      for (const [name, definition] of Object.entries(definitions)) {
        if (this[name]) continue;
        const property = { ...definition, parentObject: this.owner, value: definition.value,
          get() { return this.value; }, set(value) { this.value = value; definition.changed?.call(this); },
          toJSON() { return this.value; } };
        this[name] = property;
      }
    }
    load(data = {}) {
      for (const [key, value] of Object.entries(data)) this[key]?.set(value?.keyframes?.[0]?.value ?? value?.value ?? value);
    }
    toJSON() { return Object.fromEntries(Object.entries(this).filter(([key]) => key !== "owner")); }
  }
  class List extends Array { constructor() { super(); this.onListChanged = { watch() {}, unwatch() {} }; } }
  class Group {
    constructor() {
      this.children = []; this.properties = new Properties(this); this.objects = new List();
      this.properties.addAll({ name: { value: "Effector" } });
    }
    parentChanged() {}
  }
  const PZ = { object3d: { group: Group, getName: () => "Effector" }, objectList: List,
    property: { type: { NUMBER: 0, VECTOR3: 1, OPTION: 2 } } };
  return { PZ, THREE: { Object3D: class {} } };
}

test("Twist and Warp serialize current for additions and preserve legacy counts through load, duplicate and history", () => {
  const { PZ, THREE } = effectorHarness();
  const previous = state.library; state.library = { core };
  try {
    for (const factory of [createTwistClass, createWarpClass]) {
      const Type = factory(PZ, THREE), fresh = new Type();
      fresh.load({});
      assert.equal(plain(fresh).zoidiumSubdivisionMode, "current");
      for (const [explicit, mode, count] of [[{}, "legacy", 7], [{ zoidiumSubdivisionMode: "current" }, "current", 4]]) {
        const data = loadedObject({ type: fresh.type, ...explicit, properties: { curveQuality: 1, polygonCount: 7, angle: 1, amount: 1 } });
        const object = new Type(); object.load(data);
        assert.equal(object.zoidiumSubdivisionMode, mode);
        assert.equal(curvePolygonCount([object], 0), count);
        const duplicate = new Type(); duplicate.load(plain(object));
        assert.equal(plain(duplicate).zoidiumSubdivisionMode, mode);
        assert.equal(curvePolygonCount([duplicate], 0), count);
        const snapshot = plain(object);
        object.load(plain(fresh));
        assert.equal(object.zoidiumSubdivisionMode, "current");
        object.load(snapshot);
        assert.equal(curvePolygonCount([object], 0), count);
        object.properties.subdivision.set(3);
        assert.equal(object.zoidiumSubdivisionMode, mode, "edits cannot mutate compatibility outside history");
        assert.equal(curvePolygonCount([object], 0), 64);
        const editedCopy = new Type(); editedCopy.load(plain(object));
        assert.equal(curvePolygonCount([editedCopy], 0), 64);
        object.properties.subdivision.set(snapshot.properties.subdivision);
        assert.equal(curvePolygonCount([object], 0), count, "undoing the selector restores the exact authored count");
      }
    }
  } finally { state.library = previous; }
});
