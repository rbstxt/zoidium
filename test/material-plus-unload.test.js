"use strict";
require("./migrate-test-apis.js").ensureMainRealmApis();
const test = require("node:test");
const { harness } = require("./material-node-harness.js");
const { resourceCounter } = require("./helpers/resource-counter.js");
const NodeMaterial = require("../plugins/material-plus/node-material.js");
const Pbr = require("../plugins/material-plus/pbr-plus.js");
const ImagePlus = require("../plugins/material-plus/image-plus.js");

for (const type of ["nodes", "pbrplus", "imageplus"]) {
  test(`${type} releases default material resources`, async () => {
    const h = harness(), counter = resourceCounter(), THREE = h.context.window.THREE;
    for (const name of ["MeshPhysicalMaterial", "MeshStandardMaterial", "MeshBasicMaterial", "CanvasTexture", "DataTexture"]) {
      THREE[name] = counter.track(THREE[name], name);
    }
    NodeMaterial.activate(h.context); Pbr.activate(h.context); ImagePlus.activate(h.context);
    try {
      const material = h.material(type);
      (await h.PZ.material.fnList[type]).call(material);
      material.load();
      await material.prepare?.(0);
      material.update(0);
      material.unload();
      counter.assertDisposed();
    } finally { for (const dispose of h.dispose.reverse()) dispose(); }
  });
}

for (const [type, moduleName] of [["matcap", "material-plus"], ["uvcustom", "uv-custom"]]) {
  test(`${type} releases its default material`, async () => {
    const h = harness(), counter = resourceCounter(), THREE = h.context.window.THREE;
    THREE.ShaderMaterial = counter.track(class { constructor(options) { Object.assign(this, options); } }, "ShaderMaterial");
    THREE.MeshStandardMaterial = counter.track(THREE.MeshStandardMaterial, "MeshStandardMaterial");
    const plugin = require(`../plugins/material-plus/${moduleName}.js`);
    plugin.activate(h.context);
    try {
      const material = h.material(type);
      (await h.PZ.material.fnList[type]).call(material);
      material.load();
      await material.prepare?.(0);
      material.update(0);
      material.unload();
      counter.assertDisposed();
    } finally { for (const dispose of h.dispose.reverse()) dispose(); plugin.deactivate(); }
  });
}
