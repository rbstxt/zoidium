"use strict";
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { nativeHost } = require("../expressions-plus-harness.js");
const { resourceCounter } = require("./resource-counter.js");
const root = path.join(__dirname, "../..");

async function checkPack(name) {
  const { PZ, THREE, context } = nativeHost();
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(root, "plugins/core/layer-unload-dispose.js"), "utf8"), context);
  const counter = resourceCounter();
  THREE.RawShaderMaterial = counter.track(THREE.RawShaderMaterial, "host shader material");
  THREE.PlaneBufferGeometry = counter.track(THREE.PlaneBufferGeometry, "host shader geometry");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "plugins", name, "manifest.json")));
  for (const item of manifest.effects) {
    const presetPath = path.join(root, item.preset.split("?")[0]);
    const preset = JSON.parse(fs.readFileSync(presetPath, "utf8"));
    const effect = new PZ.effect.shader();
    await effect.load(preset);
    const pass = effect.pass;
    pass.render({ render() {} }, null, null, false);
    effect.unload();

  }
  counter.assertDisposed();
}
module.exports = { checkPack };
