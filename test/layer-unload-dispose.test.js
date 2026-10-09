"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.join(__dirname, "..", "plugins", "core", "layer-unload-dispose.js"),
  "utf8"
);

function install() {
  const events = [];
  class Layer {
    constructor() {
      this.composite = {
        quad: {
          geometry: { dispose: () => events.push("geometry") },
          material: { dispose: () => events.push("material") },
        },
      };
    }
    unload() {
      events.push("unload");
      return "done";
    }
  }
  class Particles {
    constructor() {
      this.threeObj = {
        geometry: { dispose: () => events.push("points-geometry") },
        material: { dispose: () => events.push("points-material") },
      };
    }
    unload() {
      events.push("particles-unload");
    }
  }
  class Shape {
    constructor() {
      this.threeObj = {
        geometry: { dispose: () => events.push("shape-geometry") },
        material: { dispose: () => events.push("shape-material") },
      };
    }
    unload() {
      events.push("shape-unload");
    }
  }
  const context = { PZ: { layer: Layer, object3d: { particles: Particles, shape: Shape } }, console };
  context.window = context;
  vm.runInNewContext(source, context);
  return { Layer, Particles, Shape, events, context };
}

test("layer unload releases the composite quad after the original unload", () => {
  const { Layer, events } = install();
  assert.equal(new Layer().unload(), "done");
  assert.deepEqual(events, ["unload", "geometry", "material"]);
});

test("installing twice keeps a single wrapper", () => {
  const { Layer, context } = install();
  const first = Layer.prototype.unload;
  vm.runInNewContext(source, context);
  assert.equal(Layer.prototype.unload, first);
});

test("layers without a quad still unload", () => {
  const { Layer } = install();
  const layer = new Layer();
  layer.composite = {};
  assert.equal(layer.unload(), "done");
});

test("built-in particles release their Points mesh on unload", () => {
  const { Particles, events } = install();
  new Particles().unload();
  assert.deepEqual(events, ["particles-unload", "points-geometry", "points-material"]);
});

test("shapes release only their generated geometry", () => {
  const { Shape, events } = install();
  new Shape().unload();
  assert.deepEqual(events, ["shape-unload", "shape-geometry"]);
});
