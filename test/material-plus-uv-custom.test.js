"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const UvCustom = require("../plugins/material-plus/uv-custom");

function uv(x, y) {
  return {
    x,
    y,
    set(nextX, nextY) {
      this.x = nextX;
      this.y = nextY;
    },
  };
}

function vec(x, y, z) {
  return { x, y, z };
}

// A 10 x 10 square extruded to depth 4, with WorldUVGenerator-style UVs.
function extrudedSquare(type = "TextGeometry", parameters = {}) {
  const vertices = [
    vec(0, 0, 0),
    vec(10, 0, 0),
    vec(10, 10, 0),
    vec(0, 10, 0),
    vec(0, 0, 4),
    vec(10, 0, 4),
    vec(10, 10, 4),
    vec(0, 10, 4),
  ];
  const faces = [
    { a: 0, b: 1, c: 2 },
    { a: 0, b: 2, c: 3 },
    { a: 4, b: 6, c: 5 },
    { a: 4, b: 7, c: 6 },
    { a: 0, b: 1, c: 4 },
    { a: 1, b: 5, c: 4 },
    { a: 1, b: 2, c: 5 },
    { a: 2, b: 6, c: 5 },
    { a: 2, b: 3, c: 6 },
    { a: 3, b: 7, c: 6 },
    { a: 3, b: 0, c: 7 },
    { a: 0, b: 4, c: 7 },
  ];
  return {
    type,
    parameters,
    vertices,
    faces,
    faceVertexUvs: [faces.map(() => [uv(-1, -1), uv(-1, -1), uv(-1, -1)])],
  };
}

function close(actual, expected, label) {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: expected ${expected}, got ${actual}`
  );
}

test("reconstructContours recovers the closed outline from the side walls", () => {
  const geometry = extrudedSquare();
  const contours = UvCustom.reconstructContours(geometry);

  assert.equal(contours.length, 1);
  assert.equal(contours[0].length, 4);
  const prepared = UvCustom.prepareContours(contours);
  close(prepared[0].total, 40, "perimeter");
});

test("normalizeGeometry maps caps and walls at one texel density", () => {
  const geometry = extrudedSquare();
  assert.equal(UvCustom.normalizeGeometry(geometry), true);

  const cap = geometry.faceVertexUvs[0][0];
  close(cap[0].x, 0, "cap u");
  close(cap[0].y, 0, "cap v");
  close(cap[1].x, 1, "cap max u");
  close(cap[2].y, 1, "cap max v");

  const side = geometry.faceVertexUvs[0][6];
  // scale = height 10; the (10,0)-(10,10) wall runs arc 10..20 -> u 1..2 and
  // the 4-unit depth -> v 0..0.4.
  close(side[0].x, 1, "wall u");
  close(side[1].x, 2, "wall far u");
  close(side[0].y, 0, "wall bottom v");
  close(side[2].y, 0.4, "wall top v");
});

test("isEligibleGeometry only accepts inner-UV extruded text and shapes", () => {
  assert.equal(UvCustom.isEligibleGeometry(extrudedSquare("TextGeometry")), true);
  assert.equal(UvCustom.isEligibleGeometry(extrudedSquare("ExtrudeGeometry")), true);
  assert.equal(UvCustom.isEligibleGeometry(extrudedSquare("BoxGeometry")), false);
  assert.equal(
    UvCustom.isEligibleGeometry(
      extrudedSquare("ExtrudeGeometry", { options: { extrudePath: {} } })
    ),
    false
  );

  const normalized = extrudedSquare();
  UvCustom.applyToGeometry(normalized);
  assert.equal(UvCustom.isEligibleGeometry(normalized), false);
});

test("a geometry without a rebuildable outline is skipped once", () => {
  const geometry = extrudedSquare();
  geometry.faces = geometry.faces.slice(0, 4); // caps only
  geometry.faceVertexUvs = [geometry.faceVertexUvs[0].slice(0, 4)];

  assert.equal(UvCustom.applyToGeometry(geometry), false);
  assert.equal(geometry.__zoidiumUvSkipped, true);
  assert.equal(UvCustom.isEligibleGeometry(geometry), false);
});

test("applyToGeometry and restoreGeometry round-trip the original UVs", () => {
  const geometry = extrudedSquare();
  const original = geometry.faceVertexUvs[0][0].map((entry) => `${entry.x},${entry.y}`).join(" ");

  assert.equal(UvCustom.applyToGeometry(geometry), true);
  assert.equal(geometry.__zoidiumUvNormalized, true);
  assert.notEqual(
    geometry.faceVertexUvs[0][0].map((entry) => `${entry.x},${entry.y}`).join(" "),
    original
  );

  UvCustom.restoreGeometry(geometry);
  assert.equal(geometry.__zoidiumUvNormalized, undefined);
  assert.equal(
    geometry.faceVertexUvs[0][0].map((entry) => `${entry.x},${entry.y}`).join(" "),
    original
  );
});

/* ------------------------------------------------------- material lifecycle */

function createHarness() {
  const tracked = [];
  const untracked = [];

  class Texture {
    constructor() {
      this.repeat = uv(1, 1);
      this.offset = uv(0, 0);
      this.center = uv(0, 0);
      this.rotation = 0;
    }
    dispose() {}
  }

  class ImageAsset {
    constructor(asset) {
      this.asset = asset;
      this.loading = Promise.resolve();
    }
    getTexture() {
      return new Texture();
    }
  }

  class Color {
    constructor() {
      this.r = 1;
      this.g = 1;
      this.b = 1;
    }
    setRGB(r, g, b) {
      this.r = r;
      this.g = g;
      this.b = b;
    }
  }

  class MeshStandardMaterial {
    constructor(options) {
      Object.assign(this, options);
      this.color = new Color();
      this.emissive = new Color();
      this.normalScale = uv(1, 1);
      this.map = null;
      this.normalMap = null;
      this.envMap = null;
      this.needsUpdate = false;
    }
    dispose() {}
  }

  const PZ = {
    material: { fnList: {} },
    asset: { type: { IMAGE: "image" }, image: ImageAsset },
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
  };

  return { PZ, THREE, tracked, untracked };
}

function createProperty(definition, material) {
  let value = definition.objects
    ? definition.objects.map((object) => object.value)
    : definition.value;
  return {
    parentObject: material,
    get() {
      return value;
    },
    set(next) {
      value = next;
      this.value = next;
      definition.changed?.call(this);
    },
    value,
  };
}

function createMaterial(harness, geometry) {
  const mesh = {
    geometry,
    traverse(callback) {
      callback(this);
    },
  };
  const material = {
    properties: {
      addAll(definitions) {
        for (const [name, definition] of Object.entries(definitions)) {
          this[name] = createProperty(definition, material);
        }
      },
      load() {},
    },
    parentProject: { assets: { load: (value) => ({ value }), unload() {} } },
    parentLayer: {},
    parentObject: { threeObj: mesh },
  };
  return harness.PZ.material.fnList.uvcustom.then((factory) => {
    factory.call(material);
    return material;
  });
}

test("registers UV Custom Material as an independent material factory", async () => {
  const harness = createHarness();
  const previous = () => {};
  harness.PZ.material.fnList.uvcustom = previous;

  UvCustom.activate({
    PZ: harness.PZ,
    window: { THREE: harness.THREE },
    plugin: { id: "material-plus", version: "4" },
  });
  assert.notEqual(harness.PZ.material.fnList.uvcustom, previous);
  assert.equal(harness.PZ.material.fnList.uvcustom._zoidiumMaterialMode, "native");

  UvCustom.deactivate();
  assert.equal(harness.PZ.material.fnList.uvcustom, previous);

  UvCustom.activate({ PZ: harness.PZ, window: { THREE: harness.THREE } });
  assert.ok(harness.PZ.material.fnList.uvcustom);
  UvCustom.deactivate();
});

test("the material normalizes its object and restores the UVs on unload", async () => {
  const harness = createHarness();
  UvCustom.activate({
    PZ: harness.PZ,
    window: { THREE: harness.THREE },
    plugin: { id: "material-plus", version: "4" },
  });

  const geometry = extrudedSquare();
  const original = geometry.faceVertexUvs[0][0].map((entry) => `${entry.x},${entry.y}`).join(" ");
  const material = await createMaterial(harness, geometry);

  material.load({ properties: {} });
  material.update(0);
  assert.equal(geometry.__zoidiumUvNormalized, true, "geometry is normalized");
  close(geometry.faceVertexUvs[0][6][0].x, 1, "wall is unwrapped");
  assert.equal(harness.tracked.length, 1, "material is tracked for the plugin");

  material.unload();
  assert.equal(geometry.__zoidiumUvNormalized, undefined, "marker cleared");
  assert.equal(
    geometry.faceVertexUvs[0][0].map((entry) => `${entry.x},${entry.y}`).join(" "),
    original,
    "original UVs restored"
  );
  assert.equal(harness.untracked.length, 1);
});
