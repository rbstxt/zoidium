"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const materials = require("../plugins/text-plus/text-plus-materials.js");
const geometry = require("../plugins/text-plus/text-plus-geometry.js");
const { withFakeThree, makeTextObject, characterMeshes } = require("./text-scale-harness.js");
const uvSource = fs.readFileSync(require.resolve("../plugins/material-plus/uv-layout.js"), "utf8");
const layout = new Function(uvSource)()();
materials.configure({ getAsset: () => uvSource });

function parent(selection, front = {}, side = {}) {
  return { zoidiumTextPlusObject: true, zoidiumTextPlusMode: "character-material",
    characterProperties: { characterNumbers: { get: () => selection } },
    frontMaterials: front ? [{ threeObj: front }] : [], sideMaterials: side ? [{ threeObj: side }] : [] };
}

test("material selection shares one-based parsing, while an empty field selects all", () => {
  for (const selection of ["1,3,4", "1.3.4.", "1 3 4", "1，3．4", "4,1,3,3,0,99,invalid"]) {
    const p = parent(selection);
    assert.deepEqual([0, 1, 2, 3].map(i => !!materials.resolve([p], 7, i, 4)), [true, false, true, true]);
  }
  for (const selection of ["", "   "]) {
    const p = parent(selection);
    assert.equal(materials.resolve([p], 0, 3, 4), p);
  }
  assert.equal(materials.resolve([parent("invalid")], 0, 0, 4), null);
});

test("the innermost selecting parent owns both slots and empty slots use the source", () => {
  const source = {}, outer = parent(""), inner = parent("2", null, {});
  const entries = [0, 1, 2].map(() => ({ mesh: { material: source } }));
  for (let i = 0; i < entries.length; i++) materials.apply(entries[i], source, materials.resolve([outer, inner], 0, i, 3));
  assert.equal(entries[0].mesh.material[0], outer.frontMaterials[0].threeObj);
  assert.equal(entries[1].mesh.material[0], source);
  assert.equal(entries[1].mesh.material[1], inner.sideMaterials[0].threeObj);
  assert.equal(entries[2].mesh.material[1], outer.sideMaterials[0].threeObj);
  const pair = entries[1].mesh.material;
  materials.apply(entries[1], source, inner);
  assert.equal(entries[1].mesh.material, pair);
});

test("per-frame mesh synchronization applies selection after source copying and respects Text index offsets", () => {
  withFakeThree(THREE => {
    const p = parent("2,4"), text = makeTextObject(THREE, { text: "AAAA" });
    text.parentObject = p;
    const source = text.threeObj.material;
    try {
      geometry.syncTextRendering(text, 0);
      const meshes = characterMeshes(text), pairs = meshes.map(mesh => mesh.material);
      assert.deepEqual(meshes.map(mesh => Array.isArray(mesh.material)), [false, true, false, true]);
      geometry.syncTextRendering(text, 44);
      assert.ok(meshes.every((mesh, i) => mesh.material === pairs[i]));
      text.properties.characterIndexOffset = { get: () => 1 };
      text.properties.characterCountOverride = { get: () => 5 };
      geometry.syncTextRendering(text, 3);
      assert.deepEqual(meshes.map(mesh => Array.isArray(mesh.material)), [true, false, true, false]);
      text.parentObject = null;
      geometry.syncTextRendering(text, 0);
      assert.equal(text.threeObj.material, source);
      assert.equal(text.threeObj.children.length, 0);
    } finally { geometry.restoreTextRendering(text); }
  });
});

function square() {
  const v = (x, y, z) => ({ x, y, z });
  const uv = () => ({ x: 10, y: 20, set(x, y) { this.x = x; this.y = y; } });
  const faces = [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 1, 4], [1, 5, 4],
    [1, 2, 5], [2, 6, 5], [2, 3, 6], [3, 7, 6], [3, 0, 7], [0, 4, 7]];
  return { type: "ExtrudeGeometry", vertices: [v(0, 0, 0), v(10, 0, 0), v(10, 10, 0), v(0, 10, 0),
    v(0, 0, 4), v(10, 0, 4), v(10, 10, 4), v(0, 10, 4)],
    faces: faces.map(([a, b, c], i) => ({ a, b, c, materialIndex: i < 4 ? 0 : 1 })),
    faceVertexUvs: [faces.map(() => [uv(), uv(), uv()])], uvsNeedUpdate: false };
}

test("mixed face materials keep native UVs on native faces and restore them after deselection", () => {
  const source = {}, front = {}, side = { __zoidiumUvLayout: true };
  const mesh = { geometry: square(), material: source }, entry = { mesh };
  const before = JSON.stringify(mesh.geometry.faceVertexUvs);
  materials.apply(entry, source, parent("", front, side));
  assert.deepEqual(mesh.geometry.faceVertexUvs[0][0].map(p => [p.x, p.y]), [[10, 20], [10, 20], [10, 20]]);
  assert.notEqual(JSON.stringify(mesh.geometry.faceVertexUvs), before);
  const revision = mesh.geometry.__zoidiumUvRevision;
  materials.apply(entry, source, parent("", front, side));
  assert.equal(mesh.geometry.__zoidiumUvRevision, revision);
  mesh.material = source;
  materials.apply(entry, source, null);
  assert.equal(JSON.stringify(mesh.geometry.faceVertexUvs), before);
  mesh.material = { __zoidiumUvLayout: true };
  mesh.__zoidiumSyncMaterialUvs();
  assert.notDeepEqual(mesh.geometry.faceVertexUvs[0][4].map(p => [p.x, p.y]), [[10, 20], [10, 20], [10, 20]]);
});

test("slot UV traversal leaves unselected Text and other descendants unchanged", () => {
  const unselected = { geometry: square(), material: {} }, selected = { geometry: square(), material: {} };
  const owner = parent("1"), material = { parentObject: owner, threeObj: {} };
  const before = JSON.stringify(unselected.geometry.faceVertexUvs);
  owner.threeObj = { traverse(fn) { fn(unselected); fn(selected); } };
  materials.apply({ mesh: selected }, {}, parent("", {}, material.threeObj));
  layout.ensureMaterial(material);
  assert.equal(JSON.stringify(unselected.geometry.faceVertexUvs), before);
  assert.notEqual(JSON.stringify(selected.geometry.faceVertexUvs), before);
  selected.material[0] = { __zoidiumUvLayout: true };
  layout.releaseMaterial(material);
  assert.equal(selected.geometry.__zoidiumUvFaceMask, 1);
  assert.equal(JSON.stringify(unselected.geometry.faceVertexUvs), before);
});
