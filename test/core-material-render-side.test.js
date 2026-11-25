"use strict";

// Native material Render side: the Video and Single Color materials get a
// front/back/both row with today's side as the default. The row writes
// three.js side, survives save/load, and leaves the Image and Custom Material
// rows alone.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { nativeHost, cache } = require("./expressions-plus-harness");

const projectRoot = path.resolve(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(projectRoot, "plugins/core/material-render-side.js"), "utf8");
const NATIVE_TYPES = ["video", "texture", "singlecolor", "custom"];

function materialHost() {
  const host = nativeHost();
  host.context.window = host.context;
  vm.runInContext(SOURCE, host.context);
  for (const type of NATIVE_TYPES) {
    const source = fs.readFileSync(path.join(cache, "material", type + ".js"), "utf8");
    host.PZ.material.fnList[type] = Promise.resolve(vm.runInContext("(function(){\n" + source + "\n})", host.context));
  }
  return host;
}

async function loadMaterial(PZ, type, data) {
  if (!PZ.project) PZ.project = class Project extends PZ.object {};
  if (!PZ.layer) PZ.layer = class Layer extends PZ.object {};
  PZ.schedule = { analyzeSequence() {} };
  const project = new PZ.project();
  project.sequence = {};
  const layer = new PZ.layer();
  layer.parent = project;
  layer.videoMaterials = [];
  const owner = new PZ.object();
  owner.parent = layer;
  owner.threeObj = { material: null };
  const material = PZ.material.create(type);
  material.parent = owner;
  await material.load(data || { type });
  return material;
}

test("Video defaults to front and Single Color keeps its double-sided look", async () => {
  const { PZ } = materialHost();
  const video = await loadMaterial(PZ, "video");
  assert.equal(video.properties.side.get(), 0, "a video renders front faces today");
  assert.equal(video.threeObj.side, 0);
  assert.equal(video.properties.side.definition.name, "Render side");
  assert.equal(video.properties.side.definition.items, "front;back;both");

  const single = await loadMaterial(PZ, "singlecolor");
  assert.equal(single.properties.side.get(), 2, "a single color renders both faces today");
  assert.equal(single.threeObj.side, 2);
  assert.equal(single.properties.side.definition.name, "Render side");
  assert.equal(single.properties.side.definition.items, "front;back;both");
});

test("Image and Custom Material keep their existing Render side definition", async () => {
  const { PZ } = materialHost();
  for (const type of ["texture", "custom"]) {
    const material = await loadMaterial(PZ, type);
    assert.equal(material.properties.side.get(), 0, type);
    assert.equal(material.threeObj.side, 0, type);
    assert.equal(material.properties.side.definition.name, "Render side", type);
    assert.equal(material.properties.side.definition.items, "front;back;both", type);
    material.properties.side.set(2);
    assert.equal(material.threeObj.side, 2, type);
  }
});

test("changing Render side updates three.js side and recompiles the material", async () => {
  const { PZ } = materialHost();
  const video = await loadMaterial(PZ, "video");
  video.threeObj.needsUpdate = false;
  video.properties.side.set(1);
  assert.equal(video.threeObj.side, 1);
  assert.equal(video.threeObj.needsUpdate, true, "the material is marked for update");
  video.properties.side.set(2);
  assert.equal(video.threeObj.side, 2);
  video.properties.side.set(0);
  assert.equal(video.threeObj.side, 0);
});

test("a saved Render side survives a save and load round trip", async () => {
  const { PZ } = materialHost();
  const video = await loadMaterial(PZ, "video");
  video.properties.side.set(1);
  const saved = JSON.parse(JSON.stringify(video.toJSON()));
  assert.equal(saved.type, "video");
  assert.equal(saved.properties.side, 1, "the static value serializes as a scalar");

  const copy = await loadMaterial(PZ, "video", saved);
  assert.equal(copy.properties.side.get(), 1);
  assert.equal(copy.threeObj.side, 1, "a saved back-side video reloads back-side");

  const single = await loadMaterial(PZ, "singlecolor");
  single.properties.side.set(0);
  const singleCopy = await loadMaterial(PZ, "singlecolor", JSON.parse(JSON.stringify(single.toJSON())));
  assert.equal(singleCopy.properties.side.get(), 0);
  assert.equal(singleCopy.threeObj.side, 0);
});

test("project data without a saved Render side keeps today's side", async () => {
  const { PZ } = materialHost();
  const video = await loadMaterial(PZ, "video", { type: "video", properties: {} });
  assert.equal(video.properties.side.get(), 0);
  assert.equal(video.threeObj.side, 0);
  const single = await loadMaterial(PZ, "singlecolor", { type: "singlecolor", properties: {} });
  assert.equal(single.properties.side.get(), 2);
  assert.equal(single.threeObj.side, 2);
});
