"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const assert = require("node:assert/strict");
const NodeMaterial = require("../plugins/material-plus/node-material");
const Pbr = require("../plugins/material-plus/pbr-plus");
const { harness } = require("./material-node-harness.js");

for (const type of ["nodes", "pbrplus"]) {
  test(`${type} retains normal maps while switching graph bump, noise and disconnected output`, async () => {
    const h = harness();
    NodeMaterial.activate(h.context);
    Pbr.activate(h.context);
    let material;
    try {
      material = h.material(type);
      (await h.PZ.material.fnList[type]).call(material);
      material.load();
      material.properties.bakeResolution.set(0);
      material.properties.useNodeGraph.set(1);
      material.properties.graph.set(JSON.stringify(h.context.window.ZoidiumMaterialPlus.nodes.defaultGraph()));
      material.properties.normalMap.set("normal-image");
      material.properties.normalScale.set(0.7);
      material.properties.bumpStrength.set(0.3);
      material.update(0);
      await material.prepare(0);
      const normalMap = material.threeObj.normalMap;
      const graphBump = material.threeObj.bumpMap;
      assert.ok(normalMap, "the normal image is bound alongside the graph bump");
      assert.ok(graphBump, "the starter graph supplies bump detail");
      assert.deepEqual(material.threeObj.normalScale.values, [0.7, 0.7]);
      assert.equal(material.threeObj.bumpScale, 0.3);

      material.properties.bumpNoise.set(1);
      await material.prepare(0);
      assert.equal(material.threeObj.normalMap, normalMap);
      assert.equal(material.threeObj.bumpMap, material.pzNoiseTexture);
      assert.notEqual(material.threeObj.bumpMap, graphBump);

      material.properties.bumpNoise.set(0);
      await material.prepare(0);
      assert.equal(material.threeObj.bumpMap, graphBump);
      assert.equal(material.threeObj.normalMap, normalMap);

      const graph = JSON.parse(material.properties.graph.get());
      graph.links = graph.links.filter(link => link.toPort !== "bump");
      material.properties.graph.set(JSON.stringify(graph));
      await material.prepare(0);
      assert.equal(material.threeObj.bumpMap, null);
      assert.equal(material.threeObj.normalMap, normalMap);

      material.properties.bumpNoise.set(1);
      material.properties.normalMap.set(null);
      await material.prepare(0);
      assert.equal(material.threeObj.normalMap, null);
      assert.equal(material.threeObj.bumpMap, material.pzNoiseTexture);
    } finally {
      material?.unload();
      for (const dispose of h.dispose.reverse()) dispose();
    }
  });
}
