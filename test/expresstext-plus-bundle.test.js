"use strict";

// ExpressText+ ships as a bundle of split modules. This test loads the real
// built bundle through a loader with the same path semantics as
// ZoidiumPluginApis.modules.createRequire (root guard, per-loader cache,
// relative resolution against the requiring file) and activates it, so a
// missing manifest resource or a bad cross-part require fails here instead
// of in the browser.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { fakePZ } = require("./expresstext-plus-helpers.js");

const projectRoot = path.resolve(__dirname, "..");
const bundle = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "plugins/expresstext-plus/bundle.json"), "utf8")
);

function assetKey(url) {
  return `/${String(url || "").split(/[?#]/, 1)[0].replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "")}`;
}

function normalizeModulePath(value) {
  const parts = [];
  for (const part of String(value).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) throw new Error(`Module path leaves the bundle: ${value}`);
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `./${parts.join("/")}`;
}

// Mirrors the bundle loader: files run as
// function (module, exports, require), require resolves against the
// requiring file and never leaves root.
function createBundleRequire(assets, root) {
  const base = normalizeModulePath(root || "./") + "/";
  const cache = Object.create(null);
  function resolve(id, fromDir) {
    const full = String(id).startsWith("./plugins/")
      ? normalizeModulePath(id)
      : normalizeModulePath(fromDir + id);
    if (!full.startsWith(base)) throw new Error(`Module is outside ${base}: ${id}`);
    return full;
  }
  function load(id, fromDir) {
    const assetPath = resolve(id, fromDir);
    if (cache[assetPath]) return cache[assetPath].exports;
    const source = assets[assetKey(assetPath)];
    if (typeof source !== "string") throw new Error(`Bundle is missing module ${assetPath}`);
    const module = { id: assetPath, exports: {} };
    cache[assetPath] = module;
    const dir = assetPath.slice(0, assetPath.lastIndexOf("/") + 1);
    const localRequire = (next) => load(next, dir);
    // eslint-disable-next-line no-new-func
    const factory = new Function("module", "exports", "require", `${source}\n//# sourceURL=${assetPath.slice(1)}`);
    factory(module, module.exports, localRequire);
    return module.exports;
  }
  return (id) => load(id, base);
}

function loadEntry() {
  const assets = bundle.assets.text;
  const getAsset = (kind, url) => (kind === "text" ? assets[assetKey(url)] : undefined);
  const context = {
    apis: {
      modules: {
        createRequire: (resolver, options) =>
          createBundleRequire(bundle.assets.text, options && options.root),
      },
    },
    getAsset,
  };
  const entrySource = assets[assetKey("./plugins/expresstext-plus/expresstext.js")];
  assert.equal(typeof entrySource, "string", "bundle embeds the entry module");
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  const factory = new Function("module", "exports", "plugin", entrySource);
  factory(module, module.exports, {});
  assert.equal(typeof module.exports.activate, "function", "bundle entry activates");
  return { runtime: module.exports, context };
}

test("the built bundle binds every part and exposes the effector engine", () => {
  const { runtime, context } = loadEntry();
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = fakePZ();
  PZ.object3d = { ...PZ.object3d, group: function FakeGroup() {}, text: TextObject };
  PZ.propertyList = function FakePropertyList() {};
  PZ.objectList = function FakeList() {};
  const host = {
    ...context,
    PZ,
    editor: null,
    window: { THREE: { TextGeometry: function () {} } },
    object3d: { registerClass: () => () => {} },
  };
  runtime.activate(host);
  try {
  for (const name of [
    "evaluateStack",
    "evaluateShake",
    "evaluatePlain",
    "evaluateRandom",
    "evaluateFormula",
    "evaluateSpline",
    "evaluateOrbit",
    "evaluateTwist",
    "evaluateWrap",
    "runDelayLetterStage",
    "simulateDelayLetter",
    "compileFormula",
    "splitVoronoiCells",
    "EFFECTOR_ORDER",
    "createExpressObjectClass",
  ]) {
    assert.notEqual(runtime._test[name], undefined, `_test carries ${name}`);
  }
  assert.deepEqual(runtime._test.EFFECTOR_ORDER, [
    "shake", "plain", "random", "formula", "delay", "spline",
    "orbit", "repeater", "twist", "wrap", "voronoi",
  ]);
  } finally {
    runtime.deactivate();
  }
});

test("the bundled plugin activates and deactivates against the host API", () => {
  const { runtime, context } = loadEntry();
  function TextObject() {}
  TextObject.prototype.update = function () {};
  const PZ = fakePZ();
  PZ.object3d = { ...PZ.object3d, group: function FakeGroup() {}, text: TextObject };
  PZ.propertyList = function FakePropertyList() {};
  PZ.objectList = function FakeList() {};
  const registered = [];
  const host = {
    ...context,
    PZ,
    editor: null,
    window: { THREE: { TextGeometry: function () {} } },
    object3d: {
      registerClass(def) {
        registered.push(def);
        return () => {};
      },
    },
  };
  runtime.activate(host);
  try {
    assert.deepEqual(
      registered.map((entry) => entry.type),
      ["zoidium:expresstext-plus/expresstext"]
    );
  } finally {
    runtime.deactivate();
  }
});
