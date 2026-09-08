"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const PbrPlus = require("../plugins/material-plus/pbr-plus");

function vector2() {
  return {
    x: 0,
    y: 0,
    set(x, y) {
      this.x = x;
      this.y = y;
    },
  };
}

function color() {
  return {
    r: 1,
    g: 1,
    b: 1,
    setRGB(r, g, b) {
      this.r = r;
      this.g = g;
      this.b = b;
    },
  };
}

class Texture {
  constructor() {
    this.repeat = vector2();
    this.offset = vector2();
    this.center = vector2();
    this.rotation = 0;
    this.needsUpdate = false;
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
  }
}

class MeshStandardMaterial {
  constructor(options) {
    Object.assign(this, options);
    this.color = color();
    this.emissive = color();
    this.normalScale = vector2();
    this.needsUpdate = false;
    this.map = null;
    this.emissiveMap = null;
    this.roughnessMap = null;
    this.metalnessMap = null;
    this.normalMap = null;
    this.alphaMap = null;
    this.envMap = null;
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
  }
}

function createHarness() {
  const tracked = [];
  const untracked = [];
  const unloaded = [];
  const environmentTexture = new Texture();
  let environmentGets = 0;
  let environmentReleases = 0;

  class ImageAsset {
    constructor(asset) {
      this.asset = asset;
      this.loading = Promise.resolve();
    }

    getTexture() {
      return new Texture();
    }
  }

  const PZ = {
    material: { fnList: {} },
    asset: {
      type: { IMAGE: "image" },
      image: ImageAsset,
    },
    property: {
      type: {
        ASSET: "asset",
        COLOR: "color",
        NUMBER: "number",
        OPTION: "option",
        VECTOR2: "vector2",
      },
    },
    zoidium: {
      trackPluginMaterial(material, metadata) {
        tracked.push({ material, metadata });
      },
      untrackPluginMaterial(material) {
        untracked.push(material);
      },
    },
  };

  const THREE = {
    MeshStandardMaterial,
    ClampToEdgeWrapping: 1001,
    RepeatWrapping: 1002,
    MirroredRepeatWrapping: 1003,
    NoBlending: 2001,
    NormalBlending: 2002,
    AdditiveBlending: 2003,
    SubtractiveBlending: 2004,
    MultiplyBlending: 2005,
    FrontSide: 3001,
    BackSide: 3002,
    DoubleSide: 3003,
  };

  const project = {
    assets: {
      load(value) {
        return { value };
      },
      unload(asset) {
        unloaded.push(asset);
      },
    },
  };

  function createEnvironmentMap(texture) {
    return {
      getTexture() {
        environmentGets += 1;
        return texture;
      },
      releaseTexture() {
        environmentReleases += 1;
      },
    };
  }

  const layer = { envMap: createEnvironmentMap(environmentTexture) };

  return {
    PZ,
    THREE,
    project,
    layer,
    tracked,
    untracked,
    unloaded,
    environmentTexture,
    createEnvironmentMap,
    get environmentGets() {
      return environmentGets;
    },
    get environmentReleases() {
      return environmentReleases;
    },
  };
}

function createProperty(definition, material) {
  let value = definition.objects
    ? definition.objects.map((object) => object.value)
    : definition.value;
  return {
    definition,
    parentObject: material,
    get() {
      return value;
    },
    set(nextValue) {
      value = nextValue;
      this.value = nextValue;
      definition.changed?.call(this);
    },
    value,
  };
}

async function createMaterial(harness, data) {
  const factory = await harness.PZ.material.fnList.pbrplus;
  const material = {
    properties: {
      addAll(definitions) {
        for (const [name, definition] of Object.entries(definitions)) {
          this[name] = createProperty(definition, material);
        }
      },
      load() {},
    },
    parentProject: harness.project,
    parentLayer: harness.layer,
  };
  factory.call(material);
  material.load(data);
  return material;
}

test("registers PBR+ as an independent material factory", async () => {
  const harness = createHarness();
  const previous = () => {};
  harness.PZ.material.fnList.pbrplus = previous;

  PbrPlus.activate({ PZ: harness.PZ, window: { THREE: harness.THREE }, plugin: { id: "material-plus", version: "2" } });
  assert.notEqual(harness.PZ.material.fnList.pbrplus, previous);
  assert.equal(harness.PZ.material.fnList.pbrplus._zoidiumMaterialMode, "native");

  PbrPlus.deactivate();
  assert.equal(harness.PZ.material.fnList.pbrplus, previous);

  PbrPlus.activate({ PZ: harness.PZ, window: { THREE: harness.THREE } });
  assert.ok(harness.PZ.material.fnList.pbrplus);
  PbrPlus.deactivate();
});

test("creates a MeshStandardMaterial with animatable PBR controls and map slots", async () => {
  const harness = createHarness();
  PbrPlus.activate({ PZ: harness.PZ, window: { THREE: harness.THREE } });
  const material = await createMaterial(harness);

  assert.ok(material.threeObj instanceof MeshStandardMaterial);
  assert.equal(material.defaultName, "PBR+ Material");
  assert.equal(material.properties.roughness.definition.dynamic, true);
  assert.equal(material.properties.metalness.definition.dynamic, true);
  assert.equal(material.properties.emissiveIntensity.definition.dynamic, true);
  assert.equal(material.properties.texture.definition.name, "Texture (Base color)");
  assert.equal(material.properties.roughnessMap.definition.type, "asset");
  assert.equal(material.properties.normalMap.definition.type, "asset");
  assert.equal(material.properties.alphaMap.definition.type, "asset");
  assert.equal(harness.tracked[0].metadata.material, "pbrplus");

  material.properties.roughness.get = () => 0.25;
  material.properties.metalness.get = () => 0.75;
  material.properties.emissiveIntensity.get = () => 2;
  material.properties.normalScale.get = () => 1.5;
  material.properties.reflectionIntensity.get = () => 0.4;
  material.properties.opacity.get = () => 0.6;
  material.update(24);

  assert.equal(material.threeObj.roughness, 0.25);
  assert.equal(material.threeObj.metalness, 0.75);
  assert.equal(material.threeObj.emissiveIntensity, 2);
  assert.equal(material.threeObj.normalScale.x, 1.5);
  assert.equal(material.threeObj.envMapIntensity, 0.4);
  assert.equal(material.threeObj.opacity, 0.6);

  material.unload();
  assert.equal(material.threeObj, null);
  assert.equal(harness.untracked.length, 1);
  PbrPlus.deactivate();
});

test("loads maps, applies shared UV settings, and balances environment references", async () => {
  const harness = createHarness();
  PbrPlus.activate({ PZ: harness.PZ, window: { THREE: harness.THREE } });
  const material = await createMaterial(harness);

  material.properties.reflection.value = 1;
  material.properties.repeat.get = () => [2, 3];
  material.properties.offset.get = () => [0.1, 0.2];
  material.properties.center.get = () => [0.3, 0.4];
  material.properties.rotation.get = () => Math.PI / 4;
  material.properties.texture.set("base-texture");
  material.properties.roughnessMap.set("roughness-texture");
  material.update(12);

  assert.equal(material.threeObj.map !== null, true);
  assert.equal(material.threeObj.roughnessMap !== null, true);
  assert.equal(material.threeObj.map.repeat.x, 2);
  assert.equal(material.threeObj.map.repeat.y, 3);
  assert.equal(material.threeObj.map.offset.x, 0.1);
  assert.equal(material.threeObj.map.offset.y, 0.2);
  assert.equal(material.threeObj.map.center.x, 0.3);
  assert.equal(material.threeObj.map.center.y, 0.4);
  assert.equal(material.threeObj.map.rotation, Math.PI / 4);

  material.properties.reflection.set(1);
  assert.equal(material.threeObj.envMap, harness.environmentTexture);
  assert.equal(harness.environmentGets, 1);
  material.update(13);
  assert.equal(harness.environmentGets, 1);

  const replacementEnvironmentTexture = new Texture();
  harness.layer.envMap = harness.createEnvironmentMap(replacementEnvironmentTexture);
  material.update(14);
  assert.equal(material.threeObj.envMap, replacementEnvironmentTexture);
  assert.equal(harness.environmentGets, 2);
  assert.equal(harness.environmentReleases, 1);

  material.unload();
  assert.equal(harness.environmentReleases, 2);
  assert.equal(harness.unloaded.length, 2);
  PbrPlus.deactivate();
});
