"use strict";
const test = require("node:test");
const { installRuntime } = require("../plugins/shader-plus/runtime.js");
const { KINDS } = require("../plugins/shader-plus/kinds.js");
const { resourceCounter } = require("./helpers/resource-counter.js");

test("Shader+ releases gradient and curve textures on effect unload", () => {
  const counter = resourceCounter();
  class Shader { unload() {} }
  class Static {}
  class Vector { fromArray() { return this; } }
  const DataTexture = counter.track(class { constructor(data, width, height) { this.image = { data, width, height }; } }, "texture");
  const PZ = { effect: { shader: Shader }, property: { static: Static } };
  const runtime = installRuntime({ PZ, THREE: { DataTexture, Vector2: Vector }, doc: {}, curves: require("../plugins/material-plus/graph-curves.js"), editor: () => null,
    presetFont: () => null, pipeline: { registerIncludes: () => () => {}, register: () => () => {} },
    patch(host, key, wrap) { host[key] = wrap(host[key] || (() => {})); } });
  const effect = new Shader();
  effect.customProperties = ["gradient", "curve"].map(kind => {
    const definition = KINDS[kind].create();
    return { definition, get: () => definition.value };
  });
  for (const property of effect.customProperties) runtime.prepareEntry(effect, property, property.definition.zoidiumShader.kind);
  effect.unload();
  runtime.disposeAll();
  counter.assertDisposed();
});
