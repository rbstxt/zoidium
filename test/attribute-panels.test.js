"use strict";

// Attribute windows registered by Particles+, the Effector family and Optical
// Flares. Each plugin must register its window on activate, release it on
// dispose, and every tab key must be a real property of that object type.
// Vanilla CM3 keys are read from the cached core text (run pnpm run setup).

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const scene = require("../plugins/scene-plus/scene-plus.js");

const effectorTest = scene._test;

const root = path.join(__dirname, "..");
const corePath = path.join(root, ".zoidium-resources", "core-1.0.102.js");
const core = fs.existsSync(corePath) ? fs.readFileSync(corePath, "utf8") : null;
const coreSkip = core ? false : "CM3 cache missing (run pnpm run setup)";

// Top-level keys of a CM3 property-definition object literal, e.g. the text
// after "PZ.object3d.particles.propertyDefinitions=".
function cmDefinitionKeys(marker) {
  const start = core.indexOf(marker);
  assert.ok(start >= 0, `marker not found in CM3 core: ${marker}`);
  const keys = [];
  let depth = 0;
  let quote = null;
  let prev = "";
  for (let i = start + marker.length; i < core.length; i += 1) {
    const c = core[i];
    if (quote) {
      if (c === "\\") i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      prev = c;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") {
      depth += 1;
      prev = c;
      continue;
    }
    if (c === "}" || c === "]" || c === ")") {
      depth -= 1;
      if (depth === 0) break;
      prev = c;
      continue;
    }
    if (depth === 1 && (prev === "{" || prev === ",") && /[A-Za-z_]/.test(c)) {
      const word = /^[A-Za-z_]\w*/.exec(core.slice(i, i + 80))[0];
      if (core[i + word.length] === ":") {
        keys.push(word);
        i += word.length - 1;
        prev = "x";
        continue;
      }
    }
    if (!/\s/.test(c)) prev = c;
  }
  return keys;
}

function fakeUi() {
  const registered = [];
  return {
    registered,
    registerAttributePanel(spec) {
      const entry = { spec, released: false };
      registered.push(entry);
      return () => { entry.released = true; };
    },
    properties() {
      throw new Error("properties() is not used by these tests");
    },
  };
}

function assertTabs(spec, label) {
  assert.ok(spec.tabs.length > 0, `${label} has tabs`);
  const titles = new Set();
  for (const tab of spec.tabs) {
    assert.ok(tab.title && !titles.has(tab.title), `${label} tab title is unique: ${tab.title}`);
    titles.add(tab.title);
    assert.ok(tab.title.length <= 12, `${label} tab title is short: ${tab.title}`);
  }
}

// ---------------------------------------------------------------------------
// Particles+ (vanilla CM3 Particles object)

const particlesDir = path.join(root, "plugins", "particles-plus");

function loadParticlesPlugin() {
  const context = { module: { exports: {} }, WeakRef, console };
  vm.runInNewContext(fs.readFileSync(path.join(particlesDir, "particles-plus.js"), "utf8"), context);
  return context.module.exports;
}

function particleHost() {
  class Observable {
    callbacks = new Set();
    watch(callback) { this.callbacks.add(callback); }
    unwatch(callback) { this.callbacks.delete(callback); }
  }
  class Particle {
    constructor(project) {
      this.parentProject = project || null;
      const texture = { parentObject: this, parentProject: project, value: null, onChanged: new Observable(), get() { return this.value; } };
      this.properties = { texture };
    }
    unload() {}
    toJSON() { return {}; }
  }
  Particle.propertyDefinitions = { texture: { items: [], changed() {} } };
  const controls = {
    generateTextureInput() {
      const select = { onchange() {} };
      return [{ pz_update() {}, querySelector: () => select }, null];
    },
  };
  return { PZ: { object3d: { particles: Particle }, ui: { controls } }, Particle };
}

const particleManifest = JSON.parse(fs.readFileSync(path.join(particlesDir, "manifest.json"), "utf8"));

function particleActivation(host, ui) {
  const disposers = [];
  return {
    activation: {
      PZ: host.PZ,
      editor: { project: null },
      window: {},
      document: {},
      plugin: { id: "particles-plus", name: "Particles+", version: particleManifest.version },
      manifest: particleManifest,
      getAsset: () => "data:image/png;base64,AA==",
      lifecycle: { onDispose: (callback) => disposers.push(callback) },
      ui,
    },
    disposers,
  };
}

test("Particles+ registers its particle window on activate and releases it on dispose", () => {
  const host = particleHost();
  const plugin = loadParticlesPlugin();
  const ui = fakeUi();
  const { activation, disposers } = particleActivation(host, ui);
  plugin.activate(activation);
  assert.equal(ui.registered.length, 1);
  const [entry] = ui.registered;
  const { spec } = entry;
  assert.equal(spec.id, "particles");
  assert.equal(spec.title, "Particles");
  assert.equal(spec.persistKey, "particles");
  assert.ok(spec.width >= 380 && spec.width <= 420, "default attribute width");
  assert.ok(spec.height >= 520 && spec.height <= 600, "default attribute height");
  assert.equal(spec.match(new host.Particle(null)), true);
  assert.equal(spec.match({}), false);
  assert.equal(spec.match(null), false);
  assertTabs(spec, "Particles");
  disposers[0]();
  assert.equal(entry.released, true, "window registration released on dispose");
});

test("Particles+ tabs list only real CM3 particle properties", { skip: coreSkip }, () => {
  const plugin = loadParticlesPlugin();
  const spec = plugin.attributePanelSpec(particleHost().PZ);
  const keys = new Set(cmDefinitionKeys("PZ.object3d.particles.propertyDefinitions="));
  assert.ok(keys.size >= 20, "the CM3 core definition parsed");
  const listed = [];
  for (const tab of spec.tabs) {
    assert.ok(tab.keys.length > 0, `${tab.title} has rows`);
    for (const key of tab.keys) {
      assert.ok(keys.has(key), `${tab.title}: ${key} is a CM3 particle property`);
      listed.push(key);
    }
  }
  assert.equal(new Set(listed).size, listed.length, "no key is shown twice");
  assert.deepEqual(Array.from(spec.tabs, (tab) => tab.title), ["Emitter", "Position", "Motion", "Rotation", "Appearance"]);
});

test("each Particles+ topic lists its rows", { skip: coreSkip }, () => {
  const plugin = loadParticlesPlugin();
  const spec = plugin.attributePanelSpec(particleHost().PZ);
  const expected = {
    Emitter: ["number", "rate", "lifetime", "time"],
    Position: ["pdist", "ipos", "pspread", "iradius", "rspread"],
    Motion: ["vdist", "ivel", "vspread", "irvel", "rvspread", "accel"],
    Rotation: ["iang", "aspread", "angvel", "avspread"],
    Appearance: ["color", "size", "blending", "texture"],
  };
  for (const tab of spec.tabs) assert.deepEqual(Array.from(tab.keys), expected[tab.title], tab.title);
});

// ---------------------------------------------------------------------------
// Effector family (scene-plus)

class FakeProperties {
  constructor(definitions, owner) {
    this.owner = owner;
    this.addAll(definitions || {});
  }
  addAll(definitions) {
    for (const key of Object.keys(definitions)) this[key] = definitions[key];
  }
}

class FakeObjectList extends Array {
  constructor(owner) {
    super();
    this.owner = owner;
    this.onListChanged = { watch() {}, unwatch() {} };
  }
}

// CM3's group definitions supply position, rotation, scale, enabled and
// reflectionVisibility to every effector. Their keys come from the core text.
function effectorHost() {
  const groupKeys = core
    ? cmDefinitionKeys("PZ.object3d.group.propertyDefinitions=")
    : ["name", "enabled", "reflectionVisibility", "position", "rotation", "scale"];
  const groupDefinitions = Object.fromEntries(groupKeys.map((key) => [key, { name: key }]));
  class Group {
    constructor() {
      // CM3's group constructor adds its group definitions to the properties.
      this.properties = new FakeProperties(Group.propertyDefinitions, this);
      this.objects = new FakeObjectList(this);
      this.children = [this.properties, this.objects];
    }
  }
  Group.propertyDefinitions = groupDefinitions;
  const PZ = {
    object3d: { group: Group },
    objectList: FakeObjectList,
    propertyList: FakeProperties,
    property: { type: { NUMBER: 1, OPTION: 2, VECTOR3: 3, VECTOR2: 4, TEXT: 5 } },
  };
  return { PZ, THREE: {} };
}

test("effector tabs use the real property keys of their object classes", () => {
  const { PZ, THREE } = effectorHost();
  const classes = {
    "zoidium:repeater/repeater": effectorTest.createRepeaterClass(PZ, THREE, "step", "zoidium:repeater/repeater"),
    "zoidium:repeater/linear-repeater": effectorTest.createRepeaterClass(PZ, THREE, "linear", "zoidium:repeater/linear-repeater"),
    "zoidium:repeater/random-repeater": effectorTest.createRepeaterClass(PZ, THREE, "random", "zoidium:repeater/random-repeater"),
    "zoidium:repeater/echo-repeater": effectorTest.createRepeaterClass(PZ, THREE, "echo", "zoidium:repeater/echo-repeater"),
    "zoidium:repeater/twist": effectorTest.createTwistClass(PZ, THREE),
    "zoidium:repeater/warp": effectorTest.createWarpClass(PZ, THREE),
    "zoidium:repeater/voronoi-fracture": effectorTest.createVoronoiClass(PZ, THREE),
  };
  const specs = effectorTest.effectorAttributeSpecs();
  assert.equal(specs.length, Object.keys(classes).length, "one window per effector type");

  for (const spec of specs) {
    const Class = classes[Object.keys(classes).find((type) => spec.match({ type }))];
    assert.ok(Class, `${spec.id} matches exactly one type`);
    const object = new Class();
    for (const other of Object.keys(classes)) {
      const matches = spec.match({ type: other });
      assert.equal(matches, object.type === other, `${spec.id} match for ${other}`);
    }
    assertTabs(spec, spec.id);
    assert.equal(spec.tabs[0].title, "Coord.", `${spec.id} starts with Coord.`);
    assert.equal(spec.tabs[1].title, "Object", `${spec.id} then Object`);

    for (const tab of spec.tabs) {
      if (tab.category) {
        assert.equal(tab.category, "repeaterProperties");
        for (const key of tab.props) {
          assert.ok(object.repeaterProperties && key in object.repeaterProperties, `${spec.id} ${tab.title}: ${key}`);
        }
        assert.ok(tab.props.length > 0, `${spec.id} ${tab.title} has rows`);
        continue;
      }
      if (typeof tab.keys === "function") {
        const matched = Object.keys(object.properties).filter((key) => tab.keys(key, object.properties[key]));
        assert.ok(matched.length > 0, `${spec.id} ${tab.title} has rows`);
        assert.ok(matched.every((key) => key === "field" || key.startsWith("field")), `${spec.id} ${tab.title}`);
        continue;
      }
      assert.ok(tab.keys.length > 0, `${spec.id} ${tab.title} has rows`);
      for (const key of tab.keys) {
        assert.ok(key in object.properties, `${spec.id} ${tab.title}: ${key} is a property of ${object.type}`);
      }
    }
  }
});

test("the effector field tab covers every field property the deformers define", () => {
  const { PZ, THREE } = effectorHost();
  const object = new (effectorTest.createVoronoiClass(PZ, THREE))();
  const fieldKeys = Object.keys(object.properties).filter((key) => key.startsWith("field"));
  assert.deepEqual(fieldKeys.sort(), [
    "field", "fieldCurve", "fieldFalloff", "fieldInvert", "fieldNoiseEvolution",
    "fieldNoiseScale", "fieldPosition", "fieldRotation", "fieldScale", "fieldSweep",
  ]);
});

test("the effector family registers one window per type on activate and releases them on dispose", () => {
  const { PZ, THREE } = effectorHost();
  PZ.layer = { scene: class { update() {} prepare() {} unload() {} } };
  const ui = fakeUi();
  const disposers = [];
  scene.activate({
    PZ,
    window: { THREE },
    object3d: { registerClass: () => () => {} },
    getAsset: () => undefined,
    lifecycle: { onDispose: (callback) => disposers.push(callback) },
    ui,
  });
  assert.equal(ui.registered.length, 7, "seven effector windows");
  assert.deepEqual(
    ui.registered.map((entry) => entry.spec.id).sort(),
    ["echo-repeater", "linear-repeater", "random-repeater", "repeater", "twist", "voronoi-fracture", "warp"]
  );
  for (const entry of ui.registered) {
    assert.ok(entry.spec.persistKey.startsWith("effector-"), entry.spec.id);
    assert.ok(entry.spec.width >= 380 && entry.spec.width <= 420, entry.spec.id);
    assert.ok(entry.spec.height >= 520 && entry.spec.height <= 600, entry.spec.id);
  }
  for (const callback of disposers.reverse()) callback();
  assert.ok(ui.registered.every((entry) => entry.released), "every window released on dispose");
});

// ---------------------------------------------------------------------------
// Camera+ (plugins/camera-plus)

const cameraHarness = require("./camera-plus-harness.js");
const CAMERA_TYPE = "zoidium:camera-plus/camera";

function loadCameraRuntime() {
  const file = require.resolve("../plugins/camera-plus/camera-runtime.js");
  delete require.cache[file];
  return require(file);
}

function cameraActivation() {
  const ctx = cameraHarness.createContext();
  const ui = fakeUi();
  // The shared harness UI has no attribute-panel fake; add one without
  // changing the harness used by the other Camera+ tests.
  ctx.context.ui = Object.assign({}, ctx.context.ui, ui);
  return { ctx, ui };
}

function resolveCameraKey(object, dotted) {
  let node = object.properties;
  for (const key of dotted.split(".")) {
    if (!node) return null;
    node = node[key];
  }
  return node || null;
}

test("Camera+ registers its window on activate and releases it on dispose", () => {
  const { ctx, ui } = cameraActivation();
  const runtime = loadCameraRuntime();
  try {
    runtime.activate(ctx.context);
    assert.equal(ui.registered.length, 1, "one Camera+ window");
    const [entry] = ui.registered;
    const { spec } = entry;
    assert.equal(spec.id, "camera");
    assert.equal(spec.title, "Camera+");
    assert.equal(spec.persistKey, "camera-plus");
    assert.ok(spec.width >= 380 && spec.width <= 420, "default attribute width");
    assert.ok(spec.height >= 520 && spec.height <= 600, "default attribute height");
    assert.equal(spec.match({ type: CAMERA_TYPE }), true);
    assert.equal(spec.match({ type: "zoidium:camera-plus/other" }), false);
    assert.equal(spec.match({}), false);
    assert.equal(spec.match(null), false);
    for (const callback of ctx.disposers.reverse()) callback();
    assert.equal(entry.released, true, "window registration released on dispose");
  } finally {
    runtime.deactivate();
  }
});

test("Camera+ tabs list only real properties of the Camera+ object", () => {
  const { ctx, ui } = cameraActivation();
  const runtime = loadCameraRuntime();
  try {
    runtime.activate(ctx.context);
    const camera = ctx.registry.instantiate(CAMERA_TYPE);
    const [entry] = ui.registered;
    const { spec } = entry;
    assert.equal(spec.match(camera), true, "a real Camera+ instance matches");
    assert.deepEqual(
      spec.tabs.map((tab) => tab.title),
      ["Coord.", "Film", "Depth of Field", "Vibrate", "Motion Blur"]
    );
    const listed = [];
    for (const tab of spec.tabs) {
      assert.ok(tab.keys.length > 0, `${tab.title} has rows`);
      for (const key of tab.keys) {
        assert.ok(resolveCameraKey(camera, key), `${tab.title}: ${key} resolves on a Camera+ object`);
        listed.push(key);
      }
    }
    assert.equal(new Set(listed).size, listed.length, "no key is shown twice");
  } finally {
    runtime.deactivate();
  }
});

test("each Camera+ topic lists its rows", () => {
  const spec = loadCameraRuntime()._test.cameraAttributeSpec(CAMERA_TYPE);
  const expected = {
    "Coord.": ["position", "rotation", "eulerOrder"],
    Film: ["active", "projection", "focalLength", "filmGate", "zoom", "equivFocalLength", "fovH", "fovV", "filmOffsetX", "filmOffsetY"],
    "Depth of Field": [
      "depthOfField.enabled",
      "depthOfField.focusDistance",
      "depthOfField.aperture",
      "depthOfField.focusAreaWidth",
      "depthOfField.nearBlurLevel",
      "depthOfField.farBlurLevel",
      "depthOfField.focusTools",
    ],
    Vibrate: [
      "vibrate.enabled",
      "vibrate.regularPulse",
      "vibrate.relative",
      "vibrate.seed",
      "vibrate.enablePosition",
      "vibrate.positionAmplitude",
      "vibrate.positionFrequency",
      "vibrate.enableRotation",
      "vibrate.rotationAmplitude",
      "vibrate.rotationFrequency",
    ],
    "Motion Blur": ["motionBlur.enabled", "motionBlur.samples", "motionBlur.shutter"],
  };
  for (const tab of spec.tabs) assert.deepEqual(Array.from(tab.keys), expected[tab.title], tab.title);
});

