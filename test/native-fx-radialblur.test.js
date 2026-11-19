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

test("Overbright off restores normalized brightness after a native option change", () => {
  const spec = loadFilterSpec();
  const material = { defines: {} };
  const property = { value: "0", parentObject: { pass: { material } } };
  spec.properties.overbright.changed.call(property);
  assert.equal(material.defines.CONSTANT_BRIGHTNESS, 1);
  property.value = "1";
  spec.properties.overbright.changed.call(property);
  assert.equal(material.defines.CONSTANT_BRIGHTNESS, undefined);
});

test("zero Weight keeps the normalized blur finite", () => {
  const spec = loadFilterSpec();
  assert.equal(spec.properties.weight.min, 0);
  const shader = fs.readFileSync(path.join(projectRoot, "plugins/native-fx/shaders/fx_radialblurspin.glsl"), "utf8");
  assert.match(shader, /#ifdef CONSTANT_BRIGHTNESS\s+if \(wt == 0\.0\) wt = 1\.0;\s+#endif/);
  const normalize = (weight, decay, samples) => {
    let wt = weight === 0 ? 1 : weight, sum = wt, color = wt * samples[0];
    wt *= decay;
    for (let i = 1; i < samples.length; i++) { color += wt * samples[i]; sum += wt; wt *= decay; }
    return color / sum;
  };
  assert.equal(normalize(0, 0.9, [0.2, 0.8]), normalize(1, 0.9, [0.2, 0.8]));
});

test("dynamic OPTION keys retain strings across load and drive Radial Blur", () => {
  const { PZ } = require("./expressions-plus-harness").nativeHost();
  const definition = { dynamic: true, type: PZ.property.type.OPTION, value: 1, items: "off;on" };
  for (const raw of [1, "1", 0, "0"]) {
    const property = PZ.property.create({ ...definition }); property.load(); property.set(raw, 0);
    const saved = JSON.parse(JSON.stringify(property));
    const reopened = PZ.property.create({ ...definition }); reopened.load(saved);
    assert.equal(reopened.get(0), raw);
    assert.equal(saved.keyframes[0].value, raw);
    const spec = loadFilterSpec(), scalar = { get: () => 1 };
    const effect = { properties: { enabled: reopened, decay: scalar, density: scalar, dither: scalar, weight: scalar, center: { get: () => [0, 0] } },
      pass: { uniforms: { decay: {}, density: {}, dither: {}, weight: {}, center: { value: { set() {} } } } } };
    spec.update.call(effect, 0);
    assert.equal(effect.pass.enabled, Number(raw) === 1);
  }
});
