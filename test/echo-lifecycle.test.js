"use strict";

// Load / unload / load coverage for Echo (Legacy) and Echo (Native).
// CM3 deletes an effect by calling unload() on it, and Undo rebuilds it with
// a fresh instance whose load() receives the old, unloaded instance as its
// data (plugins/core/ui: PZ.ui.edit.createObject / deleteObject). The restored
// effect must have a pass, the same property values, and the same request.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const projectRoot = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(projectRoot, file), "utf8");

const PZ_TYPES = { NUMBER: 1, OPTION: 2, TEXT: 3 };

function loadPluginApis() {
  const sandbox = { PZ: { property: { type: PZ_TYPES } }, console };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(read("zoidium/plugin-apis.js"), sandbox);
  return sandbox.ZoidiumPluginApis;
}

// Property with CM3's static load semantics: undefined restores the default,
// and a property-like source (or a raw value) supplies the value.
function makeProperty(definition) {
  let value = definition.value;
  return {
    definition,
    get() {
      return value;
    },
    set(next) {
      value = next;
    },
    load(source) {
      if (source === undefined) value = definition.value;
      else if (source && typeof source.get === "function") value = source.get();
      else value = source;
    },
  };
}

function makePropertyList() {
  const properties = {};
  const list = {};
  Object.defineProperties(list, {
    addAll: {
      value(definitions) {
        for (const key of Object.keys(definitions)) {
          properties[key] = makeProperty(definitions[key]);
          Object.defineProperty(list, key, { value: properties[key], enumerable: true });
        }
      },
    },
    load: {
      value(source) {
        for (const key of Object.keys(properties)) {
          properties[key].load(source ? source[key] : undefined);
        }
      },
    },
  });
  return list;
}

function fakeTHREE() {
  class Vector2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y) {
      this.x = x;
      this.y = y;
      return this;
    }
  }
  class WebGLRenderTarget {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.texture = {};
      this.disposed = 0;
    }
    setSize(width, height) {
      this.width = width;
      this.height = height;
    }
    dispose() {
      this.disposed += 1;
    }
  }
  class ShaderMaterial {
    constructor(options) {
      Object.assign(this, options);
      this.defines = Object.assign({}, options.defines);
      this.disposed = 0;
    }
    dispose() {
      this.disposed += 1;
    }
  }
  class ShaderPass {
    constructor(material) {
      this.material = material;
      this.uniforms = material.uniforms;
      this.enabled = true;
    }
  }
  class PlaneBufferGeometry {
    constructor() {
      this.disposed = 0;
    }
    dispose() {
      this.disposed += 1;
    }
  }
  return {
    Vector2,
    WebGLRenderTarget,
    ShaderMaterial,
    ShaderPass,
    PlaneBufferGeometry,
    Mesh: class {
      constructor(geometry, material) {
        this.geometry = geometry;
        this.material = material;
      }
    },
    Scene: class {
      add() {}
    },
    OrthographicCamera: class {},
    LinearFilter: 1,
    RGBAFormat: 1,
    UniformsUtils: { clone: (uniforms) => JSON.parse(JSON.stringify(uniforms)) },
    CopyShader: {
      uniforms: { tDiffuse: { value: null }, opacity: { value: 1 } },
      vertexShader: "void main() {}",
      fragmentShader: "void main() {}",
    },
  };
}

// Mirrors what CM3 provides to an effect: a PZ.effect-like object with a
// property list, a parent project with assets, and the plugin manager's
// bundle asset getter.
function makeEffect(type) {
  return {
    type,
    properties: makePropertyList(),
    parentProject: {
      assets: {
        createFromPreset: () => ({}),
        load: () => ({}),
      },
    },
    _zoidiumGetAsset: (kind, url) =>
      url.endsWith("fx_echo.glsl") ? "void main() {}" : undefined,
  };
}

function makePZ() {
  return {
    property: { type: PZ_TYPES },
    asset: {
      type: { SHADER: 1 },
      shader: class {
        async getShader() {
          return "void main() {}";
        }
      },
    },
  };
}

// Emulates PZ.effect.load for a factory file: the factory runs against the
// instance, then the instance's own load(data) is awaited.
async function instantiate(apis, file, type, data) {
  const effect = makeEffect(type);
  const sandbox = { PZ: makePZ(), THREE: fakeTHREE(), ZoidiumPluginApis: apis };
  const factory = new vm.Script("(function () {" + read(file) + "\n})", { filename: file })
    .runInContext(vm.createContext(sandbox));
  factory.call(effect);
  await effect.load(data);
  return effect;
}

function values(effect) {
  const out = {};
  for (const key of Object.keys(effect.properties)) {
    out[key] = effect.properties[key].get();
  }
  return out;
}

test("native echo: undo rebuilds the pass and restores the old values", async () => {
  const apis = loadPluginApis();
  const first = await instantiate(apis, "plugins/native-fx/effects/echo.js", "echo");
  assert.ok(first.pass, "pass exists after load");
  first.properties.echoes.set(4);
  first.properties.opacity.set(0.6);
  const request = JSON.parse(JSON.stringify(first._zoidiumFrameSampler.getRequest(first, 40)));

  // Delete: CM3 calls unload on the instance it removes from the layer.
  const firstMaterials = [first._zoidiumEchoBlendMaterial, first._zoidiumEchoCopyMaterial];
  first.unload();
  assert.equal(first.pass, null, "unload clears the pass");
  assert.ok(firstMaterials.every((material) => material.disposed === 1), "unload disposes its materials");

  // Undo: a fresh instance is loaded from the unloaded one.
  const restored = await instantiate(apis, "plugins/native-fx/effects/echo.js", "echo", first);
  assert.ok(restored.pass, "restored effect has a pass");
  assert.deepEqual(values(restored), values(first), "restored values equal the values before delete");
  assert.equal(restored.properties.echoes.get(), 4);
  assert.equal(restored.properties.opacity.get(), 0.6);
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored._zoidiumFrameSampler.getRequest(restored, 40))),
    request,
    "restored request matches the original",
  );
  restored.update(40);
  assert.equal(restored.pass.enabled, true, "restored pass is enabled by the restored values");
  assert.ok(
    firstMaterials.every((material) => material !== restored._zoidiumEchoBlendMaterial),
    "restored effect owns new materials",
  );
});

test("native echo: load, unload, load on one instance rebuilds the pass", async () => {
  const apis = loadPluginApis();
  const echo = await instantiate(apis, "plugins/native-fx/effects/echo.js", "echo");
  echo.unload();
  assert.equal(echo.pass, null);
  await echo.load(undefined);
  assert.ok(echo.pass, "pass is rebuilt by a second load");
  assert.equal(echo.properties.echoes.get(), 4, "defaults are restored");
});

test("legacy echo: undo rebuilds the pass and restores the old values", async () => {
  const apis = loadPluginApis();
  const first = await instantiate(apis, "plugins/openzoid-legacy/effects/echo-legacy.js", "echo-legacy");
  await first._zoidiumLoading;
  assert.ok(first.pass, "pass exists after load");
  first.properties.decay.set(0.5);
  first.properties.mode.set(2);
  const request = JSON.parse(JSON.stringify(first._zoidiumFrameSampler.getRequest(first, 40)));
  const firstState = first._zoidiumEcho;

  first.unload();
  assert.equal(first.pass, null, "unload clears the pass");
  assert.equal(first._zoidiumEcho, null, "unload clears the state");
  assert.ok(firstState.stepMaterial.disposed === 1 && firstState.mixMaterial.disposed === 1,
    "unload disposes its materials");
  assert.equal(firstState.quad.geometry.disposed, 1, "unload disposes its geometry");

  const restored = await instantiate(
    apis,
    "plugins/openzoid-legacy/effects/echo-legacy.js",
    "echo-legacy",
    first,
  );
  await restored._zoidiumLoading;
  assert.ok(restored.pass, "restored effect has a pass once its load settles");
  assert.equal(restored.properties.decay.get(), 0.5);
  assert.equal(restored.properties.mode.get(), 2);
  assert.deepEqual(
    JSON.parse(JSON.stringify(restored._zoidiumFrameSampler.getRequest(restored, 40))),
    request,
    "restored request matches the original",
  );
  restored.update(40);
  assert.equal(restored.pass.enabled, true, "restored pass is enabled by the restored values");
  assert.equal(restored._zoidiumEcho.stepMaterial.defines.ECHO_MODE, 2, "restored mode is applied");
});

test("legacy echo: the restored instance does not share state with the unloaded one", async () => {
  const apis = loadPluginApis();
  const first = await instantiate(apis, "plugins/openzoid-legacy/effects/echo-legacy.js", "echo-legacy");
  await first._zoidiumLoading;
  first.unload();
  const restored = await instantiate(
    apis,
    "plugins/openzoid-legacy/effects/echo-legacy.js",
    "echo-legacy",
    first,
  );
  await restored._zoidiumLoading;
  assert.notEqual(restored._zoidiumEcho, first._zoidiumEcho);
  assert.notEqual(restored.pass, first.pass);
  assert.equal(first.pass, null, "the unloaded instance stays unloaded");
});
