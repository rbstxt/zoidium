"use strict";
const test = require("node:test");
const { buildEnv } = require("./optical-flares-fixture.js");
const { resourceCounter } = require("./helpers/resource-counter.js");

test("Optical Flares releases its render resources on unload", () => {
  const counter = resourceCounter();
  const { PZ } = buildEnv(counter);
  const flare = new PZ.object3d.optflares();
  flare.load({ objectType: 0 });
  flare.update(0);
  const matrix = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  flare.quad.onBeforeRender({}, null, { matrixWorldInverse: matrix, projectionMatrix: matrix });
  flare.unload();
  flare.unload();
  counter.assertDisposed();
});
