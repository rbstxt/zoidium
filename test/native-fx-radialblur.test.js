"use strict";

// Radial Blur (Spin): Weight only matters with Overbright on. The control name
// has to say so, and the shader must keep the normalised path that cancels it.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");

function loadFilterSpec() {
  let spec = null;
  const sandbox = {
    PZ: { property: { type: { NUMBER: 0, OPTION: 10, VECTOR2: 5 } } },
    THREE: { Vector2: class {} },
    ZoidiumPluginApis: {
      defineFilter(value) {
        spec = value;
      },
    },
  };
  vm.createContext(sandbox);
  const source = fs.readFileSync(
    path.join(projectRoot, "plugins/native-fx/effects/radialblurspin.js"),
    "utf8",
  );
  new vm.Script(source, { filename: "radialblurspin.js" }).runInContext(sandbox);
  return spec;
}

test("Radial Blur names Weight as an Overbright control and keeps its saved id", () => {
  const spec = loadFilterSpec();
  assert.equal(spec.properties.weight.name, "Overbright Weight");
  assert.equal(spec.properties.weight.value, 0.2, "saved default is unchanged");
  assert.equal(spec.properties.overbright.name, "Overbright");
  assert.equal(spec.properties.overbright.value, 0, "Overbright is off by default");
  assert.ok(spec.defines.CONSTANT_BRIGHTNESS, "normalised path is the default");
});

test("Radial Blur shader cancels Weight unless CONSTANT_BRIGHTNESS is off", () => {
  const shader = fs.readFileSync(
    path.join(projectRoot, "plugins/native-fx/shaders/fx_radialblurspin.glsl"),
    "utf8",
  );
  assert.match(shader, /#ifdef CONSTANT_BRIGHTNESS[\s\S]*color \/= sum;/,
    "the normalised path divides by the weight sum");
  assert.match(shader, /#else[\s\S]*color \*= 1\.0 - dot\(tuv, tuv\)/,
    "the Overbright path keeps the raw weighted sum");
});
