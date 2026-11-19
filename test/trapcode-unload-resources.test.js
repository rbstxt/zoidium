"use strict";
const test = require("node:test");
const { loadSuite } = require("./trapcode-env.js");
const { resourceCounter } = require("./helpers/resource-counter.js");

test("Form releases its default resources after update", () => {
  const counter = resourceCounter();
  const { PZ } = loadSuite(["trapcode-common.js", "form.js"], counter);
  const form = new PZ.object3d.form();
  form.load(null);
  form.update(0);
  form.unload();
  counter.assertDisposed();
});

test("Particular releases its default system resources", () => {
  const counter = resourceCounter();
  const { PZ, THREE } = loadSuite(["trapcode-common.js", "particular.js"], counter);
  THREE.Material = class { dispose() {} };
  const particular = new PZ.object3d.particular();
  particular.load({ spinMode: 0 });
  particular.systems[0].sceneRate = () => 30;
  particular.update(0);
  particular.unload();
  counter.assertDisposed();
});
