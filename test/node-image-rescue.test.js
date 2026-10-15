"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { createHarness, addProjectEntries } = require("./project-files.test.js");
const source = fs.readFileSync(path.join(__dirname, "../tools/recovery/node-image-rescue.js"), "utf8");
const missing = "ab116c5d984be6edf981692f9271b981";
const material = graph => ({ type: "nodes", properties: {
  nodeImage: missing, graph: JSON.stringify(graph || { nodes: [], edges: [] }),
} });

async function setup(document, assetList = {}) {
  const h = createHarness();
  const io = h.PZ.zoidiumProjectArchive;
  const editor = h.makeEditor();
  editor.project.data = document;
  editor.project.assets.list = assetList;
  h.PZ.project.save = archive => addProjectEntries(archive, document);
  // Reproduce the pre-b456c56 rejection while retaining the production asset
  // validator and gzip/TAR decoder. This must reject the original snapshot.
  const currentValidate = h.projectFiles.validateProjectArchive;
  async function legacyValidate(archive, mode) {
    const entry = archive.peekFile("project");
    const data = JSON.parse(new TextDecoder().decode(await io.bytes(entry.data)));
    const dangling = io.danglingAssetReferences(data, message => { throw new Error(message); });
    if (dangling.length) throw new Error("Asset reference " + dangling[0] + " has no asset metadata.");
    return currentValidate(archive, mode);
  }
  h.projectFiles.validateProjectArchive = legacyValidate;
  h.projectFiles.openValidatedArchive = async (blob, mode) => {
    const archive = await io.decode(blob, h.PZ.archive);
    await legacyValidate(archive, mode);
    return archive;
  };
  const errors = [];
  const global = {
    PZ: h.PZ, CM: editor, URL: { createObjectURL: () => "blob:rescue", revokeObjectURL() {} },
    document: { body: { appendChild() {} }, createElement: () => ({ style: {}, click() {}, remove() {} }) },
    setTimeout: callback => { callback(); }, console: { log() {}, error(...args) { errors.push(args); } },
  };
  async function run() { return vm.runInNewContext(source, { window: global, Blob }); }
  async function read(blob) {
    const archive = await io.decode(blob, h.PZ.archive);
    return { archive, document: JSON.parse(new TextDecoder().decode(await io.bytes(archive.peekFile("project").data))) };
  }
  return { h, io, run, read, global, errors };
}

test("rescue preserves raw state and attached bytes while repairing all stale mirrors in a separate validated copy", async () => {
  const document = { assets: {}, media: [], sequence: { objects: [material(), { objects: [material()] }] } };
  const assetList = {};
  const h = await setup(document, assetList);
  const image = new Blob(["retained image bytes"]);
  const key = await h.io.hash(image);
  document.assets[key] = { sha256: key, filename: "keep.png", size: image.size, source: 1 };
  assetList[key] = { sha256: key, file: image };
  document.media.push({ thumbnail: {}, material: material() });
  const before = JSON.stringify(document);
  const state = await h.run();
  assert.equal(state.ready, true);
  assert.equal(state.repairs.length, 3);
  assert.equal(JSON.stringify(document), before, "live properties and thumbnails remain untouched");
  const raw = await h.read(state.originalBlob);
  assert.equal(JSON.stringify(raw.document), before);
  await assert.rejects(h.h.projectFiles.openValidatedArchive(state.originalBlob, "save"), /has no asset metadata/);
  const clean = await h.read(state.compatibleBlob);
  assert.equal(clean.document.sequence.objects[0].properties.nodeImage, null);
  assert.equal(clean.document.media[0].material.properties.nodeImage, null);
  assert.equal("thumbnail" in clean.document.media[0], false);
  assert.equal(await new Blob([clean.archive.peekFile(key).data]).text(), await image.text());
  await h.h.projectFiles.openValidatedArchive(state.compatibleBlob, "save");
  await state.download("compatible");
  await assert.rejects(h.run(), /already exists/);
});

test("a missing real graph image retains its reference and the raw snapshot", async () => {
  const document = { assets: {}, media: [], sequence: { material: material({ nodes: [{ params: { asset: missing } }] }) } };
  const h = await setup(document);
  const state = await h.run();
  assert.ok(state.originalBlob.size > 0);
  assert.equal(state.compatibleBlob, null);
  assert.equal(state.repairs.length, 0);
  assert.ok(state.graphWarnings.length > 0);
  assert.equal((await h.read(state.originalBlob)).document.sequence.material.properties.nodeImage, missing);
  await state.download("original");
  await state.download("json");
  await assert.rejects(state.download("compatible"), /No validated compatible file/);
});

test("malformed graph JSON cannot authorize a repair", async () => {
  const broken = material();
  broken.properties.graph = "{broken";
  const h = await setup({ assets: {}, media: [], sequence: { material: broken } });
  const state = await h.run();
  assert.ok(state.originalBlob.size > 0);
  assert.equal(state.compatibleBlob, null);
  assert.equal(state.repairs.length, 0);
});

test("listed assets with missing or corrupt bytes still block a compatible rescue", async () => {
  for (const bytes of [null, "wrong"]) {
    const key = "a".repeat(64);
    const h = await setup({
      assets: { [key]: { sha256: key, filename: "broken.png", source: 1 } },
      media: [], sequence: { material: material() },
    }, { [key]: { sha256: key, file: bytes && new Blob([bytes]) } });
    const state = await h.run();
    assert.ok(state.originalBlob.size > 0);
    assert.equal(state.compatibleBlob, null);
    assert.match(state.assetError, /broken.png/);
  }
});

test("unrelated missing asset references remain errors after mirror repair", async () => {
  const h = await setup({ assets: {}, media: [], sequence: { material: material(), font: "b".repeat(32) } });
  const state = await h.run();
  assert.equal(state.compatibleBlob, null);
  assert.match(state.error, /has no asset metadata/);
  assert.ok(state.originalBlob.size > 0);
});

test("valid metadata and graph references are preserved, and unreadable files retain emergency JSON", async () => {
  const image = new Blob(["existing image"]);
  const h = await setup({ assets: {}, media: [], sequence: {} });
  const key = await h.io.hash(image);
  const document = h.global.CM.project.data;
  document.assets[key] = { sha256: key, source: 1, filename: "existing.png", size: image.size };
  document.sequence.material = { type: "nodes", properties: {
    nodeImage: key, graph: JSON.stringify({ nodes: [{ params: { asset: key } }] }),
  } };
  h.global.CM.project.assets.list[key] = { sha256: key, file: image };
  let state = await h.run();
  assert.equal(state.ready, true);
  assert.equal(state.repairs.length, 0);
  assert.equal((await h.read(state.compatibleBlob)).document.sequence.material.properties.nodeImage, key);

  const bad = await setup({ assets: {}, media: [], sequence: {} }, {
    unreadable: { key: "unreadable", file: { size: 5, arrayBuffer() { throw new Error("NotReadableError"); } } },
  });
  state = await bad.run();
  assert.match(state.error, /NotReadableError/);
  assert.ok(state.projectBlob.size > 0);
  assert.equal(state.compatibleBlob, null);
});
