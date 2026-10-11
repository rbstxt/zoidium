// Plugin manager: state. Shared internals are private to these ordered overlays.
(function () {
  "use strict";
  const manager = {};
  window.ZoidiumPluginManagerInternals = manager;

  // BEGIN manager body 4
  const DEFAULT_IN_USE_REASON = "This plugin is in use by the project. Remove its items before disabling it.";
  // zoidium/runtime-config.js owns this URL and preloads it at startup.
  const REGISTRY_URL =
    (window.ZOIDIUM_RUNTIME && window.ZOIDIUM_RUNTIME.registryUrl) ||
    "./plugins/registry.json?v=31";
  const STORAGE_PREFIX = "zoidium.plugin.enabled.";
  const SHADER_PLUGIN_MARKER = "// @zoidium-plugin ";
  const EFFECT_UUID_PROPERTY = "_zoidiumEffectUuid";
  const NATIVE_FX_PLUGIN_ID = "native-fx";
  const LAYER_INPUT_PLUGIN_ID = "layer-input";
  const LAYER_INPUT_EFFECT_ID = "layerinput";
  const LAYER_INPUT_DISPLACEMENT_EFFECT_ID = "layerinputdisplacement";
  const LAYER_INPUT_MATERIAL_ID = "layersource";
  const MATERIAL_PLUS_PLUGIN_ID = "material-plus";
  const TEXT_PLUS_PLUGIN_ID = "text-plus";
  const PARTICLES_PLUS_PLUGIN_ID = "particles-plus";
  const OPENZOID_LEGACY_PLUGIN_ID = "openzoid-legacy";
  const TRAPCODE_SUITE_PLUGIN_ID = "trapcode-suite";
  const OPTICAL_FLARES_PLUGIN_ID = "optical-flares";
  const EFFECTOR_PLUS_PLUGIN_ID = "effector-plus";
  const CAMERA_PLUS_PLUGIN_ID = "camera-plus";
  const LAYER_INPUT_SHADER_FEATURE_ID = "shader-layer-input";
  const TEXT_PLUS_SPACING_FEATURE_ID = "text-spacing";
  const TEXT_PLUS_BEVEL_FEATURE_ID = "advanced-bevel";
  const LAYER_INPUT_EFFECT_IDS = new Set([
    LAYER_INPUT_EFFECT_ID,
    LAYER_INPUT_DISPLACEMENT_EFFECT_ID,
  ]);
  const NATIVE_FX_EFFECTS = new Map([
    ["radialblurspin", "Radial Blur (Spin)"],
    ["colorcurves", "Color Curves"],
    ["echo", "Echo"],
    ["dropshadow", "Drop Shadow"],
    ["timeoffset", "Time Offset"],
    ["posterizetime", "Posterize Time"],
  ]);
  const PLUGIN_MATERIAL_TYPES = new Map([
    ["matcap", { pluginId: MATERIAL_PLUS_PLUGIN_ID, name: "Matcap Material" }],
    ["pbrplus", { pluginId: MATERIAL_PLUS_PLUGIN_ID, name: "PBR+ Material" }],
    ["uvcustom", { pluginId: MATERIAL_PLUS_PLUGIN_ID, name: "UV Custom Material" }],
    [LAYER_INPUT_MATERIAL_ID, { pluginId: LAYER_INPUT_PLUGIN_ID, name: "Layer Source" }],
  ]);
  // Native effect id -> owning plugin, across all packs (extends the
  // hardcoded native-fx set above for project dependency scans).
  const NATIVE_EFFECT_PLUGINS = new Map([
    ["radialblurspin", NATIVE_FX_PLUGIN_ID],
    ["colorcurves", NATIVE_FX_PLUGIN_ID],
    ["echo", NATIVE_FX_PLUGIN_ID],
    ["dropshadow", NATIVE_FX_PLUGIN_ID],
    ["timeoffset", NATIVE_FX_PLUGIN_ID],
    ["posterizetime", NATIVE_FX_PLUGIN_ID],
    [LAYER_INPUT_EFFECT_ID, LAYER_INPUT_PLUGIN_ID],
    [LAYER_INPUT_DISPLACEMENT_EFFECT_ID, LAYER_INPUT_PLUGIN_ID],
    ["echo-legacy", OPENZOID_LEGACY_PLUGIN_ID],
    ["posterizetime-legacy", OPENZOID_LEGACY_PLUGIN_ID],
    ["jpegdamage", OPENZOID_LEGACY_PLUGIN_ID],
    ["vhs", OPENZOID_LEGACY_PLUGIN_ID],
    ["datamosh", OPENZOID_LEGACY_PLUGIN_ID],
  ]);
  // Numeric 3D-object type -> owning pack. Layers always carry an effects
  // array while object entries never do, so the scan below tells them apart.
  const NUMERIC_OBJECT_TYPES = new Map([
    [7, { pluginId: EFFECTOR_PLUS_PLUGIN_ID, objectId: "twist" }],
    [8, { pluginId: EFFECTOR_PLUS_PLUGIN_ID, objectId: "warp" }],
    [9, { pluginId: EFFECTOR_PLUS_PLUGIN_ID, objectId: "voronoi" }],
    [10, { pluginId: TRAPCODE_SUITE_PLUGIN_ID, objectId: "particular" }],
    [11, { pluginId: TRAPCODE_SUITE_PLUGIN_ID, objectId: "form" }],
    [12, { pluginId: TRAPCODE_SUITE_PLUGIN_ID, objectId: "plexus" }],
    [13, { pluginId: OPTICAL_FLARES_PLUGIN_ID, objectId: "optical-flares" }],
  ]);
  // Numeric layer type -> owning pack, scanned along track clip paths only
  // (type 9 is ambiguous in flat JSON: Voronoi object vs Camera layer).
  const NUMERIC_LAYER_TYPES = new Map([
    [9, { pluginId: CAMERA_PLUS_PLUGIN_ID, layerId: "camera-layer" }],
  ]);
  const PLUGIN_DEPENDENCY_INFO = new Map([
    [NATIVE_FX_PLUGIN_ID, { name: "Native FX", author: "Zoidium" }],
    [LAYER_INPUT_PLUGIN_ID, { name: "Layer Input", author: "Zoidium" }],
    [MATERIAL_PLUS_PLUGIN_ID, { name: "Material+", author: "Zoidium" }],
    [TEXT_PLUS_PLUGIN_ID, { name: "Text+", author: "Zoidium" }],
    [PARTICLES_PLUS_PLUGIN_ID, { name: "Particles+", author: "Zoidium" }],
    [OPENZOID_LEGACY_PLUGIN_ID, { name: "Setup Legacy", author: "Zoidium" }],
    [TRAPCODE_SUITE_PLUGIN_ID, { name: "Rowbyte & Red Giant Suite", author: "Zoidium" }],
    [OPTICAL_FLARES_PLUGIN_ID, { name: "Optical Flares", author: "Zoidium" }],
    [EFFECTOR_PLUS_PLUGIN_ID, { name: "Effector+", author: "Zoidium" }],
    [CAMERA_PLUS_PLUGIN_ID, { name: "Camera+", author: "Zoidium" }],
  ]);
  const DEFAULT_PLUGIN_COLORS = Object.freeze({
    "easing-plus": "#384668",
    "native-fx": "#c56b3d",
    "light-plus": "#2f9b86",
    "alipfx-shader-pack-4": "#a04ed1",
    afterclip: "#d35a76",
    "player-plus": "#4f7dbf",
    "layer-input": "#4f9db6",
    "geometry-plus": "#6b86c5",
    "particles-plus": "#6b5b8f",
  });
  const pluginStates = new Map();
  const pluginGroups = [];
  const pluginGroupByPluginId = new Map();
  const trackedNativeEffects = new Set();
  const missingNativeEffects = new Set();
  const trackedPluginMaterials = new Set();
  const missingPluginMaterials = new Set();
  const trackedPluginObjects = new Set();
  const missingPluginObjects = new Set();
  const trackedPluginResources = new Set();
  const missingPluginResources = new Set();
  const missingNumericObjects = new Set();
  const missingNumericLayers = new Set();
  const debugUsageCounts = new Map();
  const effectUuidByEntry = new WeakMap();
  let projectHooksInstalled = false;
  let editorHooksInstalled = false;
  let effectBadgeObserver = null;
  let effectBadgeUpdateScheduled = false;
  let nativeFxSearchPatched = false;
  let registryReadySettled = false;
  let resolveRegistryReady;
  const registryReady = new Promise((resolve) => {
    resolveRegistryReady = resolve;
  });

  // END manager body
  Object.assign(manager, { DEFAULT_IN_USE_REASON, REGISTRY_URL, STORAGE_PREFIX, SHADER_PLUGIN_MARKER, EFFECT_UUID_PROPERTY, NATIVE_FX_PLUGIN_ID, LAYER_INPUT_PLUGIN_ID, LAYER_INPUT_EFFECT_ID, LAYER_INPUT_DISPLACEMENT_EFFECT_ID, LAYER_INPUT_MATERIAL_ID, MATERIAL_PLUS_PLUGIN_ID, TEXT_PLUS_PLUGIN_ID, PARTICLES_PLUS_PLUGIN_ID, OPENZOID_LEGACY_PLUGIN_ID, TRAPCODE_SUITE_PLUGIN_ID, OPTICAL_FLARES_PLUGIN_ID, EFFECTOR_PLUS_PLUGIN_ID, CAMERA_PLUS_PLUGIN_ID, LAYER_INPUT_SHADER_FEATURE_ID, TEXT_PLUS_SPACING_FEATURE_ID, TEXT_PLUS_BEVEL_FEATURE_ID, LAYER_INPUT_EFFECT_IDS, NATIVE_FX_EFFECTS, PLUGIN_MATERIAL_TYPES, NATIVE_EFFECT_PLUGINS, NUMERIC_OBJECT_TYPES, NUMERIC_LAYER_TYPES, PLUGIN_DEPENDENCY_INFO, DEFAULT_PLUGIN_COLORS, pluginStates, pluginGroups, pluginGroupByPluginId, trackedNativeEffects, missingNativeEffects, trackedPluginMaterials, missingPluginMaterials, trackedPluginObjects, missingPluginObjects, trackedPluginResources, missingPluginResources, missingNumericObjects, missingNumericLayers, debugUsageCounts, effectUuidByEntry, registryReady, projectHooksInstalled, editorHooksInstalled, effectBadgeObserver, effectBadgeUpdateScheduled, nativeFxSearchPatched, registryReadySettled, resolveRegistryReady });
})();
