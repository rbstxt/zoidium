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

test("abandoned prepared materials release idle graph workers and Blob URLs", async () => {
  const h = harness(), workers = new Set(), urls = new Set();
  let serial = 0;
  h.context.window.Blob = class {};
  h.context.window.URL = {
    createObjectURL() { const url = "blob:worker-" + serial++; urls.add(url); return url; },
    revokeObjectURL(url) { urls.delete(url); },
  };
  h.context.window.Worker = class {
    constructor() { workers.add(this); }
    postMessage(job) { setImmediate(() => this.onmessage?.({ data: { id: job.id, outputs: {} } })); }
    terminate() { workers.delete(this); }
  };
  NodeMaterial.activate(h.context);
  try {
    async function prepare() {
      const material = h.material("nodes");
      (await h.PZ.material.fnList.nodes).call(material); material.load();
      material.properties.bakeResolution.set(0);
      await material.prepare(0);
      return new WeakRef(material);
    }
    const references = [], counts = [];
    for (const n of [5, 10, 20]) {
      while (references.length < n) references.push(await prepare());
      await new Promise(resolve => setImmediate(resolve));
      queryObjects(class CollectionTrigger {});
      counts.push(references.filter(ref => ref.deref()).length);
    }
    assert.deepEqual(counts, [0, 0, 0]);
    // Collection and FinalizationRegistry cleanup run in separate jobs.
    const deadline = Date.now() + 5000;
    while (workers.size && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
      queryObjects(class CollectionTrigger {});
    }
    assert.equal(workers.size, 0);
    assert.equal(urls.size, 0);
  } finally { for (const dispose of h.dispose.reverse()) dispose(); }
});
