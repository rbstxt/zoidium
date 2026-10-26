"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

const cube = "LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n";

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness() {
  const Looks = {}, calls = [];
  for (const file of ["looks-cube", "looks-lut-assets"]) {
    vm.runInNewContext(fs.readFileSync(require.resolve(`../plugins/magic-looks/${file}.js`), "utf8"), { Looks });
  }
  const asset = { key: "imported-lut" };
  const assets = {
    async createFromFile(type, file) { calls.push(["create", type, file]); return asset; },
    load(key) { calls.push(["load", key]); return asset; },
    removeIfUnused(value) { calls.push(["remove", value]); },
    unload(value) { calls.push(["unload", value]); },
  };
  let attached = true, project = { assets };
  const effect = {
    get parentProject() {
      if (!attached) throw new TypeError("Cannot read properties of null (reading 'parentObject')");
      return project;
    },
    properties: { lutData: { get: () => null } },
  };
  const manager = Looks.lutAssets.create(effect, { asset: { type: { MISC: 9 } } }, {}, null);
  const file = { size: cube.length, text: async () => cube };
  return { manager, assets, asset, file, calls, detach() { attached = false; }, setProject(value) { project = value; } };
}

test("LUT import after disposal and detachment releases the asset through its owning project", async () => {
  const h = harness(), gate = deferred(), started = deferred();
  h.assets.createFromFile = () => { started.resolve(); return gate.promise; };
  const importing = h.manager.importFile(h.file);
  await started.promise;
  h.manager.dispose();
  h.detach();
  gate.resolve(h.asset);
  await assert.rejects(importing, { message: "The effect has been unloaded." });
  assert.deepEqual(h.calls, [["remove", h.asset]]);
});

test("obsolete LUT import cleanup uses the original project after a project change", async () => {
  const h = harness(), gate = deferred(), started = deferred();
  h.assets.createFromFile = () => { started.resolve(); return gate.promise; };
  const importing = h.manager.importFile(h.file);
  await started.promise;
  h.manager.dispose();
  h.setProject({ assets: { removeIfUnused() { assert.fail("cleanup used the replacement project"); } } });
  gate.resolve(h.asset);
  await assert.rejects(importing, { message: "The effect has been unloaded." });
  assert.deepEqual(h.calls, [["remove", h.asset]]);
});

test("disposal while LUT text is pending prevents asset creation", async () => {
  const h = harness(), gate = deferred();
  const importing = h.manager.importFile({ size: cube.length, text: () => gate.promise });
  h.manager.dispose();
  h.detach();
  gate.resolve(cube);
  await assert.rejects(importing, { message: "The effect has been unloaded." });
  assert.deepEqual(h.calls, []);
  await assert.rejects(h.manager.importFile(h.file), { message: "The effect has been unloaded." });
});

test("attached LUT import returns the key and retains the parsed asset until disposal", async () => {
  const h = harness();
  assert.equal(await h.manager.importFile(h.file), h.asset.key);
  assert.deepEqual(h.calls, [["create", 9, h.file], ["load", h.asset.key]]);
  h.manager.dispose();
  assert.deepEqual(h.calls.at(-1), ["unload", h.asset]);
});
