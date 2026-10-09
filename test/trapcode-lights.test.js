"use strict";

// Coverage for the C4D-style lights: install/uninstall restores the stock Light
// class, each type names the backend it renders with, legacy ids keep loading,
// and the per-frame sync writes the properties to the THREE light.

const assert = require("node:assert/strict");
const test = require("node:test");
const { loadSuite, createPZ, createTHREE, readSource } = require("./trapcode-env");

function stockLightClass(PZ, THREE) {
  const defs = {
    position: { dynamic: true, group: true, name: "Position", type: PZ.property.type.VECTOR3, objects: [
      { dynamic: true, name: "Position.X", type: 0, value: 0 },
      { dynamic: true, name: "Position.Y", type: 0, value: 10 },
      { dynamic: true, name: "Position.Z", type: 0, value: 0 },
    ] },
    target: { dynamic: true, group: true, name: "Target", type: PZ.property.type.VECTOR3, objects: [
      { dynamic: true, name: "Target.X", type: 0, value: 0 },
      { dynamic: true, name: "Target.Y", type: 0, value: 0 },
      { dynamic: true, name: "Target.Z", type: 0, value: 0 },
    ] },
    color: { dynamic: true, group: true, name: "Color", type: PZ.property.type.COLOR, objects: [
      { dynamic: true, name: "Color.R", type: 0, value: 1 },
      { dynamic: true, name: "Color.G", type: 0, value: 1 },
      { dynamic: true, name: "Color.B", type: 0, value: 1 },
    ] },
    skyColor: { dynamic: true, group: true, name: "Sky", type: PZ.property.type.COLOR, objects: [
      { dynamic: true, name: "Sky.R", type: 0, value: 1 },
      { dynamic: true, name: "Sky.G", type: 0, value: 1 },
      { dynamic: true, name: "Sky.B", type: 0, value: 1 },
    ] },
    groundColor: { dynamic: true, group: true, name: "Ground", type: PZ.property.type.COLOR, objects: [
      { dynamic: true, name: "Ground.R", type: 0, value: 0 },
      { dynamic: true, name: "Ground.G", type: 0, value: 0 },
      { dynamic: true, name: "Ground.B", type: 0, value: 0 },
    ] },
    intensity: { dynamic: true, name: "Intensity", type: 0, value: 1 },
    angle: { dynamic: true, name: "Angle", type: 0, value: 60 },
  };

  class StockLight extends PZ.object3d {
    constructor() {
      super();
      this.threeObj = null;
      this.objectType = 1;
    }
    load(e) {
      if (typeof e === "object") this.objectType = e.objectType;
      this.changeObjectType(this.objectType);
      this.properties.load(e && e.properties);
    }
    changeObjectType(e) {
      this.objectType = e;
      this.threeObj = new THREE.SpotLight(16777215, 1, 0, Math.PI / 3, 0.5, 1);
      this.properties.addAll({
        color: PZ.property.create(defs.color),
        position: PZ.property.create(defs.position),
        target: PZ.property.create(defs.target),
        intensity: PZ.property.create(defs.intensity),
        angle: PZ.property.create(defs.angle),
      });
      this.properties.name.set("Light");
      this.parentChanged();
    }
    update() {}
  }
  StockLight.propertyDefinitions = Object.assign({
    name: { visible: false, name: "Name", type: PZ.property.type.TEXT, value: "Light" },
  }, defs);
  return StockLight;
}

function setup(files = ["trapcode-common.js", "lights-c4d.js"]) {
  const { PZ, THREE } = loadSuite([]);
  PZ.object3d.light = stockLightClass(PZ, THREE);
  const stockPrototype = Object.assign({}, PZ.object3d.light.prototype);
  const stock = {
    changeObjectType: PZ.object3d.light.prototype.changeObjectType,
    update: PZ.object3d.light.prototype.update,
    load: PZ.object3d.light.prototype.load,
  };
  // The common and lights sources see the same PZ/THREE globals as the runtime.
  new Function("PZ", "THREE", readSource("trapcode-common.js"))(PZ, THREE);
  new Function("PZ", "THREE", readSource("lights-c4d.js"))(PZ, THREE);
  return { PZ, THREE, stock, stockPrototype, Light: PZ.object3d.light };
}

test("install wraps the Light prototype and uninstall restores the stock methods", () => {
  const env = setup();
  const { Light, stock, PZ } = env;
  assert.equal(Light.propertyDefinitions.decay, undefined, "no extra definitions before install");
  env.PZ.trapcode.lights.install(PZ);
  assert.notEqual(Light.prototype.changeObjectType, stock.changeObjectType);
  assert.notEqual(Light.prototype.update, stock.update);
  assert.notEqual(Light.prototype.load, stock.load);
  assert.ok(Light.propertyDefinitions.decay, "decay definition added");
  env.PZ.trapcode.lights.uninstall();
  assert.equal(Light.prototype.changeObjectType, stock.changeObjectType);
  assert.equal(Light.prototype.update, stock.update);
  assert.equal(Light.prototype.load, stock.load);
  assert.equal(Light.propertyDefinitions.decay, undefined, "definitions removed on uninstall");
  assert.equal(Light.propertyDefinitions.sunElevation, undefined);
});

test("install is idempotent and uninstall without install is a no-op", () => {
  const env = setup();
  const { PZ, Light } = env;
  env.PZ.trapcode.lights.uninstall();
  env.PZ.trapcode.lights.install(PZ);
  const wrapped = Light.prototype.changeObjectType;
  env.PZ.trapcode.lights.install(PZ);
  assert.equal(Light.prototype.changeObjectType, wrapped, "second install does not stack");
  env.PZ.trapcode.lights.uninstall();
  env.PZ.trapcode.lights.uninstall();
});

test("spot and point and directional types keep their stock backends", () => {
  const env = setup();
  const { PZ, THREE, Light } = env;
  env.PZ.trapcode.lights.install(PZ);
  const spot = new Light();
  spot.load({ objectType: 1, properties: {} });
  assert.ok(spot.threeObj instanceof THREE.SpotLight);
  assert.equal(spot.properties.name.get(), "Spot Light");
  const point = new Light();
  point.load({ objectType: 2, properties: {} });
  assert.ok(point.threeObj instanceof THREE.PointLight);
  const sun = new Light();
  sun.load({ objectType: 3, properties: {} });
  assert.ok(sun.threeObj instanceof THREE.DirectionalLight);
  env.PZ.trapcode.lights.uninstall();
});

test("area light renders as RectAreaLight only when the LTC tables exist", () => {
  const env = setup();
  const { PZ, THREE, Light } = env;
  env.PZ.trapcode.lights.install(PZ);
  const area = new Light();
  area.load({ objectType: 4, properties: {} });
  assert.ok(area.threeObj instanceof THREE.PointLight, "no LTC tables: point approximation");
  assert.equal(area.properties.name.get(), "Area Light (point approximation)");

  THREE.UniformsLib.LTC_1 = {};
  THREE.UniformsLib.LTC_2 = {};
  try {
    const real = new Light();
    real.load({ objectType: 4, properties: {} });
    assert.ok(real.threeObj instanceof THREE.RectAreaLight);
    assert.equal(real.properties.name.get(), "Area Light");
  } finally {
    delete THREE.UniformsLib.LTC_1;
    delete THREE.UniformsLib.LTC_2;
  }
  env.PZ.trapcode.lights.uninstall();
});

test("legacy ids keep loading: IES as spot, Portal as area, stock Hemisphere migrates", () => {
  const env = setup();
  const { PZ, THREE, Light } = env;
  env.PZ.trapcode.lights.install(PZ);
  const ies = new Light();
  ies.load({ objectType: 6, properties: {} });
  assert.ok(ies.threeObj instanceof THREE.SpotLight);
  assert.equal(ies.properties.name.get(), "Spot Light (legacy IES)");
  const portal = new Light();
  portal.load({ objectType: 8, properties: {} });
  assert.equal(portal.properties.name.get(), "Area Light (legacy Portal) (point approximation)");
  // Stock Hemisphere (id 4) payloads carry groundColor and no width/height.
  const hemi = new Light();
  hemi.load({ objectType: 4, properties: { groundColor: [0, 0, 0] } });
  assert.equal(hemi.objectType, 5);
  assert.ok(hemi.threeObj instanceof THREE.HemisphereLight);
  env.PZ.trapcode.lights.uninstall();
});

test("update writes properties to the THREE light and aims rect lights after moving them", () => {
  const env = setup();
  const { PZ, THREE, Light } = env;
  env.PZ.trapcode.lights.install(PZ);
  THREE.UniformsLib.LTC_1 = {};
  THREE.UniformsLib.LTC_2 = {};
  try {
    const light = new Light();
    light.load({ objectType: 4, properties: {} });
    light.properties.position.set([3, 4, 5]);
    light.properties.target.set([7, 8, 9]);
    light.update(0);
    assert.deepEqual([light.threeObj.position.x, light.threeObj.position.y, light.threeObj.position.z], [3, 4, 5]);
    // lookAt reads the position written just before it, so the aim uses the new spot.
    assert.deepEqual(light.threeObj.lookedAt, [7, 8, 9]);
    assert.ok(light.threeObj.matrixUpdates >= 1, "matrix refreshed after the sync");
    light.properties.intensity.set(2.5);
    light.update(0);
    assert.equal(light.threeObj.intensity, 2.5);
  } finally {
    delete THREE.UniformsLib.LTC_1;
    delete THREE.UniformsLib.LTC_2;
    env.PZ.trapcode.lights.uninstall();
  }
});

test("picker catalogue lists six offered types", () => {
  const env = setup();
  const listed = env.PZ.trapcode.lights.catalogue.filter((entry) => entry.listed).map((entry) => entry.id).sort((a, b) => a - b);
  assert.equal(JSON.stringify(listed), "[1,2,3,4,5,7]");
});

test("createPZ and createTHREE expose the surface the lights need", () => {
  const PZ = createPZ();
  const THREE = createTHREE();
  assert.equal(typeof PZ.propertyList, "function");
  assert.equal(typeof THREE.SpotLight, "function");
});
