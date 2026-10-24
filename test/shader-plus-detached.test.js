"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { installRuntime } = require("../plugins/shader-plus/runtime.js");
const { KINDS } = require("../plugins/shader-plus/kinds.js");

test("Shader+ font retention ignores an effect removed during native shader load", async () => {
  let finishLoad, loads = 0;
  const pending = new Promise(resolve => { finishLoad = resolve; });
  class Shader { async load() { await pending; return 42; } }
  class Static {}
  class Texture { dispose() {} }
  class Vector { constructor(x, y) { this.x = x; this.y = y; } }
  const PZ = { property: { static: Static }, effect: { shader: Shader } };
  const runtime = installRuntime({ PZ, THREE: { DataTexture: Texture, Vector2: Vector }, doc: {}, curves: {}, editor: () => null, presetFont: () => "font",
    pipeline: { registerIncludes: () => () => {}, register: () => () => {} },
    patch(host, key, wrap) { host[key] = wrap(host[key] || (() => {})); },
  });
  const property = { definition: KINDS.text.create(), get: () => '{"font":"font"}' };
  const project = { assets: { load() { loads++; return {}; }, unload() {} } };
  const effect = new Shader(); effect.parent = project; effect.customProperties = [property];
  Object.defineProperty(effect, "parentProject", { get() { return this.parent || this.parent.parentObject; } });
  const loading = effect.load(); effect.parent = null; finishLoad();
  assert.equal(await loading, 42);
  assert.equal(loads, 0, "removed effects retain no new font assets");
  effect.parent = project;
  assert.equal(await effect.load(), 42);
  assert.equal(loads, 1, "reattached effects can load their font");
  runtime.disposeAll();
});
