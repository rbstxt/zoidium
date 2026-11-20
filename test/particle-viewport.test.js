"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { loadSuite } = require("./trapcode-env");

function check(points) {
  const value = points.material.uniforms.resolution.value;
  const renderer = { getSize: () => ({ width: 900, height: 700 }),
    getDrawingBufferSize: () => ({ width: 1800, height: 1400 }),
    getRenderTarget: () => ({ width: 500, height: 300, viewport: { z: 400, w: 200 } }) };
  points.onBeforeRender(renderer);
  assert.deepEqual([value.x, value.y], [400, 200]);
  renderer.getRenderTarget = () => ({ width: 500, height: 300 });
  points.onBeforeRender(renderer);
  assert.deepEqual([value.x, value.y], [500, 300]);
  renderer.getRenderTarget = () => null;
  points.onBeforeRender(renderer);
  assert.deepEqual([value.x, value.y], [1800, 1400]);
}

test("native particles use the active render viewport", () => {
  function Particle() {}
  Particle.prototype.load = function () {
    const value = { set(x, y) { this.x = x; this.y = y; } };
    this.threeObj = { material: { uniforms: { resolution: { value } } }, onBeforeRender(renderer) { const size = renderer.getSize(); value.set(size.width, size.height); } };
  };
  const context = { PZ: { object3d: { particles: Particle } } };
  context.window = context;
  vm.runInNewContext(fs.readFileSync("plugins/core/particle-viewport.js", "utf8"), context);
  const particle = new Particle();
  particle.load();
  check(particle.threeObj);
});

test("Trapcode points use the active render viewport", () => {
  const { PZ, THREE } = loadSuite(["trapcode-common.js", "form.js", "particular.js", "plexus.js"]);
  const form = new PZ.object3d.form(); form.load(null);
  THREE.Material = class {};
  const system = new PZ.object3d.particular.system();
  system.threeObj.material = { uniforms: { resolution: { value: new THREE.Vector2() } } };
  const plexus = new PZ.object3d.plexus(); plexus.load(null);
  check(form.forms[0].points);
  check(system.threeObj);
  check(plexus.pointCloud);
});
