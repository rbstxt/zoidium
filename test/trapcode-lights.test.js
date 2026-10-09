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
      this.threeObj = e === 4 ? new THREE.HemisphereLight(16777215, 16777215, 1) : new THREE.SpotLight(16777215, 1, 0, Math.PI / 3, 0.5, 1);
      this.properties.addAll({
        color: PZ.property.create(defs.color),
        position: PZ.property.create(defs.position),
        target: PZ.property.create(defs.target),
        intensity: PZ.property.create(defs.intensity),
        angle: PZ.property.create(defs.angle),
        ...(e === 4 ? { groundColor: PZ.property.create(defs.groundColor) } : {}),
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

test("stock methods remain untouched and legacy load wrapper restores on disable", () => {
  const { PZ, Light, stock } = setup();
  PZ.trapcode.lights.install(PZ);
  assert.equal(Light.prototype.changeObjectType, stock.changeObjectType);
  assert.equal(Light.prototype.update, stock.update);
  assert.equal(Light.propertyDefinitions.decay, undefined);
  PZ.trapcode.lights.uninstall();
  assert.equal(Light.prototype.load, stock.load);
});

for (const [label, data, backend, expectedType] of [
  ["Light+ alone Hemisphere", { objectType: 4, properties: { color: [0.3, 0.5, 0.8], groundColor: [0, 0, 0], name: "Saved hemisphere" } }, "HemisphereLight", 3],
  ["both enabled Hemisphere", { objectType: 4, properties: { color: [0.3, 0.5, 0.8], groundColor: [0, 0, 0], name: "Saved hemisphere" } }, "HemisphereLight", 3],
  ["DaviFX Area", { objectType: 4, properties: { width: 20, height: 30, color: [1, 0, 0], name: "Saved area" } }, "PointLight", "zoidium:trapcode-suite/area-light"],
  ["both enabled Area", { objectType: 4, properties: { width: 20, height: 30, name: "Saved area" } }, "PointLight", "zoidium:trapcode-suite/area-light"],
  ["DaviFX Hemisphere", { objectType: 5, properties: { skyColor: [0.3, 0.5, 0.8], groundColor: [0, 0, 0], name: "Saved sky" } }, "HemisphereLight", "zoidium:trapcode-suite/hemisphere-light"],
  ["legacy IES", { objectType: 6, properties: { name: "Saved IES" } }, "SpotLight", "zoidium:trapcode-suite/ies-light"],
  ["legacy Portal", { objectType: 8, properties: { name: "Saved portal" } }, "PointLight", "zoidium:trapcode-suite/portal-light"],
]) {
  test(label + " loads without changing its saved name", () => {
    const { PZ, THREE, Light } = setup();
    PZ.trapcode.lights.install(PZ);
    const light = new Light(); light.type = 3; light.load(data); light.update(0);
    assert.ok(light.threeObj instanceof THREE[backend]);
    assert.equal(light.type, expectedType);
    assert.equal(light.properties.name.get(), data.properties.name);
    PZ.trapcode.lights.uninstall();
    light.update(0);
  });
}

test("new Trapcode lights have separate namespaced factories and type-specific names", () => {
  const { PZ, Light, stock } = setup();
  const registrations = new Map();
  PZ.trapcode.lights.install(PZ, { registerClass(entry) {
    registrations.set(entry.type, entry); return () => registrations.delete(entry.type);
  } });
  for (const entry of registrations.values()) {
    const light = entry.factory(); light.load(null); light.update(0);
    assert.equal(light.toJSON().type, entry.type);
    assert.equal(light.properties.name.get(), entry.name);
  }
  const hemi = new Light(); hemi.load({objectType: 4, properties: {groundColor: [0,0,0]}});
  assert.equal(hemi.changeObjectType, stock.changeObjectType);
  assert.ok(hemi.threeObj.groundColor);
  PZ.trapcode.lights.uninstall();
  assert.equal(registrations.size, 0);
});


test("adding Light+ Hemisphere with no stored properties uses the stock backend", () => {
  const {PZ, THREE, Light, stock} = setup();
  PZ.trapcode.lights.install(PZ);
  const light = new Light(); light.type = 3;
  light.load({objectType: 4});
  assert.equal(light.type, 3);
  assert.equal(light.changeObjectType, stock.changeObjectType);
  assert.ok(light.threeObj instanceof THREE.HemisphereLight);
  light.update(0);
  PZ.trapcode.lights.uninstall();
});
