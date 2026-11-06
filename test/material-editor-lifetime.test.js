"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { queryObjects } = require("node:v8");
const NodeMaterial = require("../plugins/material-plus/node-material");
const { harness } = require("./material-node-harness.js");

test("the material registry does not own abandoned project materials", async () => {
  const h = harness(); NodeMaterial.activate(h.context);
  try {
    async function create() {
      const material = h.material("nodes");
      (await h.PZ.material.fnList.nodes).call(material);
      material.load();
      await material.prepare(0);
      return new WeakRef(material);
    }
    const references = [], counts = [];
    for (const n of [5, 10, 20]) {
      while (references.length < n) references.push(await create());
      await new Promise(resolve => setImmediate(resolve));
      queryObjects(class CollectionTrigger {});
      counts.push(references.filter(reference => reference.deref()).length);
    }
    assert.deepEqual(counts, [0, 0, 0]);
  } finally { for (const dispose of h.dispose.reverse()) dispose(); }
});

test("the Node Editor becomes invalid when its project is replaced", async () => {
  const h = harness(); NodeMaterial.activate(h.context);
  try {
    const material = h.material("nodes");
    (await h.PZ.material.fnList.nodes).call(material); material.load();
    h.context.window.CM = { project: material.parentProject };
    h.context.ui.openWindow = options => options;
    const window = h.editors[0].open(material);
    assert.equal(window.isValid(), true);
    h.context.window.CM.project = {};
    assert.equal(window.isValid(), false);
  } finally { for (const dispose of h.dispose.reverse()) dispose(); }
});

