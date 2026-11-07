"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fixture } = require("./helpers/expresstext-host.cjs");
const { boxEdges, installFieldGuides } = require("../plugins/expresstext-plus/expresstext-field-guides.js");

test("selected fields stay in helper layer and follow each text's undeformed transform", () => {
  const h = fixture();
  let dispose;
  try {
    const plain = h.section("Plain", { plainField: 2, plainFieldPosition: [7, 2, 0], plainFieldScale: [10, 20, 30] });
    h.section("Shake", { shakeField: 3 });
    h.section("Random", { randomField: 0 });
    const text = h.text();text.properties.position.set([4, 3, 2], 0);
    h.container.update(0);h.project.threeObj.updateMatrixWorld(true);
    const saved = JSON.stringify(h.container), children = text.threeObj.children.slice();
    const Original = h.THREE.BoxHelper;
    const editor = { mainViewport: {}, playback: { currentFrame: 0 } };
    dispose = installFieldGuides(h.PZ, h.THREE, editor);
    const helper = new h.THREE.BoxHelper(h.container.threeObj);
    const helpers = new h.THREE.Object3D(); helpers.add(helper);
    assert.equal(helper.__expressFieldGuides.length, 2);
    const guide = helper.__expressFieldGuides[0];
    assert.equal(guide.layers.mask, 2);
    assert.equal(new h.THREE.Camera().layers.test(guide.layers), false);
    const center = new h.THREE.Vector3().setFromMatrixPosition(guide.matrixWorld);
    const expected = new h.THREE.Vector3(7, 2, 0).applyMatrix4(text.threeObj.matrixWorld);
    assert.deepEqual(Array.from(center.toArray()), Array.from(expected.toArray()));
    plain.objects.find(row => row.definition.effectorKey === "plainFieldPosition").set([11, 0, 0], 0);
    helper.update();
    assert.equal(helper.__expressFieldGuides[0], guide);
    plain.objects.find(row => row.definition.effectorKey === "plainFieldPosition").set([7, 2, 0], 0);
    helper.update();
    assert.equal(JSON.stringify(h.container), saved);
    assert.deepEqual(text.threeObj.children, children);
    assert.equal(h.container.threeObj.children.includes(helper), false);
    const ordinary = new h.THREE.BoxHelper(new h.THREE.Mesh(new h.THREE.BoxGeometry()));
    assert.equal(ordinary.__expressFieldGuides, undefined);
    dispose();dispose = null;
    assert.equal(h.THREE.BoxHelper, Original);
    assert.equal(helper.__expressFieldGuides.length, 0);
  } finally { dispose?.();h.close(); }
});

test("field box covers exactly the scale bounds", () => {
  const edges = boxEdges();
  assert.equal(edges.length, 72);
  assert.deepEqual([...new Set(edges)].sort(), [-0.5, 0.5]);
});
