"use strict";

// Determinism and wiring coverage for the OpenZoid Legacy pack: Echo (Legacy)
// and Posterize Time (Legacy) on the core temporal APIs, Jpeg Damage's shader
// assets and disposal, and static checks on the pack's sources and manifest.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const legacyDir = path.join(projectRoot, "plugins/openzoid-legacy");
const read = (file) => fs.readFileSync(path.join(legacyDir, file), "utf8");

const PZ_TYPES = { NUMBER: 1, OPTION: 2, TEXT: 3, COLOR: 7 };

// Real plugin API layer, evaluated in a sandbox like the browser global.
function loadPluginApis() {
  const sandbox = { PZ: { property: { type: PZ_TYPES } }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(projectRoot, "zoidium/plugin-apis.js"), "utf8"), sandbox);
  return { apis: sandbox.ZoidiumPluginApis, PZ: sandbox.PZ };
}

// Property container: addAll records definitions; overrides set the value a
// frame-independent get() returns.
function fakeEffect(overrides) {
  const effect = {
    properties: {
      addAll(defs) {
        for (const key of Object.keys(defs)) {
          const def = defs[key];
          const value = key in overrides ? overrides[key] : def.value;
          this[key] = { get: () => value, def };
        }
      },
      load() {},
    },
  };
  return effect;
}

function evaluateEffect(file, effect, apis, PZ) {
  const source = read(file);
  const THREE = {};
  new Function("PZ", "THREE", "ZoidiumPluginApis", source).call(effect, PZ, THREE, apis);
  return effect;
}

test("echo legacy declares its frame sampler and keeps its property ids", () => {
  const { apis, PZ } = loadPluginApis();
  const echo = evaluateEffect("effects/echo-legacy.js", fakeEffect({}), apis, PZ);
  assert.equal(echo.defaultName, "Echo (Legacy)");
  assert.ok(echo._zoidiumFrameSampler, "registered as a core frame sampler");
  for (const key of ["enabled", "mode", "echoes", "decay", "strength", "threshold"]) {
    assert.ok(echo.properties[key], "property " + key);
  }
  assert.equal(echo.properties.echoes.def.max, 16, "core sampler limit");
  assert.equal(typeof echo.load, "function");
  assert.equal(typeof echo.prepare, "function");
});

test("echo legacy requests earlier frames with the legacy decay weights", () => {
  const { apis, PZ } = loadPluginApis();
  const echo = evaluateEffect("effects/echo-legacy.js", fakeEffect({}), apis, PZ);
  const request = echo._zoidiumFrameSampler.getRequest(echo, 10);
  assert.deepEqual(request, {
    enabled: true,
    count: 6,
    offsetFrames: -1,
    startOpacity: 0.88,
    decay: 0.88,
  });
  // Sample k gets startOpacity * decay^(k-1) = decay^k, the legacy weight.
  assert.ok(Math.abs(request.startOpacity * Math.pow(request.decay, 2) - Math.pow(0.88, 3)) < 1e-12);
});

test("echo legacy request is a pure function of the frame", () => {
  const { apis, PZ } = loadPluginApis();
  const echo = evaluateEffect("effects/echo-legacy.js", fakeEffect({ echoes: 40 }), apis, PZ);
  const sampler = echo._zoidiumFrameSampler;
  const first = sampler.getRequest(echo, 10);
  sampler.getRequest(echo, 3);
  sampler.getRequest(echo, 99);
  assert.deepEqual(sampler.getRequest(echo, 10), first, "same frame, same request");
  assert.equal(first.count, 16, "echo count is capped by the core sampler");
});

test("echo legacy is disabled when it has no echoes or no strength", () => {
  const { apis, PZ } = loadPluginApis();
  const none = evaluateEffect("effects/echo-legacy.js", fakeEffect({ echoes: 0 }), apis, PZ);
  assert.equal(none._zoidiumFrameSampler.getRequest(none, 0).enabled, false);
  const weak = evaluateEffect("effects/echo-legacy.js", fakeEffect({ strength: 0 }), apis, PZ);
  assert.equal(weak._zoidiumFrameSampler.getRequest(weak, 0).enabled, false);
  const off = evaluateEffect("effects/echo-legacy.js", fakeEffect({ enabled: 0 }), apis, PZ);
  assert.equal(off._zoidiumFrameSampler.getRequest(off, 0).enabled, false);
});

test("posterize time legacy is a core temporal operator with its saved property ids", () => {
  const { apis, PZ } = loadPluginApis();
  const posterize = evaluateEffect("effects/posterizetime-legacy.js", fakeEffect({ frameRate: 12 }), apis, PZ);
  assert.equal(posterize.defaultName, "Posterize Time (Legacy)");
  assert.equal(posterize._zoidiumTemporal.kind, "posterize-time");
  assert.ok(posterize.properties.frameRate, "saved Frame Rate property kept");
  assert.ok(posterize.properties.enabled, "saved Enabled property kept");
  assert.deepEqual(posterize._zoidiumTemporal.getOperator(posterize, 4), {
    kind: "posterize-time",
    enabled: true,
    fps: 12,
  });
  const degenerate = evaluateEffect("effects/posterizetime-legacy.js", fakeEffect({ frameRate: 0 }), apis, PZ);
  assert.equal(degenerate._zoidiumTemporal.getOperator(degenerate, 0).fps, 1);
  assert.equal(posterize.pass, undefined, "no held buffer or shader pass");
});

function fakeJpegEnvironment() {
  const disposed = [];
  const created = [];
  const unloaded = [];
  const THREE = {
    Vector2: function (x, y) { this.x = x; this.y = y; this.set = (x, y) => { this.x = x; this.y = y; }; },
    ShaderMaterial: function (opts) {
      this.uniforms = opts.uniforms;
      this.defines = opts.defines || {};
      this.vertexShader = opts.vertexShader;
      this.fragmentShader = opts.fragmentShader;
      this.dispose = () => disposed.push("material");
    },
    ShaderPass: function (material) {
      this.material = material;
      this.uniforms = material.uniforms;
      this.render = () => {};
      this.enabled = true;
      this.quad = { geometry: { dispose: () => disposed.push("geometry") } };
    },
  };
  THREE.DataTexture = function () { this.dispose = () => disposed.push("texture"); };
  THREE.WebGLRenderTarget = function () { this.texture = {}; this.dispose = () => disposed.push("target"); };
  const PZ = {
    property: { type: PZ_TYPES },
    expression: function () {},
    asset: {
      type: { SHADER: "shader" },
      shader: function (asset) { this.asset = asset; this.getShader = async () => asset.source; },
    },
  };
  const effect = fakeEffect({});
  effect.parentProject = {
    assets: {
      createFromPreset(type, url) { created.push(url); return { url, source: "host:" + url }; },
      load(asset) { return asset; },
      unload(shader) { unloaded.push(shader.asset.url); },
    },
  };
  effect._zoidiumGetAsset = (kind, url) => (url.endsWith("fx_jpegdamage.glsl") ? "bundled-frag" : undefined);
  return { effect, THREE, PZ, disposed, created, unloaded };
}

test("jpeg damage takes its vertex shader from the host asset pipeline", async () => {
  const env = fakeJpegEnvironment();
  new Function("PZ", "THREE", "ZoidiumPluginApis", read("effects/jpegdamage.js")).call(
    env.effect, env.PZ, env.THREE, null
  );
  await env.effect.load({});
  assert.deepEqual(env.created, ["/assets/shaders/vertex/common.glsl"], "host vertex asset");
  assert.equal(env.effect.pass.material.vertexShader, "host:/assets/shaders/vertex/common.glsl");
  assert.equal(env.effect.pass.material.fragmentShader, "bundled-frag");
  await env.effect.prepare();
});

test("jpeg damage disposes its material and geometry on unload", async () => {
  const env = fakeJpegEnvironment();
  new Function("PZ", "THREE", "ZoidiumPluginApis", read("effects/jpegdamage.js")).call(
    env.effect, env.PZ, env.THREE, null
  );
  await env.effect.load({});
  env.effect.unload();
  assert.deepEqual(env.disposed.sort(), ["geometry", "material", "material", "material", "material", "target", "target", "texture"]);
  assert.equal(env.effect.pass, null);
  assert.deepEqual(env.unloaded, ["/assets/shaders/vertex/common.glsl"]);
});

test("pack effects and windows have no nondeterministic inputs in their sources", () => {
  for (const file of [
    "effects/ascii.js",
    "effects/tracery.js",
    "effects/echo-legacy.js",
    "effects/posterizetime-legacy.js",
    "effects/jpegdamage.js",
    "effect-windows.js",
  ]) {
    const source = read(file);
    assert.ok(!/Math\.random|Date\.now|performance\.now/.test(source), file + " uses a clock or random source");
    assert.ok(!/requestAnimationFrame/.test(source), file + " depends on frame callbacks");
    assert.ok(!/\bInter\b/.test(source), file + " uses the Inter font");
  }
});

test("jpeg damage no longer carries a copy of the host vertex shader", () => {
  const source = read("effects/jpegdamage.js");
  assert.ok(source.includes("/assets/shaders/vertex/common.glsl"));
  assert.ok(!fs.existsSync(path.join(legacyDir, "shaders/common.glsl")), "bundled common.glsl removed");
  assert.ok(!fs.existsSync(path.join(legacyDir, "shaders/fx_posterizetime.glsl")), "posterize shader removed");
});

test("manifest declares only existing sources and stable effect ids", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.version, "14");
  assert.deepEqual(
    manifest.nativeEffects.map((e) => e.id),
    ["echo-legacy", "posterizetime-legacy", "jpegdamage", "vhs", "datamosh", "tracery", "ascii"]
  );
  const echo = manifest.nativeEffects.find((e) => e.id === "echo-legacy");
  assert.deepEqual(echo.requiresApis, ["defineFrameSampler"]);
  const entries = [
    ...manifest.nativeEffects.map((e) => e.source),
    ...manifest.modules.map((m) => m.source),
    ...manifest.resources.map((r) => r.source),
  ];
  for (const source of entries) {
    const file = source.split("?")[0].replace(/^\.\//, "");
    assert.ok(fs.existsSync(path.join(projectRoot, file)), "missing source " + file);
  }
  const removed = ["ascii-setup", "tracery-setup", "common-vertex", "posterizetime-shader", "ascii-style", "tracery-style"];
  const ids = [...manifest.modules, ...manifest.resources].map((x) => x.id);
  for (const id of removed) assert.ok(!ids.includes(id), id + " removed");
  assert.ok(ids.includes("effect-windows"), "shared window module declared");
  assert.ok(ids.includes("datamosh-export"), "true-mosh export module declared");
  assert.ok(ids.includes("datamosh-render"), "true-mosh renderer bundled");
  const text = JSON.stringify(manifest);
  assert.ok(!/\bInter\b|tracery-font|fullscreen|logo/i.test(text), "no removed theme assets referenced");
});

test("pack description is English and describes the current behaviour", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.ok(!/history-buffer/i.test(manifest.nativeEffects.find((e) => e.id === "echo-legacy").description));
  assert.ok(/^[\x00-\x7f]*$/.test(manifest.description), "ASCII-only description");
});


test("Echo Legacy supplies a sequence when the host omits the preparation context", async () => {
  const { apis, PZ } = loadPluginApis();
  const sequence = {};
  let received;
  PZ.zoidium = { temporal: { prepareFrameSamples: async (_effect, _frame, context) => { received = context; } } };
  const effect = fakeEffect({});
  effect.parentProject = { sequence };
  const echo = evaluateEffect("effects/echo-legacy.js", effect, apis, PZ);
  await echo.prepare(12);
  assert.equal(received.sequence, sequence);
});
