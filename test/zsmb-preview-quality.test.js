"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const effectSource = fs.readFileSync(
  path.join(__dirname, "../plugins/smart-motion-blur-lite/effect.js"),
  "utf8",
);

function makeTHREE() {
  class Vector2 {
    constructor(x = 1, y = 1) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; return this; }
    copy(other) { return this.set(other.x, other.y); }
  }
  class Material {
    constructor(options) { Object.assign(this, options); }
    dispose() {}
  }
  class ShaderPass {
    constructor(material) { this.material = material; this.uniforms = material.uniforms; }
    render() {}
  }
  return { Vector2, ShaderMaterial: Material, ShaderPass, NoBlending: 0 };
}

function propertyCollection(initial = {}) {
  const values = {
    quality: 1,
    qualityPresetVersion: 2,
    enabled: 1,
    trackFrame: 0,
    amount: 0.5,
    sensitivity: 0.7,
    name: "ZSMB (beta 1.0)",
    ...initial,
  };
  const properties = {};
  for (const key of Object.keys(values)) {
    properties[key] = {
      animated: false,
      definition: {},
      get: () => values[key],
      set: (value) => { values[key] = value; },
    };
  }
  properties.load = (data) => {
    for (const [key, value] of Object.entries(data || {})) {
      if (Object.prototype.hasOwnProperty.call(values, key)) values[key] = value;
    }
  };
  properties.values = values;
  return properties;
}

function makeRequire() {
  return (name) => {
    if (name === "./analysis-mode.js") return require("../plugins/smart-motion-blur-lite/analysis-mode.js");
    if (name === "./estimator.js") {
      return { createEstimator: () => ({ estimate() {} }), createSmoothEstimator: () => ({ estimate() {} }) };
    }
    if (name === "./tooltips.js") return { install: () => ({ release() {} }) };
    if (name === "./native-particles.js") return { install: () => ({ release() {} }) };
    throw new Error("Unexpected ZSMB module: " + name);
  };
}

function loadDefinition({ compositor, properties = propertyCollection() } = {}) {
  let definition = null;
  const sandbox = {
    console,
    THREE: makeTHREE(),
    properties,
    parentProject: { sequence: {} },
    _zoidiumGetAsset: () => "",
    PZ: {
      property: { type: { NUMBER: 0, OPTION: 10 } },
      compositor,
    },
    ZoidiumPluginApis: {
      gl: {
        createCopyPass: () => ({ material: { blending: 0 } }),
        disposePass: () => {},
      },
      modules: { createRequire: () => makeRequire() },
      defineFrameSampler(spec) { definition = spec; },
    },
  };
  vm.createContext(sandbox);
  new vm.Script(effectSource, { filename: "smart-motion-blur-lite/effect.js" }).runInContext(sandbox);
  return { definition, sandbox, properties };
}

function compositorPrototype() {
  const proto = {
    setSize() {},
    renderSequence() {},
    unload() {},
  };
  return proto;
}

test("Quality is visible with the four levels and defaults to 1/2", () => {
  const { definition } = loadDefinition();
  assert.equal(definition.properties.quality.visible, undefined, "a visible property omits the flag");
  assert.equal(definition.properties.quality.name, "Quality");
  assert.equal(definition.properties.quality.value, 1);
  assert.deepEqual(definition.properties.quality.items, "Full;1/2;1/4;1/8");
  assert.equal(definition.properties.qualityPresetVersion.value, 2);
  assert.doesNotMatch(definition.properties.quality.description, /\b(?:Panzoid|Clipmaker|Player\+|CM3)\b/);
});

test("a project saved with assets 295 through 301 keeps its stored meaning", () => {
  for (const quality of [0, 1]) {
    const { definition, sandbox, properties } = loadDefinition();
    properties.values.quality = 1;
    definition.lifecycle.load.call(sandbox, { properties: { quality, qualityPresetVersion: 1 } });
    assert.equal(properties.values.quality, quality);
    assert.equal(properties.values.qualityPresetVersion, 2, "saving marks the new preset version");
    definition.lifecycle.unload.call(sandbox);
  }
});

test("the old mapping still applies to projects saved before preset version 2", () => {
  for (const [stored, version] of [[2, 0], [3, 0], [2, 1], [3, 1], [7, 1]]) {
    const { definition, sandbox, properties } = loadDefinition();
    definition.lifecycle.load.call(sandbox, { properties: { quality: stored, qualityPresetVersion: version } });
    assert.equal(properties.values.quality, 1, `quality ${stored} with version ${version}`);
    definition.lifecycle.unload.call(sandbox);
  }
});

test("preset version 2 projects keep 1/4 and 1/8", () => {
  for (const quality of [0, 1, 2, 3]) {
    const { definition, sandbox, properties } = loadDefinition();
    definition.lifecycle.load.call(sandbox, { properties: { quality, qualityPresetVersion: 2 } });
    assert.equal(properties.values.quality, quality);
    definition.lifecycle.unload.call(sandbox);
  }
});

test("a new effect saves the 1/2 default with preset version 2", () => {
  const { definition, sandbox, properties } = loadDefinition();
  definition.lifecycle.load.call(sandbox, undefined);
  assert.equal(properties.values.quality, 1);
  assert.equal(properties.values.qualityPresetVersion, 2);
  definition.lifecycle.unload.call(sandbox);
});

test("an animated legacy Quality keeps its keyframes", () => {
  const { definition, sandbox, properties } = loadDefinition();
  properties.quality.animated = true;
  properties.values.quality = 3;
  definition.lifecycle.load.call(sandbox, { properties: { quality: 3, qualityPresetVersion: 1 } });
  assert.equal(properties.values.quality, 3);
  assert.equal(properties.values.qualityPresetVersion, 2);
  definition.lifecycle.unload.call(sandbox);
});

test("the sampler request follows the Quality level", () => {
  const { definition, sandbox } = loadDefinition();
  definition.lifecycle.load.call(sandbox, { properties: {} });

  sandbox._smbDebugSettings = { quality: 0 };
  let request = definition.getRequest(sandbox, 24);
  assert.deepEqual(JSON.parse(JSON.stringify(request.frames)), [-1]);
  assert.equal(request.reuseCurrentInput, false);

  for (const quality of [1, 2, 3]) {
    sandbox._smbDebugSettings = { quality };
    request = definition.getRequest(sandbox, 24);
    assert.deepEqual(JSON.parse(JSON.stringify(request.frames)), [-1, 0]);
    assert.equal(request.reuseCurrentInput, true);
  }
  definition.lifecycle.unload.call(sandbox);
});

test("loading and unloading never patches the compositor", () => {
  const proto = compositorPrototype();
  const setSize = proto.setSize, renderSequence = proto.renderSequence, unload = proto.unload;
  const { definition, sandbox } = loadDefinition({ compositor: { prototype: proto } });

  definition.lifecycle.load.call(sandbox, { properties: {} });
  assert.equal(proto.setSize, setSize);
  assert.equal(proto.renderSequence, renderSequence);
  assert.equal(proto.unload, unload);

  definition.lifecycle.unload.call(sandbox);
  assert.equal(proto.setSize, setSize);
  assert.equal(proto.renderSequence, renderSequence);
  assert.equal(proto.unload, unload);
});

test("loading removes the preview size forcing left by an older build", () => {
  const restored = [];
  const proto = {
    setSize(width, height) { restored.push([width, height]); },
    renderSequence() {},
    unload() {},
  };
  const setSize = proto.setSize, renderSequence = proto.renderSequence, unload = proto.unload;
  const state = {
    effects: new WeakSet(),
    references: new Set(),
    roots: new Map([[{}, [800, 450]]]),
    setSize,
    renderSequence,
    unload,
    sizeHook() {},
    renderHook() {},
    unloadHook() {},
  };
  proto.setSize = state.sizeHook;
  proto.renderSequence = state.renderHook;
  proto.unload = state.unloadHook;
  proto.__zoidiumSmbLiteNative = state;

  const { definition, sandbox } = loadDefinition({ compositor: { prototype: proto } });
  definition.lifecycle.load.call(sandbox, { properties: {} });

  assert.equal(proto.setSize, setSize);
  assert.equal(proto.renderSequence, renderSequence);
  assert.equal(proto.unload, unload);
  assert.equal(proto.__zoidiumSmbLiteNative, undefined);
  assert.deepEqual(restored, [[800, 450]]);
  definition.lifecycle.unload.call(sandbox);
});

test("Previous samples the clip edge at a fractional frame before frame one", () => {
  const { definition, sandbox } = loadDefinition();
  definition.lifecycle.load.call(sandbox, { properties: {} });
  const request = definition.getRequest(sandbox, 0.5);
  assert.equal(request.enabled, true);
  assert.deepEqual(Array.from(request.frames), [-1, 0]);
  const { planExplicitFrameSamples } = require("../plugins/core/temporal-math.js");
  assert.deepEqual(planExplicitFrameSamples(0.5, Array.from(request.frames), 0, 9).map(sample => sample.frame), [0, 0.5]);
  definition.lifecycle.unload.call(sandbox);
});
