"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const managerSource = fs.readFileSync(
  path.join(projectRoot, "plugins/plugin-manager.js"),
  "utf8"
);

function loadDependencyHelpers() {
  const start = managerSource.indexOf("  function normalizeProjectPlugins(plugins) {");
  const end = managerSource.indexOf("  function installMissingFactoriesForRequirements(plugins) {");
  assert.ok(start >= 0 && end > start, "project dependency helpers are present");
  const script =
    managerSource.slice(start, end) +
    "\n__helpers = { normalizeProjectPlugins, projectPluginRequirements, serializeProjectPlugins };";
  const sandbox = {
    LAYER_INPUT_EFFECT_IDS: new Set(["layerinput", "layerinputdisplacement"]),
    LAYER_INPUT_PLUGIN_ID: "layer-input",
    LAYER_INPUT_SHADER_FEATURE_ID: "shader-layer-input",
    MATERIAL_PLUS_PLUGIN_ID: "material-plus",
    NATIVE_FX_EFFECTS: new Map([
      ["radialblurspin", "Radial Blur (Spin)"],
      ["colorcurves", "Color Curves"],
      ["echo", "Echo"],
      ["dropshadow", "Drop Shadow"],
      ["timeoffset", "Time Offset"],
      ["posterizetime", "Posterize Time"],
    ]),
    NATIVE_FX_PLUGIN_ID: "native-fx",
    PARTICLES_PLUS_PLUGIN_ID: "particles-plus",
    PLUGIN_DEPENDENCY_INFO: new Map([
      ["native-fx", { name: "Native FX", author: "Zoidium" }],
      ["layer-input", { name: "Layer Input", author: "Zoidium" }],
      ["material-plus", { name: "Material+", author: "Zoidium" }],
      ["text-plus", { name: "Text+", author: "Zoidium" }],
      ["particles-plus", { name: "Particles+", author: "Zoidium" }],
    ]),
    PLUGIN_MATERIAL_TYPES: new Map([
      ["matcap", { pluginId: "material-plus", name: "Matcap Material" }],
      ["pbrplus", { pluginId: "material-plus", name: "PBR+ Material" }],
      ["uvcustom", { pluginId: "material-plus", name: "UV Custom Material" }],
      ["layersource", { pluginId: "layer-input", name: "Layer Source" }],
    ]),
    PZ: { zoidium: { object3d: {} } },
    TEXT_PLUS_BEVEL_FEATURE_ID: "advanced-bevel",
    TEXT_PLUS_PLUGIN_ID: "text-plus",
    TEXT_PLUS_SPACING_FEATURE_ID: "text-spacing",
    pluginStates: new Map([
      [
        "text-plus",
        {
          plugin: {
            id: "text-plus",
            name: "Text+",
            author: "Zoidium",
            version: "16",
          },
        },
      ],
    ]),
    __helpers: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "plugin-manager-dependencies.js" });
  return sandbox.__helpers;
}

const helpers = loadDependencyHelpers();

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function requirements(data) {
  return plain(helpers.projectPluginRequirements(data));
}

function pluginById(data, id) {
  return requirements(data).find((plugin) => plugin.id === id);
}

function textObject(properties) {
  return {
    type: 1,
    properties: {
      text: "Zoidium",
      font: "/assets/fonts/2d/bebas.ttf",
      bevelSize: [0.1, 0.5],
      spacing: 0,
      bevelSide: 0,
      bevelDetail: 3,
      bevelProfile: 1,
      bevelTension: 0.5,
      ...properties,
    },
  };
}

test("Custom Shader Layer Input is detected at any nesting depth", () => {
  const shader = {
    type: 1,
    properties: { fragShader: "uniform sampler2D Source;" },
    customProperties: [
      {
        type: {
          custom: true,
          type: 10,
          _zoidiumLayerSource: true,
          _zoidiumShaderLayerSource: true,
        },
        properties: { name: "Source" },
        value: "",
      },
    ],
  };
  const plugin = pluginById({ sequence: { videoTracks: [{ clips: [{ object: { effects: [shader] } }] }] } }, "layer-input");
  assert.deepEqual(plugin.features, ["shader-layer-input"]);
  assert.deepEqual(plugin.effects, []);
  assert.deepEqual(plugin.materials, []);
});

test("live Custom Shader properties are detected through their definitions", () => {
  const plugin = pluginById(
    {
      type: 1,
      customProperties: [
        {
          definition: {
            _zoidiumLayerSource: true,
            _zoidiumShaderLayerSource: true,
          },
          value: "",
        },
      ],
    },
    "layer-input"
  );
  assert.deepEqual(plugin.features, ["shader-layer-input"]);
});

test("all native Layer Input forms merge into one dependency", () => {
  const plugin = pluginById(
    {
      nodes: [
        { type: "layerinput" },
        { type: "layerinputdisplacement" },
        { type: "layersource" },
        { type: { _zoidiumShaderLayerSource: true } },
      ],
    },
    "layer-input"
  );
  assert.deepEqual(plugin.effects, ["layerinput", "layerinputdisplacement"]);
  assert.deepEqual(plugin.materials, ["layersource"]);
  assert.deepEqual(plugin.features, ["shader-layer-input"]);
});

test("Layer Input track identities alone do not create a dependency", () => {
  assert.deepEqual(
    requirements({ sequence: { videoTracks: [{ _zoidiumLayerInputId: "track-1" }] } }),
    []
  );
});

test("Text+ detects horizontal spacing without tagging untouched Text", () => {
  assert.equal(pluginById({ objects: [textObject()] }, "text-plus"), undefined);
  const plugin = pluginById({ objects: [textObject({ spacing: 12.5 })] }, "text-plus");
  assert.deepEqual(plugin.features, ["text-spacing"]);
  assert.equal(plugin.version, "16");
});

test("live Text property objects are scanned before JSON.stringify runs", () => {
  const property = (value) => ({ value });
  const plugin = pluginById(
    {
      objects: [
        textObject({
          spacing: property(4),
          bevelSide: property(0),
          bevelDetail: property(3),
          bevelProfile: property(1),
          bevelTension: property(0.5),
        }),
      ],
    },
    "text-plus"
  );
  assert.deepEqual(plugin.features, ["text-spacing"]);
});

test("Text+ detects every advanced bevel control when it differs from its default", () => {
  const cases = [
    ["bevelSide", 1],
    ["bevelDetail", 8],
    ["bevelProfile", 0],
    ["bevelTension", 0.2],
  ];
  for (const [name, value] of cases) {
    const plugin = pluginById({ objects: [textObject({ [name]: value })] }, "text-plus");
    assert.deepEqual(plugin.features, ["advanced-bevel"], name);
  }
});

test("Text+ property checks accept serialized property wrappers and reject lookalikes", () => {
  const animated = {
    animated: false,
    keyframes: [{ value: 0.75, frame: 0 }],
  };
  const plugin = pluginById(
    { objects: [textObject({ bevelTension: animated })] },
    "text-plus"
  );
  assert.deepEqual(plugin.features, ["advanced-bevel"]);
  assert.equal(
    pluginById({ effects: [{ type: 1, properties: { spacing: 20 } }] }, "text-plus"),
    undefined
  );
});

test("Material+ types are recovered even when project metadata is absent", () => {
  const plugin = pluginById(
    { materials: [{ type: "uvcustom" }, { type: "matcap" }, { type: "pbrplus" }] },
    "material-plus"
  );
  assert.deepEqual(plugin.materials, ["matcap", "pbrplus", "uvcustom"]);
});

test("native effects, namespaced objects, and particle sprite markers are detected", () => {
  const plugins = requirements({
    nested: [
      { type: "echo" },
      { type: "zoidium:geometry-plus/gear" },
      { type: "zoidium:repeater/echo-repeater" },
      { _zoidiumParticlesPlusSprite: "snowflake" },
    ],
  });
  assert.deepEqual(plugins.find((plugin) => plugin.id === "native-fx").effects, ["echo"]);
  assert.deepEqual(plugins.find((plugin) => plugin.id === "geometry-plus").objects, ["gear"]);
  assert.deepEqual(plugins.find((plugin) => plugin.id === "repeater").objects, ["echo-repeater"]);
  assert.deepEqual(plugins.find((plugin) => plugin.id === "particles-plus").sprites, ["snowflake"]);
});

test("duplicate and partial project metadata is merged with detected usage", () => {
  const plugin = pluginById(
    {
      plugins: [
        "layer-input",
        { id: "layer-input", name: "Layer Input", effects: ["layerinput"] },
        { id: "layer-input", materials: ["layersource"] },
      ],
      nested: [{ type: "layerinputdisplacement" }, { type: { _zoidiumShaderLayerSource: true } }],
    },
    "layer-input"
  );
  assert.deepEqual(plugin.effects, ["layerinput", "layerinputdisplacement"]);
  assert.deepEqual(plugin.materials, ["layersource"]);
  assert.deepEqual(plugin.features, ["shader-layer-input"]);
});

test("empty optional dependency fields are omitted from saved project metadata", () => {
  const serialized = plain(
    helpers.serializeProjectPlugins([
      {
        id: "native-fx",
        name: "Native FX",
        version: "8",
        author: "Zoidium",
        effects: ["echo"],
        materials: [],
        objects: [],
        sprites: [],
        features: [],
      },
    ])
  );
  assert.equal(Object.hasOwn(serialized[0], "sprites"), false);
  assert.equal(Object.hasOwn(serialized[0], "features"), false);
});

test("save hooks rescan serialized JSON before metadata and warnings are produced", () => {
  assert.match(
    managerSource,
    /projectPluginRequirements\(\{ \.\.\.json, plugins: trackedPlugins \}\)/
  );
  assert.match(
    managerSource,
    /normalizeProjectPlugins\(this\.project\?\.toJSON\?\.\(\)\.plugins\)/
  );
});
