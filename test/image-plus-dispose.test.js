"use strict";

// Fix test for A16: Image+ tracks live materials and releases them (UV
// layout release plus texture dispose) when the plugin is disabled.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const ImagePlus = require("../plugins/material-plus/image-plus.js");

function vector2() {
  return { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } };
}

function harness() {
  const textures = [];
  const unloaded = [];
  const disposers = [];
  class FakeTexture {
    constructor() {
      this.repeat = vector2();
      this.offset = vector2();
      this.center = vector2();
      this.rotation = 0;
      this.disposed = false;
      textures.push(this);
    }
    dispose() { this.disposed = true; }
  }
  const THREE = {
    MeshBasicMaterial: class {
      constructor(options) { Object.assign(this, options); this.map = null; this.needsUpdate = false; }
      dispose() { this.disposed = true; }
    },
    FrontSide: 0,
    BackSide: 1,
    DoubleSide: 2,
    ClampToEdgeWrapping: 1001,
    RepeatWrapping: 1002,
    MirroredRepeatWrapping: 1003,
  };
  const PZ = {
    material: { fnList: {} },
    asset: {
      type: { IMAGE: "image" },
      image: class {
        constructor(asset) { this.asset = asset; this.loading = Promise.resolve(); }
        getTexture() { return new FakeTexture(); }
      },
    },
    property: { type: { ASSET: "asset", OPTION: "option", NUMBER: "number", VECTOR2: "vector2" } },
  };
  const context = {
    PZ,
    window: { PZ, THREE },
    plugin: { id: "material-plus", version: "11" },
    lifecycle: { onDispose(fn) { disposers.push(fn); } },
    getAsset(kind, name) {
      return fs.readFileSync(require.resolve("../plugins/material-plus/uv-layout.js"), "utf8");
    },
  };
  const project = {
    assets: {
      load: (key) => ({ key }),
      unload: (asset) => unloaded.push(asset),
    },
  };
  function createMaterial() {
    const material = {
      parentProject: project,
      parentLayer: {},
      properties: {
        addAll(definitions) {
          for (const [name, definition] of Object.entries(definitions)) {
            const value = definition.group && Array.isArray(definition.objects)
              ? definition.objects.map((object) => object.value)
              : definition.value;
            const property = { ...definition, value, parentObject: material };
            property.get = function () { return property.value; };
            property.set = function (next) { property.value = next; definition.changed?.call(property); };
            this[name] = property;
          }
        },
        load() {},
      },
    };
    return material;
  }
  return { context, PZ, THREE, project, textures, unloaded, disposers, createMaterial };
}

async function loadTextured(h, key) {
  const factory = await h.PZ.material.fnList.imageplus;
  const material = h.createMaterial();
  factory.call(material);
  material.load();
  material.properties.texture.set(key);
  material.update(0);
  // A mesh whose geometry carries layout flags, so the layout release that
  // runs on disable is observable through the flags it removes.
  const geometry = { __zoidiumUvNormalized: true, __zoidiumUvOriginal: {} };
  material.parentObject = { threeObj: { geometry, material: material.threeObj } };
  return { material, geometry };
}

test("disabling Image+ releases every live material", async () => {
  const h = harness();
  ImagePlus.activate(h.context);
  const first = await loadTextured(h, "first.png");
  const second = await loadTextured(h, "second.png");
  assert.ok(first.material.threeObj.map);
  assert.ok(second.material.threeObj.map);

  for (const dispose of h.disposers.reverse()) dispose();

  assert.equal(h.PZ.material.fnList.imageplus, undefined);
  for (const { material, geometry } of [first, second]) {
    assert.equal(material.threeObj.map, null, "texture reference is dropped");
    assert.equal(geometry.__zoidiumUvNormalized, undefined, "layout release ran");
    assert.equal(geometry.__zoidiumUvOriginal, undefined, "layout release ran");
  }
  assert.equal(h.textures.length, 2);
  assert.ok(h.textures.every((texture) => texture.disposed), "both textures disposed");
  assert.deepEqual(h.unloaded.map((asset) => asset.key).sort(), ["first.png", "second.png"]);
});

test("unloaded materials are not released twice on disable", async () => {
  const h = harness();
  ImagePlus.activate(h.context);
  const { material } = await loadTextured(h, "only.png");
  const texture = material.threeObj.map;
  material.unload();
  assert.equal(texture.disposed, true);
  assert.equal(h.unloaded.length, 1);
  for (const dispose of h.disposers.reverse()) dispose();
  assert.equal(h.unloaded.length, 1, "disable does not unload again");
  assert.equal(h.PZ.material.fnList.imageplus, undefined);
});
