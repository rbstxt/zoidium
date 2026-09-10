"use strict";

// Regression test for the beta failure where Color Curves and Echo refused
// to load with "TypeError: Cannot read properties of undefined
// (reading 'call')".
//
// Native effect sources ship inside the plugin bundle while the API surface
// they run against ships in the extension shell (zoidium/plugin-apis.js).
// The two are versioned independently, so a stale cached shell can evaluate
// a newer bundle: Echo calls ZoidiumPluginApis.defineFrameSampler and Color
// Curves calls ZoidiumPluginApis.propertyControls.register, neither of which
// exists on the older shell. The plugin manager must degrade those effects
// to an explicit incompatible placeholder instead of letting effect loading
// blow up.

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
const echoSource = fs.readFileSync(
  path.join(projectRoot, "plugins/native-fx/effects/echo.js"),
  "utf8"
);
const colorcurvesSource = fs.readFileSync(
  path.join(projectRoot, "plugins/native-fx/effects/colorcurves.js"),
  "utf8"
);

function stubPropertyTypes() {
  return { NUMBER: 0, TEXT: 7, OPTION: 10 };
}

// Evaluates a real effect source exactly like the plugin manager does
// (new Function(source).call(instance)) against a chosen API surface.
function evaluateEffectSource(source, apis) {
  const sandbox = {
    ZoidiumPluginApis: apis,
    PZ: { property: { type: stubPropertyTypes() } },
    THREE: {
      Vector2: class Vector2 {
        constructor(x, y) {
          this.x = x;
          this.y = y;
        }
      },
    },
    __source: source,
    __instance: null,
    queueMicrotask,
    setTimeout,
  };
  sandbox.__instance = {
    _zoidiumGetAsset: () => null,
    properties: {
      addAll() {},
      load() {},
    },
  };
  vm.createContext(sandbox);
  return {
    instance: sandbox.__instance,
    evaluate() {
      return vm.runInContext("new Function(__source).call(__instance)", sandbox, {
        filename: "effect-under-test.js",
      });
    },
  };
}

test("a stale extension shell reproduces the reported load failure", () => {
  const staleApis = {};

  const echo = evaluateEffectSource(echoSource, staleApis);
  assert.throws(
    () => echo.evaluate(),
    /Cannot read properties of undefined \(reading 'call'\)/
  );

  const colorcurves = evaluateEffectSource(colorcurvesSource, staleApis);
  assert.throws(
    () => colorcurves.evaluate(),
    /Cannot read properties of undefined \(reading 'register'\)/
  );
});

test("matched extension APIs evaluate the real effect sources", () => {
  if (!global.PZ) {
    global.PZ = {
      property: { type: stubPropertyTypes() },
      ui: { controls: { generateTextInput() { return {}; } } },
    };
  }
  if (!global.THREE) global.THREE = {};
  if (!global.document) {
    global.document = {
      getElementById: () => null,
      createElement: () => ({}),
      head: { appendChild() {} },
    };
  }
  require("../zoidium/plugin-apis.js");
  const apis = global.ZoidiumPluginApis;
  assert.ok(apis.defineFrameSampler);
  assert.ok(apis.propertyControls);

  const cases = [
    // Frame samplers wrap update/prepare, so Echo installs the full lifecycle.
    ["echo", echoSource, "Echo", ["load", "update", "prepare", "resize", "unload", "toJSON"]],
    // Filters only install load/update/resize/unload/toJSON; Color Curves
    // has no prepare step, which is the normal defineFilter shape.
    ["colorcurves", colorcurvesSource, "Color Curves", ["load", "update", "resize", "unload", "toJSON"]],
  ];
  for (const entry of cases) {
    const name = entry[0];
    const source = entry[1];
    const defaultName = entry[2];
    const methods = entry[3];
    const effect = evaluateEffectSource(source, apis);
    effect.evaluate();
    assert.equal(effect.instance.defaultName, defaultName, name);
    for (const method of methods) {
      assert.equal(typeof effect.instance[method], "function", name + "." + method);
    }
  }
});

function loadManagerScope(apis) {
  const helpersStart = managerSource.indexOf("function nativeEffectMissingApis(");
  const registerStart = managerSource.indexOf("function registerNativeFactory(");
  const restoreStart = managerSource.indexOf("async function restoreMissingNativeEffects(");
  assert.ok(helpersStart >= 0 && registerStart > helpersStart && restoreStart > registerStart);
  const script =
    managerSource.slice(helpersStart, registerStart) + "\n" +
    managerSource.slice(registerStart, restoreStart) + "\n" +
    "__helpers = { nativeEffectMissingApis, describeNativeEffectSkew, registerNativeFactory };";
  const calls = { factories: new Map(), errors: [] };
  const sandbox = {
    ZoidiumPluginApis: apis,
    PZ: { property: { type: stubPropertyTypes() }, effect: { fnList: {} } },
    console: {
      error(...args) {
        calls.errors.push(args);
      },
    },
    setNativeFactory(type, factory, mode) {
      calls.factories.set(type, { factory, mode });
    },
    getNativeEffectMetadata(plugin, effect, type, name) {
      return {
        id: (plugin && plugin.id) || "native-fx",
        name: (plugin && plugin.name) || "Native FX",
        version: String((plugin && plugin.version) || ""),
        author: (plugin && plugin.author) || "",
        effect: (effect && effect.id) || type,
        compatibility: "incompatible",
        effectName: (effect && effect.name) || name || type,
      };
    },
    cloneJson(value) {
      return JSON.parse(JSON.stringify(value));
    },
    trackNativeEffect() {},
    untrackNativeEffect() {},
    __helpers: null,
  };
  vm.createContext(sandbox);
  vm.runInContext(script, sandbox, { filename: "plugin-manager-skew-block.js" });
  return { scope: sandbox.__helpers, calls };
}

function makeFactoryInstance() {
  const instance = { _zoidiumGetAsset: () => null, properties: {} };
  instance.properties.add = function add(id, definition) {
    instance.properties[id] = { ...definition, load() {} };
  };
  instance.properties.name = { set() {} };
  return instance;
}

const nativeFxPlugin = { id: "native-fx", name: "Native FX", version: "8", author: "Zoidium" };

test("nativeEffectMissingApis detects version skew without false positives", () => {
  const loaded = loadManagerScope({});
  // Results come from a separate vm realm, so normalize them into host
  // arrays before comparing: cross-realm prototypes fail deepStrictEqual.
  const missing = (requiresApis, apis) => Array.from(
    loaded.scope.nativeEffectMissingApis(requiresApis, apis)
  );
  assert.deepEqual(missing(["defineFrameSampler"], {}), ["defineFrameSampler"]);
  assert.deepEqual(missing(["propertyControls"], {}), ["propertyControls"]);
  assert.deepEqual(missing(["defineFrameSampler"], { defineFrameSampler() {} }), []);
  assert.deepEqual(missing(["propertyControls"], { propertyControls: {} }), []);
  assert.deepEqual(missing(undefined, {}), []);
  assert.deepEqual(missing([], {}), []);
});

test("a stale shell installs an incompatible placeholder without evaluating the effect", () => {
  const loaded = loadManagerScope({});
  loaded.scope.registerNativeFactory(
    nativeFxPlugin,
    { id: "echo", name: "Echo", requiresApis: ["defineFrameSampler"] },
    "throw new Error('stale shell must not evaluate the effect source');",
    () => null
  );
  const registration = loaded.calls.factories.get("echo");
  assert.ok(registration);
  assert.equal(registration.mode, "incompatible");
  assert.match(loaded.calls.errors.map(String).join("\n"), /Echo.*defineFrameSampler/);

  const instance = makeFactoryInstance();
  registration.factory.call(instance);
  assert.equal(instance._zoidiumIncompatibleNativeFx, true);
  assert.match(instance._zoidiumIncompatibleDetail, /Refresh/);
  const methods = ["load", "toJSON", "update", "resize", "prepare", "unload"];
  for (const method of methods) {
    assert.equal(typeof instance[method], "function", method);
  }
  instance.load({ type: "echo", properties: {} });
  assert.deepEqual(instance.toJSON(), { type: "echo", properties: {} });
  instance.unload();
});

test("an unexpected evaluation failure degrades instead of throwing", () => {
  const loaded = loadManagerScope({ defineFrameSampler() {} });
  loaded.scope.registerNativeFactory(
    nativeFxPlugin,
    { id: "echo", name: "Echo" },
    "throw new Error('boom');",
    () => null
  );
  const registration = loaded.calls.factories.get("echo");
  assert.ok(registration);
  assert.equal(registration.mode, "native");

  const instance = makeFactoryInstance();
  assert.doesNotThrow(() => registration.factory.call(instance));
  assert.equal(instance._zoidiumIncompatibleNativeFx, true);
  assert.match(instance._zoidiumIncompatibleDetail, /boom/);
});

test("a healthy effect still registers normally", () => {
  const loaded = loadManagerScope({ defineFrameSampler() {}, propertyControls: {} });
  loaded.scope.registerNativeFactory(
    nativeFxPlugin,
    { id: "echo", name: "Echo", requiresApis: ["defineFrameSampler"] },
    "this.loadedByManager = true;",
    () => null
  );
  const registration = loaded.calls.factories.get("echo");
  assert.ok(registration);
  assert.equal(registration.mode, "native");

  const instance = makeFactoryInstance();
  instance.load = () => {};
  instance.unload = () => {};
  registration.factory.call(instance);
  assert.equal(instance.loadedByManager, true);
  assert.equal(instance._zoidiumIncompatibleNativeFx, undefined);
});

test("Color Curves and Echo declare the extension APIs they need", () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "plugins/native-fx/manifest.json"), "utf8")
  );
  const byId = Object.fromEntries(
    manifest.nativeEffects.map((effect) => [effect.id, effect])
  );
  assert.deepEqual(byId.echo.requiresApis, ["defineFrameSampler"]);
  assert.deepEqual(byId.colorcurves.requiresApis, ["propertyControls"]);
});
