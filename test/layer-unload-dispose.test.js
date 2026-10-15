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
  const effect = { fnList: {} };
  const context = { PZ: { layer: Layer, object3d: { particles: Particles, shape: Shape }, effect }, console };
  context.window = context;
  vm.runInNewContext(source, context);
  return { Layer, Particles, Shape, events, context, effect };
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

// Mirrors CM3's effect/displacementmap.js unload().
function displacementBody() {
  this.unload = function () {
    if (this.texture) {
      this.parentProject.assets.unload(this.texture);
      this.pass.uniforms.tDiffuse.value.dispose();
    }
    this.parentProject.assets.unload(this.vertShader);
  };
}

async function displacementEffect(effect, events, rendered) {
  // CM3 assigns the cached source promise after the first fetch.
  effect.fnList.displacementmap = Promise.resolve(displacementBody);
  const instance = {
    texture: "map",
    vertShader: "vert",
    parentProject: { assets: { unload: (name) => events.push("asset:" + name) } },
    pass: { uniforms: { tDiffuse: { value: rendered ? { dispose: () => events.push("input") } : null } } },
  };
  (await effect.fnList.displacementmap).call(instance);
  return instance;
}

test("a Displacement Map that never rendered unloads without throwing", async () => {
  const { effect, events } = install();
  const instance = await displacementEffect(effect, events, false);
  instance.unload();
  assert.deepEqual(events, ["asset:map", "asset:vert"]);
  assert.equal(instance.pass.uniforms.tDiffuse.value, null);
});

test("a rendered Displacement Map keeps CM3's original unload", async () => {
  const { effect, events } = install();
  const instance = await displacementEffect(effect, events, true);
  instance.unload();
  assert.deepEqual(events, ["asset:map", "input", "asset:vert"]);
});
